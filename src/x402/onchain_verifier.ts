/**
 * Solana 链上支付验款器 (On-Chain Payment Verifier)
 *
 * ## 为什么需要它
 *
 * 原先 `X402PaymentEngine.verifyPayment()` 只做**内存判断**：只要客户端传一个字符串
 * 且 nonce 未过期就认为付款成功——任何人都可以伪造免费获取付费数据。
 *
 * 本模块改为**真实读取链上交易**，逐项校验：
 *
 * | 校验项 | 防的是什么 |
 * | :--- | :--- |
 * | 交易存在且已确认 | 伪造凭空签名 |
 * | 交易执行成功（err == null） | 失败交易冒充付款 |
 * | 转账金额 ≥ 账单金额 | 少付/不付 |
 * | 收款账户 == 账单收款方 | 打给自己的地址 |
 * | 付款方 == 声明的 Agent | 盗用他人交易签名 |
 * | 交易时间在容差窗口内 | 复用历史旧交易 |
 * | 签名未被消费 | 重放攻击 |
 *
 * ## 设计要点
 *
 * - **可注入查询函数**：测试时用 mock 查询器，无需真实网络
 * - **只读**：仅调用 `getTransaction`，不签名、不广播、不持有私钥
 * - **失败即拒绝**：任何一项不满足都返回明确原因，绝不放行
 */

import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { PaymentStore, MemoryPaymentStore } from './store';

/** Solana SPL Token 程序 ID（标准代币程序） */
export const SPL_TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
/** 关联代币账户（ATA）程序 ID */
export const ASSOCIATED_TOKEN_PROGRAM_ID = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
/** 主网 USDC 铸币地址（SPL Token-2022 前的经典 USDC） */
export const USDC_MAINNET_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkYWw4cRT';

/**
 * 由钱包地址 + 代币 mint 推导其关联代币账户（ATA）。
 *
 * ATA = PDA([wallet, TOKEN_PROGRAM, mint], ASSOCIATED_TOKEN_PROGRAM)。
 * 由于 ATA 已把 mint 编码进地址，只要转账目标 ATA 与
 * deriveAssociatedTokenAddress(wallet, mint) 一致，就同时证明了
 * “收款方钱包正确” 与 “代币为指定 mint（如 USDC）”。
 */
export function deriveAssociatedTokenAddress(wallet: string, mint: string): string {
  const [ata] = PublicKey.findProgramAddressSync(
    [
      new PublicKey(wallet).toBuffer(),
      new PublicKey(SPL_TOKEN_PROGRAM_ID).toBuffer(),
      new PublicKey(mint).toBuffer(),
    ],
    new PublicKey(ASSOCIATED_TOKEN_PROGRAM_ID),
  );
  return ata.toBase58();
}

/** 单笔链上 SPL 代币转账事实 */
export interface TokenTransfer {
  /** 接收方关联代币账户（ATA） */
  recipient: string;
  /** 转账金额（代币最小单位，raw units，非小数） */
  amount: bigint;
  /** 代币精度（decimals）；Transfer 指令无法携带时记为 0 */
  decimals: number;
}

/** 单笔链上支付的事实（从链上解析而来） */
export interface OnChainPaymentFact {
  /** 交易签名 */
  signature: string;
  /** 交易是否执行成功 */
  success: boolean;
  /** 实际付款方（转账指令的 from） */
  payer: string;
  /** 实际收款方（SOL 系统转账的 to） */
  recipient: string;
  /** 实际转账金额（lamports） */
  lamports: bigint;
  /** 区块时间（秒）；缺失时为 0 */
  blockTime: number;
  /** 是否已确认 */
  confirmed: boolean;
  /** 本交易中所有的 SPL 代币转账（USDC 等） */
  tokenTransfers: TokenTransfer[];
}

/** 期望的付款条件（来自账单） */
export interface ExpectedPayment {
  /** 期望收款地址（SOL 系统转账时校验） */
  recipient?: string;
  /** 期望最低金额（lamports，SOL 系统转账时校验） */
  minLamports?: bigint;
  /** 期望的 SPL 代币收款 ATA（如 USDC ATA）；提供则改为校验代币转账 */
  expectedTokenRecipient?: string;
  /** 期望代币最低金额（raw units，如 USDC 的 6 位精度整数） */
  expectedTokenMinAmount?: bigint;
  /** 可选的期望付款方（为空则不校验） */
  expectedPayer?: string;
  /** 交易时间容差（秒），默认 600 秒 = 10 分钟 */
  timeToleranceSeconds?: number;
  /** 当前时间（秒），便于测试注入 */
  nowSeconds?: number;
}

export interface VerifyResult {
  valid: boolean;
  /** 失败原因（valid=false 时必有） */
  error?: string;
  /** 校验通过时的链上事实 */
  fact?: OnChainPaymentFact;
}

/**
 * 从链上查询交易并解析为付款事实。
 *
 * 返回 `null` 表示交易不存在或无法解析。
 */
export type PaymentQueryFn = (signature: string) => Promise<OnChainPaymentFact | null>;

/**
 * 基于 `@solana/web3.js` 的真实链上查询实现。
 *
 * 解析逻辑：遍历交易的指令，找出 `system transfer`（program = 11111111111111111111111111111111，
 * 指令数据前 4 字节为 2 = Transfer），提取 from / to / lamports。
 */
export function createSolanaPaymentQuery(connection: Connection): PaymentQueryFn {
  return async (signature: string): Promise<OnChainPaymentFact | null> => {
    const tx = await connection.getTransaction(signature, {
      commitment: 'confirmed',
      maxSupportedTransactionVersion: 0,
    });

    if (!tx) return null;

    const message = tx.transaction.message;
    const accountKeys = message.getAccountKeys
      ? message.getAccountKeys({ accountKeysFromLookups: tx.meta?.loadedAddresses }).keySegments().flat()
      : (message as any).accountKeys as PublicKey[];

    let payer = '';
    let recipient = '';
    let lamports = 0n;
    const tokenTransfers: TokenTransfer[] = [];

    for (const ix of message.compiledInstructions || (message as any).instructions || []) {
      const programId: PublicKey = accountKeys[ix.programIdIndex];
      const programStr = programId.toBase58();

      // ---- SOL 系统转账：program = 1111...1111，u32 LE 类型 = 2，后跟 u64 LE 金额 ----
      if (programStr === '11111111111111111111111111111111') {
        const dataBuf =
          typeof ix.data === 'string' ? Buffer.from(ix.data, 'base64') : Buffer.from(ix.data);
        if (dataBuf.length >= 12 && dataBuf.readUInt32LE(0) === 2) {
          payer = accountKeys[ix.accountKeyIndexes?.[0] ?? (ix as any).accounts?.[0] ?? 0].toBase58();
          recipient = accountKeys[ix.accountKeyIndexes?.[1] ?? (ix as any).accounts?.[1] ?? 1].toBase58();
          lamports = dataBuf.readBigUInt64LE(4);
        }
        continue;
      }

      // ---- SPL 代币转账：program = Tokenkeg...，Transfer(3) / TransferChecked(12) ----
      if (programStr === SPL_TOKEN_PROGRAM_ID) {
        const dataBuf =
          typeof ix.data === 'string' ? Buffer.from(ix.data, 'base64') : Buffer.from(ix.data);
        if (dataBuf.length < 9) continue;
        const ixType = dataBuf.readUInt8(0);
        if (ixType !== 3 && ixType !== 12) continue;
        // u64 LE 金额位于 data[1..9]
        const amount = dataBuf.readBigUInt64LE(1);
        const destIdx = ix.accountKeyIndexes?.[1] ?? (ix as any).accounts?.[1];
        if (destIdx === undefined) continue;
        const decimals = ixType === 12 && dataBuf.length >= 10 ? dataBuf.readUInt8(9) : 0;
        tokenTransfers.push({
          recipient: accountKeys[destIdx].toBase58(),
          amount,
          decimals,
        });
      }
    }

    return {
      signature,
      success: tx.meta?.err === null,
      payer,
      recipient,
      lamports,
      blockTime: tx.blockTime ?? 0,
      confirmed: true,
      tokenTransfers,
    };
  };
}

/**
 * 校验一笔链上支付是否满足账单要求。
 *
 * 这是一组**纯函数式校验**，不涉及网络，因此可以完整单测。
 */
export function validatePaymentFact(
  fact: OnChainPaymentFact,
  expected: ExpectedPayment,
): VerifyResult {
  if (!fact.confirmed) {
    return { valid: false, error: 'Transaction is not confirmed yet', fact };
  }
  if (!fact.success) {
    return { valid: false, error: 'Transaction execution failed on-chain', fact };
  }
  if (expected.expectedTokenRecipient && expected.expectedTokenMinAmount !== undefined) {
    // ---- SPL 代币（USDC 等）付款校验 ----
    const match = fact.tokenTransfers.find(
      (t) =>
        t.recipient === expected.expectedTokenRecipient &&
        t.amount >= expected.expectedTokenMinAmount,
    );
    if (!match) {
      const found = fact.tokenTransfers.length
        ? fact.tokenTransfers.map((t) => `${t.recipient}:${t.amount}`).join(', ')
        : 'none';
      return {
        valid: false,
        error: `Token payment mismatch: expected >= ${expected.expectedTokenMinAmount} to ${expected.expectedTokenRecipient}, got ${found}`,
        fact,
      };
    }
  } else {
    // ---- SOL 系统转账校验（原逻辑）----
    if (!expected.recipient || expected.minLamports === undefined) {
      return {
        valid: false,
        error: 'No payment expectation specified (neither SOL nor SPL token)',
        fact,
      };
    }
    if (fact.lamports <= 0n) {
      return { valid: false, error: 'Transaction contains no SOL transfer', fact };
    }
    if (fact.recipient !== expected.recipient) {
      return {
        valid: false,
        error: `Recipient mismatch: expected ${expected.recipient}, got ${fact.recipient || '<none>'}`,
        fact,
      };
    }
    if (fact.lamports < expected.minLamports) {
      return {
        valid: false,
        error: `Insufficient payment: required ${expected.minLamports} lamports, got ${fact.lamports}`,
        fact,
      };
    }
  }
  if (expected.expectedPayer && fact.payer !== expected.expectedPayer) {
    return {
      valid: false,
      error: `Payer mismatch: expected ${expected.expectedPayer}, got ${fact.payer || '<none>'}`,
      fact,
    };
  }

  // 时间窗校验：防止复用很久以前的旧交易
  const tolerance = expected.timeToleranceSeconds ?? 600;
  const now = expected.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (fact.blockTime > 0 && now - fact.blockTime > tolerance) {
    return {
      valid: false,
      error: `Payment is stale: ${now - fact.blockTime}s old, tolerance ${tolerance}s`,
      fact,
    };
  }
  // 允许轻微时钟偏差：交易时间最多领先 60 秒
  if (fact.blockTime > now + 60) {
    return {
      valid: false,
      error: `Payment blockTime is in the future: ${fact.blockTime} vs now ${now}`,
      fact,
    };
  }

  return { valid: true, fact };
}

/** 便捷：把 SOL 转为 lamports（避免浮点误差） */
export function solToLamports(sol: number): bigint {
  return BigInt(Math.round(sol * LAMPORTS_PER_SOL));
}

/**
 * 链上验款器门面。
 *
 * 组合「链上查询」与「纯校验」，并维护已消费签名集合以防重放。
 */
export class OnChainPaymentVerifier {
  private query: PaymentQueryFn;
  /** 是否启用真实链上校验（false 时降级为拒绝，绝不静默放行） */
  private enabled: boolean;
  /** 已消费签名集合（防重放），默认内存，可注入 Redis 实现跨重启持久 */
  private store: PaymentStore;

  constructor(
    query: PaymentQueryFn | null,
    options?: { enabled?: boolean; store?: PaymentStore },
  ) {
    this.enabled = Boolean(query) && (options?.enabled ?? true);
    // 未启用时用一个永远返回 null 的查询器，确保任何验款都失败（Fail-Closed）
    this.query = query || (async () => null);
    this.store = options?.store || new MemoryPaymentStore();
  }

  /** 注入持久化后端（与 X402PaymentEngine 共享同一存储） */
  public setStore(store: PaymentStore): void {
    this.store = store;
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  /** 查询并校验一笔支付 */
  public async verify(signature: string, expected: ExpectedPayment): Promise<VerifyResult> {
    if (!this.enabled) {
      return {
        valid: false,
        error:
          'On-chain payment verification is disabled (no Solana RPC configured). ' +
          'Set CHAIN_EXECUTION_MODE=real and provide SOLANA_DEVNET_RPC to enable.',
      };
    }

    if (!signature || signature.length < 30) {
      return { valid: false, error: 'Malformed transaction signature' };
    }

    // 防重放：同一签名只能用一次（持久化，跨重启有效）
    if (await this.store.isConsumed(signature)) {
      return { valid: false, error: 'Payment signature has already been consumed (replay blocked)' };
    }

    let fact: OnChainPaymentFact | null;
    try {
      fact = await this.query(signature);
    } catch (err) {
      return { valid: false, error: `Failed to fetch transaction: ${(err as Error).message}` };
    }

    if (!fact) {
      return { valid: false, error: 'Transaction not found on-chain' };
    }

    const result = validatePaymentFact(fact, expected);
    if (result.valid) {
      await this.store.markConsumed(signature);
    }
    return result;
  }

  /** 仅用于测试：手动标记签名已消费 */
  public markConsumed(signature: string): void {
    void this.store.markConsumed(signature);
  }

  /** 已消费签名数量（用于观测） */
  public async consumedCount(): Promise<number> {
    return this.store.consumedCount();
  }
}
