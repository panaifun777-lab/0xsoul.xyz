/**
 * 手机确认锁 — 网关侧确认状态机（v1：网关侧先行）
 *
 * 对应《0x.soul 手机确认锁落地方案》第 2/3/4/6 节。职责：
 *  - 意图在「模拟 + 策略检查」之后、请求签名之前，按三档分级决定直行还是进待确认队列；
 *  - 批准必须绑定「预览哈希」，网关最终执行的交易须与该哈希一致，对不上即作废重走；
 *  - veto 优先于确认；只能升档不能降档；沉默（超时/拒绝）= 不成交；
 *  - kill switch 触发时清空待确认队列、作废所有未批准意图。
 *
 * 审批走可插拔的 Approver 接口：v1 实现 OwnerEd25519Approver（owner 确认私钥
 * 仅存手机端/owner 侧，服务器只存公钥）。手机 App 是后续阶段，v1 先把闸门做对。
 *
 * 实际执行通过 executor 回调注入（v1 为 mock 执行，真实 live_executor 后续接入同一处）。
 */
import { createHash, createPublicKey, verify as cryptoVerify, type KeyObject } from 'crypto';
import type { TradePreviewResponse } from './server';
import { loadConfirmPolicy, type ConfirmPolicy } from '../config/confirm';

export type Tier = 'EXEMPT' | 'SOFT' | 'STRONG'; // 免确认 / 一点确认 / 强确认
export type PendingStatus =
  | 'PENDING'
  | 'APPROVED'
  | 'REJECTED'
  | 'EXPIRED'
  | 'EXECUTED';

export type ConfirmAction = 'buy' | 'sell' | 'graduate' | 'transfer' | 'config' | 'other';

export interface PendingIntent {
  requestId: string;
  preview: TradePreviewResponse;
  previewHash: string;
  tier: Tier;
  action: ConfirmAction;
  createdAt: number;
  expiresAt: number;
  status: PendingStatus;
  decision?: 'approve' | 'reject' | 'timeout' | 'kill';
  decisionReason?: string;
  approvedAt?: number;
  txid?: string;
  result?: any;
}

export type Executor = (
  preview: TradePreviewResponse,
) => Promise<{ status: string; result: any; txid?: string }> | { status: string; result: any; txid?: string };

export interface Approver {
  /** 校验对 challenge 的签名是否有效。challenge = `${previewHash}|${requestId}|${expiresAt}` */
  verify(challenge: string, signatureB64: string): boolean | Promise<boolean>;
}

/** owner 确认私钥（ed25519）对应的公钥验签器。公钥以 SPKI/PEM base64 配置。 */
export class OwnerEd25519Approver implements Approver {
  private key: KeyObject;
  constructor(publicKeySpkiBase64: string) {
    this.key = createPublicKey({ key: Buffer.from(publicKeySpkiBase64, 'base64'), format: 'der', type: 'spki' });
  }
  verify(challenge: string, signatureB64: string): boolean {
    try {
      return cryptoVerify(
        null as any,
        Buffer.from(challenge, 'utf8'),
        this.key,
        Buffer.from(signatureB64, 'base64'),
      );
    } catch {
      return false;
    }
  }
}

/** 测试/演示用：任何签名都通过（仅测试注入，生产不可使用）。 */
export class AcceptAllApprover implements Approver {
  verify(): boolean {
    return true;
  }
}

export interface VetoResult {
  reason: string;
}

export class ConfirmationService {
  private policy: ConfirmPolicy;
  private approver: Approver | null;
  private pending = new Map<string, PendingIntent>();
  private dailyCumulative = new Map<string, number>(); // `${yyyymmdd}|${agentIndex}` -> SOL
  private vetoChecker: ((preview: TradePreviewResponse, action: ConfirmAction) => string | null) | null = null;
  private sweepTimer?: ReturnType<typeof setInterval>;

  constructor(opts?: { policy?: ConfirmPolicy; approver?: Approver | null; sweepMs?: number }) {
    this.policy = opts?.policy ?? loadConfirmPolicy();
    this.approver = opts?.approver ?? null;
    const sweepMs = opts?.sweepMs ?? 30_000;
    this.sweepTimer = setInterval(() => this.sweepExpired(), sweepMs);
    if (this.sweepTimer.unref) this.sweepTimer.unref();
  }

  setApprover(approver: Approver | null) {
    this.approver = approver;
  }
  setVetoChecker(fn: (preview: TradePreviewResponse, action: ConfirmAction) => string | null) {
    this.vetoChecker = fn;
  }

  /** 规范化的预览哈希：绑定 mint/方向/金额/价格/滑点/note/agent，防「点完再换」。 */
  computePreviewHash(preview: TradePreviewResponse): string {
    const canonical = {
      agentIndex: preview.agentIndex,
      estimatedPriceSol: preview.estimatedPriceSol,
      isBuy: preview.isBuy,
      mint: preview.mint,
      note: preview.note,
      slippagePct: preview.slippagePct,
      solAmount: preview.solAmount,
      tokenAmount: preview.tokenAmount,
    };
    return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
  }

  /** 三档分级：金额 / 类型 / 首次 / 滑点 / 日累计叠加，命中多档按最高档；只能升档。 */
  classify(preview: TradePreviewResponse, action: ConfirmAction, meta?: { firstTimeToken?: boolean; firstTimeProgram?: boolean }): Tier {
    const notional = Math.max(0, preview.solAmount || 0);
    let tier: Tier = 'EXEMPT';
    const escalate = (t: Tier) => {
      const order: Tier[] = ['EXEMPT', 'SOFT', 'STRONG'];
      if (order.indexOf(t) > order.indexOf(tier)) tier = t;
    };

    if (this.policy.allConfirm) escalate('SOFT');
    if (this.policy.forcedStrongTypes.includes(action)) escalate('STRONG');
    if (notional >= this.policy.strongSingleSol) escalate('STRONG');
    if (notional > this.policy.exemptSingleSol) escalate('SOFT');
    if (this.policy.forcedSoftTypes.includes(action)) escalate('SOFT');
    if (meta?.firstTimeToken || meta?.firstTimeProgram) escalate('SOFT');
    if ((preview.slippagePct ?? 0) >= this.policy.slippageWarnPct) escalate('SOFT');

    // 日累计：预计累计（含本笔）超上限 -> 之后每笔至少一点确认
    const key = this.dailyKey(preview.agentIndex);
    const projected = (this.dailyCumulative.get(key) || 0) + notional;
    if (projected > this.policy.dailyCumulativeSol) escalate('SOFT');

    return tier;
  }

  private dailyKey(agentIndex: number): string {
    const d = new Date();
    const ymd = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
    return `${ymd}|${agentIndex}`;
  }

  /**
   * 提交一笔待执行意图。
   *  - veto 命中：直接拒签，不进队列。
   *  - 免确认档：立即执行（仍重做模拟/策略检查由调用方保证）。
   *  - 一点确认 / 强确认档：进待确认队列，返回 PENDING 与需签名的 challenge。
   */
  async submit(
    preview: TradePreviewResponse,
    action: ConfirmAction,
    executor: Executor,
    meta?: { firstTimeToken?: boolean; firstTimeProgram?: boolean },
  ): Promise<{ status: PendingStatus; intent?: PendingIntent; challenge?: string; result?: any; reason?: string }> {
    // 1) veto 优先
    if (this.vetoChecker) {
      const reason = this.vetoChecker(preview, action);
      if (reason) {
        return { status: 'REJECTED', reason: `VETO: ${reason}` };
      }
    }

    const previewHash = this.computePreviewHash(preview);
    const tier = this.classify(preview, action, meta);
    const now = Date.now();
    const expiresAt = now + this.policy.validityMs;
    const intent: PendingIntent = {
      requestId: preview.requestId,
      preview,
      previewHash,
      tier,
      action,
      createdAt: now,
      expiresAt,
      status: 'PENDING',
    };

    // 2) 免确认：直接执行
    if (tier === 'EXEMPT') {
      const out = await this.runExecutor(intent, executor);
      return { status: out.status, intent, result: out.result };
    }

    // 3) 需确认：入队
    this.pending.set(preview.requestId, intent);
    const challenge = `${previewHash}|${preview.requestId}|${expiresAt}`;
    return { status: 'PENDING', intent, challenge };
  }

  private async runExecutor(intent: PendingIntent, executor: Executor) {
    const out = await executor(intent.preview);
    intent.status = 'EXECUTED';
    intent.txid = out.txid;
    intent.result = out.result;
    this.addDaily(intent.preview.agentIndex, Math.max(0, intent.preview.solAmount || 0));
    return out;
  }

  private addDaily(agentIndex: number, sol: number) {
    const key = this.dailyKey(agentIndex);
    this.dailyCumulative.set(key, (this.dailyCumulative.get(key) || 0) + sol);
  }

  getPending(requestId: string): PendingIntent | undefined {
    return this.pending.get(requestId);
  }

  listPending(): PendingIntent[] {
    return [...this.pending.values()];
  }

  /**
   * 批准一笔待确认意图。签名须覆盖 `${previewHash}|${requestId}|${expiresAt}`。
   * 篡改（预览任一字段变化导致哈希变化）会使验签失败 -> 拒绝。
   * 强确认档还需 secondFactor（二次复核/生物识别）。
   */
  async approve(
    requestId: string,
    signatureB64: string,
    executor: Executor,
    opts?: { secondFactor?: string },
  ): Promise<{ ok: boolean; status: PendingStatus; result?: any; reason?: string }> {
    const intent = this.pending.get(requestId);
    if (!intent) return { ok: false, status: 'EXPIRED', reason: '未找到待确认意图（可能已过期或被 kill）' };
    if (intent.status !== 'PENDING') return { ok: false, status: intent.status, reason: `意图状态为 ${intent.status}，不可重复批准` };

    if (Date.now() > intent.expiresAt) {
      intent.status = 'EXPIRED';
      intent.decision = 'timeout';
      this.pending.delete(requestId);
      return { ok: false, status: 'EXPIRED', reason: '确认已超时（沉默=拒绝）' };
    }

    // 重新计算预览哈希：若预览被改动，哈希变化 -> 签名对不上 -> 拒绝
    const currentHash = this.computePreviewHash(intent.preview);
    const challenge = `${currentHash}|${requestId}|${intent.expiresAt}`;

    if (!this.approver) {
      return { ok: false, status: 'PENDING', reason: '确认面未配置（无 owner 公钥），拒绝执行（fail-closed）' };
    }
    const ok = await this.approver.verify(challenge, signatureB64);
    if (!ok) {
      intent.status = 'REJECTED';
      intent.decision = 'reject';
      intent.decisionReason = '签名校验失败（可能预览被篡改或签名无效）';
      this.pending.delete(requestId);
      return { ok: false, status: 'REJECTED', reason: intent.decisionReason };
    }

    // 强确认：需二次复核
    if (intent.tier === 'STRONG') {
      if (!opts?.secondFactor) {
        return { ok: false, status: 'PENDING', reason: '强确认需要二次复核（secondFactor）' };
      }
    }

    const out = await this.runExecutor(intent, executor);
    this.pending.delete(requestId);
    return { ok: true, status: 'EXECUTED', result: out.result };
  }

  reject(requestId: string, reason = '用户拒绝'): { ok: boolean; status: PendingStatus } {
    const intent = this.pending.get(requestId);
    if (!intent) return { ok: false, status: 'EXPIRED' };
    intent.status = 'REJECTED';
    intent.decision = 'reject';
    intent.decisionReason = reason;
    this.pending.delete(requestId);
    return { ok: true, status: 'REJECTED' };
  }

  /** 超时清理：过期且未处理的意图记为 EXPIRED 并移除（不执行、不自动重试）。 */
  sweepExpired(): string[] {
    const now = Date.now();
    const expired: string[] = [];
    for (const [id, intent] of [...this.pending.entries()]) {
      if (now > intent.expiresAt) {
        intent.status = 'EXPIRED';
        intent.decision = 'timeout';
        this.pending.delete(id);
        expired.push(id);
      }
    }
    return expired;
  }

  /** Kill switch 联动：清空待确认队列，作废所有未批准意图。 */
  clearAll(reason = 'kill-switch'): number {
    const count = this.pending.size;
    for (const intent of this.pending.values()) {
      intent.status = 'REJECTED';
      intent.decision = 'kill';
      intent.decisionReason = reason;
    }
    this.pending.clear();
    return count;
  }

  dispose() {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
  }
}
