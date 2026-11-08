import { FastifyRequest, FastifyReply } from 'fastify';
import { PublicKey } from '@solana/web3.js';
import {
  OnChainPaymentVerifier,
  OnChainPaymentFact,
  solToLamports,
} from './onchain_verifier';

export interface PaymentInvoice {
  recipientVault: string;
  amountSol: number;
  amountUsdc: number;
  paymentNonce: string;
  expiryTimestamp: number;
  thoughtHash?: string; // 链上思考流哈希 (Thought Stream / --note)
  tier?: string;        // 动态定价档位
}

export interface SettlementReceipt {
  paymentNonce: string;
  txSignature: string;
  payer: string;
  amountSol: number;
  thoughtHash?: string;
  settledAt: number;
}

export interface AlphaSignalData {
  mint: string;
  symbol: string;
  signalType: 'BREAKOUT_MOMENTUM' | 'WHALE_ACCUMULATION' | 'HOLD_LINE_DEFENSE';
  confidenceScore: number;
  smartMoneyInflowSol: number;
  recommendedBuyRange: [number, number];
  generatedAt: number;
}

/**
 * x402 链上微支付引擎
 * 为 AI Agent 之间的高价值数据流动提供 HTTP 402 机器原生微结算
 *
 * ## 两种验款模式
 *
 * | 模式 | 触发条件 | 行为 |
 * | :--- | :--- | :--- |
 * | `memory` | 默认（未注入 verifier） | 仅校验 nonce 与金额，**不读取链上**，用于本地演示与 CI |
 * | `onchain` | 注入 `OnChainPaymentVerifier` | 真实调用 `getTransaction` 校验金额/收款方/时间窗/防重放 |
 *
 * 生产环境必须使用 `onchain` 模式，否则任何人都能凭任意字符串免费取数。
 */
export class X402PaymentEngine {
  private recipientVault: PublicKey;
  private pendingInvoices: Map<string, PaymentInvoice> = new Map();
  private processedSignatures: Set<string> = new Set();
  private settlementReceipts: Map<string, SettlementReceipt> = new Map();
  private verifier?: OnChainPaymentVerifier;
  public totalRevenueSol: number = 0;

  constructor(
    recipientVaultAddress?: string,
    options?: { verifier?: OnChainPaymentVerifier },
  ) {
    this.recipientVault = recipientVaultAddress
      ? new PublicKey(recipientVaultAddress)
      : new PublicKey('11111111111111111111111111111111');
    this.verifier = options?.verifier;
  }

  public getRecipientVault(): PublicKey {
    return this.recipientVault;
  }

  /** 当前是否为真实链上验款模式 */
  public isOnChainMode(): boolean {
    return Boolean(this.verifier?.isEnabled());
  }

  /**
   * 生成针对当前请求的微支付账单（支持动态定价与链上思考流绑定）
   */
  public createInvoice(
    costSol = 0.001,
    costUsdc = 0.05,
    ttlSeconds = 180,
    options?: { thoughtHash?: string; tier?: string }
  ): PaymentInvoice {
    const paymentNonce = `inv_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    const invoice: PaymentInvoice = {
      recipientVault: this.recipientVault.toBase58(),
      amountSol: costSol,
      amountUsdc: costUsdc,
      paymentNonce,
      expiryTimestamp: Date.now() + ttlSeconds * 1000,
      thoughtHash: options?.thoughtHash,
      tier: options?.tier || 'STANDARD_ALPHA_SIGNAL',
    };
    this.pendingInvoices.set(paymentNonce, invoice);
    return invoice;
  }

  /**
   * 核验支付交易签名（内存模式，向后兼容）
   *
   * ⚠️ 该模式**不读取链上**，仅校验 nonce 与金额。
   * 生产环境请使用 `verifyPaymentOnChain()`，否则任意字符串都能通过。
   */
  public verifyPayment(
    paymentNonce: string,
    txSignature: string,
    paidSolAmount?: number
  ): { valid: boolean; error?: string } {
    // 1. 防重放校验
    if (this.processedSignatures.has(txSignature)) {
      return { valid: false, error: 'Payment signature has already been used (Replay attack blocked)' };
    }

    // 2. 检查 Invoice 存在性与有效期
    const invoice = this.pendingInvoices.get(paymentNonce);
    if (!invoice) {
      return { valid: false, error: 'Invoice nonce not found or already consumed' };
    }

    if (Date.now() > invoice.expiryTimestamp) {
      this.pendingInvoices.delete(paymentNonce);
      return { valid: false, error: 'Payment invoice expired' };
    }

    // 3. 校验金额
    const actualPaid = paidSolAmount ?? invoice.amountSol;
    if (actualPaid < invoice.amountSol) {
      return { valid: false, error: `Insufficient payment: required ${invoice.amountSol} SOL, got ${actualPaid} SOL` };
    }

    // 4. 结算入账并记录带有 Thought Hash 的结算回执
    this.processedSignatures.add(txSignature);
    this.pendingInvoices.delete(paymentNonce);
    this.totalRevenueSol += actualPaid;

    const receipt: SettlementReceipt = {
      paymentNonce,
      txSignature,
      payer: 'memory_sim_payer',
      amountSol: actualPaid,
      thoughtHash: invoice.thoughtHash,
      settledAt: Date.now(),
    };
    this.settlementReceipts.set(txSignature, receipt);

    return { valid: true };
  }

  /**
   * 核验支付交易签名（真实链上模式）
   *
   * 流程：
   * 1. 校验 Invoice 存在性与有效期（与内存模式一致）
   * 2. 调用链上验款器读取交易，校验金额/收款方/时间窗/防重放
   * 3. 通过后结算入账
   *
   * 未注入验款器或验款器未启用时，**一律拒绝**（Fail-Closed），不会静默降级。
   */
  public async verifyPaymentOnChain(
    paymentNonce: string,
    txSignature: string,
    options?: { expectedPayer?: string },
  ): Promise<{ valid: boolean; error?: string; fact?: OnChainPaymentFact }> {
    if (!this.verifier) {
      return {
        valid: false,
        error: 'On-chain verification not configured. Inject an OnChainPaymentVerifier to enable.',
      };
    }

    // 1. Invoice 校验（与内存模式保持一致）
    const invoice = this.pendingInvoices.get(paymentNonce);
    if (!invoice) {
      return { valid: false, error: 'Invoice nonce not found or already consumed' };
    }
    if (Date.now() > invoice.expiryTimestamp) {
      this.pendingInvoices.delete(paymentNonce);
      return { valid: false, error: 'Payment invoice expired' };
    }

    // 2. 链上验款
    const minLamports = solToLamports(invoice.amountSol);
    const result = await this.verifier.verify(txSignature, {
      recipient: invoice.recipientVault,
      minLamports,
      expectedPayer: options?.expectedPayer,
    });

    if (!result.valid) {
      return { valid: false, error: result.error, fact: result.fact };
    }

    // 3. 结算入账（金额以链上实际到账为准）并记录带有 Thought Hash 的回执
    const actualSol = result.fact ? Number(result.fact.lamports) / 1_000_000_000 : invoice.amountSol;
    this.processedSignatures.add(txSignature);
    this.pendingInvoices.delete(paymentNonce);
    this.totalRevenueSol += actualSol;

    const receipt: SettlementReceipt = {
      paymentNonce,
      txSignature,
      payer: options?.expectedPayer || result.fact?.payer || 'unknown_payer',
      amountSol: actualSol,
      thoughtHash: invoice.thoughtHash,
      settledAt: Date.now(),
    };
    this.settlementReceipts.set(txSignature, receipt);

    return { valid: true, fact: result.fact };
  }

  /** 查询指定交易签名的结算回执（包含 Thought Hash 审计） */
  public getSettlementReceipt(txSignature: string): SettlementReceipt | undefined {
    return this.settlementReceipts.get(txSignature);
  }
}
