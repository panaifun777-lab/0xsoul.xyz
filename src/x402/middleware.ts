import { FastifyRequest, FastifyReply } from 'fastify';
import { PublicKey } from '@solana/web3.js';
import {
  OnChainPaymentVerifier,
  OnChainPaymentFact,
  solToLamports,
  deriveAssociatedTokenAddress,
  USDC_MAINNET_MINT,
} from './onchain_verifier';
import { PaymentStore, MemoryPaymentStore } from './store';

/** 账单支持的结算资产 */
export type PaymentAsset = 'SOL' | 'USDC';

export interface PaymentInvoice {
  recipientVault: string;
  amountSol: number;
  amountUsdc: number;
  paymentNonce: string;
  expiryTimestamp: number;
  thoughtHash?: string; // 链上思考流哈希 (Thought Stream / --note)
  tier?: string;        // 动态定价档位
  asset: PaymentAsset;  // 结算资产：SOL 或 USDC(SPL)
  usdcMint?: string;    // 当 asset=USDC 时使用的 SPL mint（默认主网 USDC）
}

export interface SettlementReceipt {
  paymentNonce: string;
  txSignature: string;
  payer: string;
  amountSol: number;
  thoughtHash?: string;
  settledAt: number;
  /** 代币结算信息（asset=USDC 时填充） */
  asset?: PaymentAsset;
  amountToken?: number; // 代币数量（已按 decimals 折算为可读小数，如 USDC=0.25）
  tokenSymbol?: string;
  tokenMint?: string;
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
  /** 支付状态持久化层（默认内存，可替换为 Redis） */
  private store: PaymentStore;
  private verifier?: OnChainPaymentVerifier;
  public totalRevenueSol: number = 0;

  constructor(
    recipientVaultAddress?: string,
    options?: { verifier?: OnChainPaymentVerifier; store?: PaymentStore },
  ) {
    this.recipientVault = recipientVaultAddress
      ? new PublicKey(recipientVaultAddress)
      : new PublicKey('11111111111111111111111111111111');
    this.verifier = options?.verifier;
    this.store = options?.store || new MemoryPaymentStore();
    // 让链上验款器的防重放集合也走同一存储，做到跨重启持久
    this.verifier?.setStore(this.store);
  }

  /** 运行时切换持久化后端（如启动时探测到 Redis 后升级） */
  public setStore(store: PaymentStore): void {
    this.store = store;
    this.verifier?.setStore(store);
  }

  /** 当前使用的存储后端类型（用于遥测展示） */
  public getStoreType(): 'memory' | 'redis' {
    return this.store instanceof MemoryPaymentStore ? 'memory' : 'redis';
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
  public async createInvoice(
    costSol = 0.001,
    costUsdc = 0.05,
    ttlSeconds = 180,
    options?: { thoughtHash?: string; tier?: string; asset?: PaymentAsset; usdcMint?: string }
  ): Promise<PaymentInvoice> {
    const paymentNonce = `inv_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    const asset: PaymentAsset = options?.asset === 'USDC' ? 'USDC' : 'SOL';
    const invoice: PaymentInvoice = {
      recipientVault: this.recipientVault.toBase58(),
      amountSol: costSol,
      amountUsdc: costUsdc,
      paymentNonce,
      expiryTimestamp: Date.now() + ttlSeconds * 1000,
      thoughtHash: options?.thoughtHash,
      tier: options?.tier || 'STANDARD_ALPHA_SIGNAL',
      asset,
      usdcMint: asset === 'USDC' ? (options?.usdcMint || USDC_MAINNET_MINT) : undefined,
    };
    await this.store.saveInvoice(paymentNonce, invoice);
    return invoice;
  }

  /**
   * 核验支付交易签名（内存模式，向后兼容）
   *
   * ⚠️ 该模式**不读取链上**，仅校验 nonce 与金额。
   * 生产环境请使用 `verifyPaymentOnChain()`，否则任意字符串都能通过。
   */
  public async verifyPayment(
    paymentNonce: string,
    txSignature: string,
    paidSolAmount?: number
  ): Promise<{ valid: boolean; error?: string }> {
    // 1. 防重放校验（持久化集合，跨重启有效）
    if (await this.store.isConsumed(txSignature)) {
      return { valid: false, error: 'Payment signature has already been used (Replay attack blocked)' };
    }

    // 2. 检查 Invoice 存在性与有效期
    const invoice = await this.store.getInvoice(paymentNonce);
    if (!invoice) {
      return { valid: false, error: 'Invoice nonce not found or already consumed' };
    }

    if (Date.now() > invoice.expiryTimestamp) {
      await this.store.deleteInvoice(paymentNonce);
      return { valid: false, error: 'Payment invoice expired' };
    }

    // 3. 校验金额
    const actualPaid = paidSolAmount ?? invoice.amountSol;
    if (actualPaid < invoice.amountSol) {
      return { valid: false, error: `Insufficient payment: required ${invoice.amountSol} SOL, got ${actualPaid} SOL` };
    }

    // 4. 结算入账并记录带有 Thought Hash 的结算回执
    await this.store.markConsumed(txSignature);
    await this.store.deleteInvoice(paymentNonce);
    this.totalRevenueSol += actualPaid;

    const receipt: SettlementReceipt = {
      paymentNonce,
      txSignature,
      payer: 'memory_sim_payer',
      amountSol: actualPaid,
      thoughtHash: invoice.thoughtHash,
      settledAt: Date.now(),
      asset: invoice.asset,
      amountToken: invoice.asset === 'USDC' ? invoice.amountUsdc : undefined,
      tokenSymbol: invoice.asset === 'USDC' ? 'USDC' : undefined,
      tokenMint: invoice.usdcMint,
    };
    await this.store.saveReceipt(txSignature, receipt);

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
    const invoice = await this.store.getInvoice(paymentNonce);
    if (!invoice) {
      return { valid: false, error: 'Invoice nonce not found or already consumed' };
    }
    if (Date.now() > invoice.expiryTimestamp) {
      await this.store.deleteInvoice(paymentNonce);
      return { valid: false, error: 'Payment invoice expired' };
    }

    // 2. 链上验款（按结算资产选择 SOL 或 USDC(SPL) 校验）
    const result = await this.verifier.verify(
      txSignature,
      invoice.asset === 'USDC'
        ? {
            expectedTokenRecipient: deriveAssociatedTokenAddress(
              invoice.recipientVault,
              invoice.usdcMint || USDC_MAINNET_MINT,
            ),
            expectedTokenMinAmount: BigInt(Math.round(invoice.amountUsdc * 1_000_000)), // USDC 6 位精度
            expectedPayer: options?.expectedPayer,
          }
        : {
            recipient: invoice.recipientVault,
            minLamports: solToLamports(invoice.amountSol),
            expectedPayer: options?.expectedPayer,
          },
    );

    if (!result.valid) {
      return { valid: false, error: result.error, fact: result.fact };
    }

    // 3. 结算入账（金额以链上实际到账为准）并记录带有 Thought Hash 的回执
    const actualSol = result.fact ? Number(result.fact.lamports) / 1_000_000_000 : 0;
    let amountToken: number | undefined;
    let tokenSymbol: string | undefined;
    let tokenMint: string | undefined;
    if (invoice.asset === 'USDC' && result.fact?.tokenTransfers?.length) {
      const ata = deriveAssociatedTokenAddress(
        invoice.recipientVault,
        invoice.usdcMint || USDC_MAINNET_MINT,
      );
      const matched = result.fact.tokenTransfers.find((t) => t.recipient === ata);
      amountToken = matched ? Number(matched.amount) / 1_000_000 : invoice.amountUsdc;
      tokenSymbol = 'USDC';
      tokenMint = invoice.usdcMint || USDC_MAINNET_MINT;
    }
    await this.store.markConsumed(txSignature);
    await this.store.deleteInvoice(paymentNonce);
    this.totalRevenueSol += actualSol;

    const receipt: SettlementReceipt = {
      paymentNonce,
      txSignature,
      payer: options?.expectedPayer || result.fact?.payer || 'unknown_payer',
      amountSol: actualSol,
      thoughtHash: invoice.thoughtHash,
      settledAt: Date.now(),
      asset: invoice.asset,
      amountToken,
      tokenSymbol,
      tokenMint,
    };
    await this.store.saveReceipt(txSignature, receipt);

    return { valid: true, fact: result.fact };
  }

  /** 查询指定交易签名的结算回执（包含 Thought Hash 审计） */
  public async getSettlementReceipt(txSignature: string): Promise<SettlementReceipt | undefined> {
    return this.store.getReceipt(txSignature);
  }
}
