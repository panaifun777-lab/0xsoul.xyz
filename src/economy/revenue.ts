/**
 * 协议收益归集台账 (Protocol Revenue Ledger)
 *
 * ## 为什么需要这个模块
 *
 * 交易手续费在计算层被扣除后，必须有明确的归属与可审计流向，否则资金会
 * 滞留在曲线金库中无法提取。本模块负责：
 *
 * 1. **归集**：每笔交易/发行/微支付产生的手续费，按 `GANG_PROTOCOL_FEE_BPS`
 *    拆分为「协议金库」与「流动性留存」两部分，逐笔记账。
 * 2. **审计**：完整的流水记录，可导出为 JSONL 供财务报表与链上对账使用。
 * 3. **结算**：累积到阈值后，生成待上链的转账指令（收款方由环境变量注入）。
 *
 * ## 资金流向
 *
 * ```
 *   交易者支付 1.00 SOL
 *        │
 *        ├── 0.99 SOL → 联合曲线金库（推高价格）
 *        └── 0.01 SOL → 手续费池
 *                 │
 *                 ├── 20% (0.002 SOL) → 协议金库 fee_receiver
 *                 └── 80% (0.008 SOL) → 流动性留存 / 回购销毁
 * ```
 *
 * ## 安全约束
 *
 * 收款地址**绝不硬编码在源码中**，一律通过 `GANG_PROTOCOL_FEE_RECEIVER_SOLANA`
 * 环境变量注入；为空时进入「只记账、不结算」的观察模式，防止误转。
 */

import fs from 'fs';
import path from 'path';
import { PublicKey } from '@solana/web3.js';
import { getProtocolRevenueConfig } from '../config/graduation';

/** 单笔收益来源类型 */
export type RevenueSource =
  | 'TOKEN_LAUNCH' // 代币发行创建费
  | 'TRADE_FEE' // 联合曲线交易手续费
  | 'GRADUATION_FEE' // 毕业注入 DEX 服务费
  | 'X402_SIGNAL' // x402 情报订阅
  | 'AGENT_ID'; // Agent 身份注册费

/** 一条收益流水 */
export interface RevenueEntry {
  /** 唯一流水号 */
  id: string;
  /** 收益来源 */
  source: RevenueSource;
  /** 关联代币 mint（非交易类可为空） */
  mint?: string;
  /** 触发方（钱包地址或域名） */
  payer?: string;
  /** 本条产生的总手续费（SOL） */
  grossFeeSol: number;
  /** 归协议金库的金额（SOL） */
  protocolShareSol: number;
  /** 留存曲线的金额（SOL） */
  liquidityShareSol: number;
  /** 记账时间戳 */
  timestamp: number;
}

/** 结算批次 */
export interface SettlementBatch {
  batchId: string;
  /** 应收款地址（来自环境变量） */
  recipient: string;
  /** 本批次累计金额（SOL） */
  amountSol: number;
  /** 包含的流水 ID */
  entryIds: string[];
  /** 创建时间 */
  createdAt: number;
  /** 状态：PENDING 待上链 / SETTLED 已上链 / SKIPPED 未配置收款地址 */
  status: 'PENDING' | 'SETTLED' | 'SKIPPED';
}

/** 按来源统计 */
export interface RevenueSummary {
  totalGrossFeeSol: number;
  totalProtocolShareSol: number;
  totalLiquidityShareSol: number;
  pendingSettlementSol: number;
  settledSol: number;
  bySource: Record<string, { count: number; grossSol: number; protocolSol: number }>;
  recipientConfigured: boolean;
  recipient: string;
}

/**
 * 协议收益台账。
 *
 * 负责手续费拆分、逐笔记账、批次结算与统计查询。
 */
export class ProtocolRevenueLedger {
  private entries: RevenueEntry[] = [];
  private batches: SettlementBatch[] = [];
  private settledAmount = 0;
  /** 已结算过的流水 ID（避免重复结算） */
  private settledEntryIds = new Set<string>();
  /** 已被未完成批次占用的流水 ID，防止重复打包导致重复打款 */
  private reservedEntryIds = new Set<string>();
  private storagePath: string;
  private seq = 0;

  constructor(options?: { storagePath?: string }) {
    this.storagePath =
      options?.storagePath || path.join(process.cwd(), 'data', 'revenue.jsonl');
    this.load();
  }

  /* ------------------------------ 持久化 ------------------------------ */

  private load(): void {
    try {
      if (!fs.existsSync(this.storagePath)) return;
      const lines = fs.readFileSync(this.storagePath, 'utf8').split('\n').filter(Boolean);
      for (const line of lines) {
        const rec = JSON.parse(line) as { kind: string } & Record<string, any>;
        if (rec.kind === 'entry') {
          const entry = rec as unknown as RevenueEntry;
          this.entries.push(entry);
          this.settledEntryIds.add(entry.id);
        } else if (rec.kind === 'batch') {
          const batch = rec as unknown as SettlementBatch;
          this.batches.push(batch);
          if (batch.status === 'SETTLED') this.settledAmount += batch.amountSol;
        }
      }
      // 修正：只有 SETTLED 的批次才算已结算
      this.settledEntryIds.clear();
      for (const b of this.batches) {
        if (b.status === 'SETTLED') b.entryIds.forEach((id) => this.settledEntryIds.add(id));
      }
      this.entries.forEach((e) => {
        const num = Number(e.id.split('_').pop());
        if (Number.isFinite(num) && num > this.seq) this.seq = num;
      });
    } catch (err) {
      console.warn('[RevenueLedger] 加载历史流水失败:', (err as Error).message);
    }
  }

  private append(record: Record<string, unknown>): void {
    try {
      const dir = path.dirname(this.storagePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.appendFileSync(this.storagePath, JSON.stringify(record) + '\n', 'utf8');
    } catch (err) {
      console.warn('[RevenueLedger] 落盘失败:', (err as Error).message);
    }
  }

  /* ------------------------------ 核心记账 ------------------------------ */

  /**
   * 记录一笔收益。
   *
   * @param source 收益来源
   * @param grossFeeSol 本条产生的总手续费（SOL），由调用方按费率算出
   * @param meta 关联信息（mint / payer）
   */
  public record(
    source: RevenueSource,
    grossFeeSol: number,
    meta?: { mint?: string; payer?: string },
  ): RevenueEntry {
    const cfg = getProtocolRevenueConfig();
    // GANG_PROTOCOL_FEE_BPS 表示「协议在手续费池中的分成比例」
    // 例如 20 表示协议拿走手续费的 20%（注意与合约 TRADING_FEE_BPS=100 的 1% 交易税区分）
    // 取值 0~100，超出范围自动裁剪，避免配置错误导致 100% 抽走或负数
    const protocolRatio = Math.min(1, Math.max(0, cfg.protocolFeeBps / 100));
    const protocolShare = Number((grossFeeSol * protocolRatio).toFixed(9));
    const liquidityShare = Number((grossFeeSol - protocolShare).toFixed(9));

    const entry: RevenueEntry = {
      id: `rev_${Date.now()}_${++this.seq}`,
      source,
      mint: meta?.mint,
      payer: meta?.payer,
      grossFeeSol: Number(grossFeeSol.toFixed(9)),
      protocolShareSol: protocolShare,
      liquidityShareSol: liquidityShare,
      timestamp: Date.now(),
    };

    this.entries.push(entry);
    this.append({ kind: 'entry', ...entry });
    return entry;
  }

  /* ------------------------------ 结算 ------------------------------ */

  /** 生成结算批次：把尚未结算的协议份额打包成一笔待上链转账 */
  public createSettlementBatch(): SettlementBatch {
    const cfg = getProtocolRevenueConfig();
    // 排除两类流水：已上链结算的、已被其他未完成批次占用的
    // 否则连续调用会产生多个包含相同流水的批次，导致重复打款
    const pending = this.entries.filter(
      (e) =>
        e.protocolShareSol > 0 &&
        !this.settledEntryIds.has(e.id) &&
        !this.reservedEntryIds.has(e.id),
    );
    const amount = Number(pending.reduce((s, e) => s + e.protocolShareSol, 0).toFixed(9));

    const batch: SettlementBatch = {
      batchId: `batch_${Date.now()}`,
      recipient: cfg.solanaBeneficiary,
      amountSol: amount,
      entryIds: pending.map((e) => e.id),
      createdAt: Date.now(),
      // 未配置收款地址时进入观察模式，绝不敢往错误地址转账
      status: cfg.solanaBeneficiary ? 'PENDING' : 'SKIPPED',
    };

    // 占用这些流水，防止下一次调用重复打包
    pending.forEach((e) => this.reservedEntryIds.add(e.id));

    this.batches.push(batch);
    this.append({ kind: 'batch', ...batch });
    return batch;
  }

  /** 标记批次已上链（由真实转账逻辑调用） */
  public markSettled(batchId: string, txSignature: string): SettlementBatch {
    const batch = this.batches.find((b) => b.batchId === batchId);
    if (!batch) throw new Error(`Batch not found: ${batchId}`);
    if (batch.status === 'SETTLED') throw new Error(`Batch already settled: ${batchId}`);

    batch.status = 'SETTLED';
    this.settledAmount += batch.amountSol;
    batch.entryIds.forEach((id) => {
      this.settledEntryIds.add(id);
      this.reservedEntryIds.delete(id);
    });
    this.append({ kind: 'batch_settled', batchId, txSignature, settledAt: Date.now() });

    return batch;
  }

  /** 取消批次（例如上链前发现收款地址错误），释放被占用的流水以便重新打包 */
  public cancelBatch(batchId: string, reason = 'cancelled'): SettlementBatch {
    const batch = this.batches.find((b) => b.batchId === batchId);
    if (!batch) throw new Error(`Batch not found: ${batchId}`);
    if (batch.status === 'SETTLED') throw new Error(`Cannot cancel a settled batch: ${batchId}`);

    batch.status = 'SKIPPED';
    batch.entryIds.forEach((id) => this.reservedEntryIds.delete(id));
    this.append({ kind: 'batch_cancelled', batchId, reason, cancelledAt: Date.now() });

    return batch;
  }

  /* ------------------------------ 查询 ------------------------------ */

  /** 汇总统计 */
  public summary(): RevenueSummary {
    const cfg = getProtocolRevenueConfig();
    const bySource: RevenueSummary['bySource'] = {};

    for (const e of this.entries) {
      const slot = (bySource[e.source] ||= { count: 0, grossSol: 0, protocolSol: 0 });
      slot.count++;
      slot.grossSol = Number((slot.grossSol + e.grossFeeSol).toFixed(9));
      slot.protocolSol = Number((slot.protocolSol + e.protocolShareSol).toFixed(9));
    }

    const totalGross = this.entries.reduce((s, e) => s + e.grossFeeSol, 0);
    const totalProtocol = this.entries.reduce((s, e) => s + e.protocolShareSol, 0);
    const totalLiquidity = this.entries.reduce((s, e) => s + e.liquidityShareSol, 0);
    const pending = this.entries
      .filter((e) => !this.settledEntryIds.has(e.id))
      .reduce((s, e) => s + e.protocolShareSol, 0);

    return {
      totalGrossFeeSol: Number(totalGross.toFixed(9)),
      totalProtocolShareSol: Number(totalProtocol.toFixed(9)),
      totalLiquidityShareSol: Number(totalLiquidity.toFixed(9)),
      pendingSettlementSol: Number(pending.toFixed(9)),
      settledSol: Number(this.settledAmount.toFixed(9)),
      bySource,
      recipientConfigured: Boolean(cfg.solanaBeneficiary),
      recipient: cfg.solanaBeneficiary,
    };
  }

  /** 最近 N 条流水 */
  public recent(limit = 30): RevenueEntry[] {
    return this.entries.slice(-limit).reverse();
  }

  /** 全部结算批次 */
  public settlementBatches(): SettlementBatch[] {
    return [...this.batches].reverse();
  }

  /** 校验收款地址是否合法 */
  public static validateRecipient(address: string): { ok: boolean; error?: string } {
    if (!address) return { ok: false, error: 'Recipient address is empty' };
    try {
      new PublicKey(address);
      return { ok: true };
    } catch {
      return { ok: false, error: `Invalid Solana address: ${address}` };
    }
  }
}
