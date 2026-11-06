/**
 * 链上交易执行器（Chain Executor）
 *
 * ## 双模式设计
 *
 * | 模式 | 触发条件 | 行为 |
 * | :--- | :--- | :--- |
 * | `simulation` | 默认（未配置 `CHAIN_EXECUTION_MODE=real`） | 只构造指令、返回模拟签名，不联网不上链 |
 * | `real` | `CHAIN_EXECUTION_MODE=real` | 真实构造交易、签名、广播、等待确认 |
 *
 * **为什么默认是 simulation**：让开发、演示、CI 测试无需真实资金即可跑通全链路；
 * 只有显式开启 real 模式才触碰真实资金，避免误操作烧钱。
 *
 * ## 安全约束
 *
 * - 真实模式下必须先通过沙盒风控（1.5 SOL 上限等）
 * - 任何失败都返回明确错误，不做静默降级
 * - 私钥只在进程内存中使用，绝不落盘或写日志
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import {
  buildCreateTokenInstruction,
  buildRegisterPassportInstruction,
  buildBuyCurveInstruction,
  buildSellCurveInstruction,
  buildCreateAtaInstruction,
  deriveAgentPassportPda,
  deriveAssociatedTokenAddress,
  generateMintKeypair,
  LAUNCH_FEE_LAMPORTS,
} from './launchpad_ix';

export type ExecutionMode = 'simulation' | 'real';

/** 买卖交易执行结果 */
export interface TradeExecuteResult {
  /** 执行模式 */
  mode: ExecutionMode;
  /** 交易方向 */
  side: 'BUY' | 'SELL';
  /** 交易签名（模拟模式下为占位符） */
  txSignature: string;
  /** 是否真实上链 */
  onChain: boolean;
  /** 代币 Mint 地址 */
  mint: string;
  /** 联合曲线 PDA 地址 */
  bondingCurvePda: string;
  /** 买方/卖方关联代币账户地址 */
  tokenAccount: string;
  /** 本次交易抽取的手续费（lamports，字符串避免精度丢失） */
  feeLamports: string;
  /** 失败时的错误信息 */
  error?: string;
}

export interface ChainExecutorConfig {
  mode: ExecutionMode;
  programId: PublicKey;
  feeReceiver: PublicKey;
  connection?: Connection;
}

export interface ExecuteResult {
  /** 执行模式 */
  mode: ExecutionMode;
  /** 交易签名（模拟模式下为占位符） */
  txSignature: string;
  /** 是否真实上链 */
  onChain: boolean;
  /** 新代币 Mint 地址 */
  mint: string;
  /** 联合曲线 PDA 地址 */
  bondingCurvePda: string;
  /** 内盘代币金库 PDA */
  poolTokenPda: string;
  /** 已收取的发行费（lamports） */
  launchFeeLamports: string;
  /** 失败时的错误信息 */
  error?: string;
}

/**
 * 从环境变量解析执行配置。
 *
 * @throws 当 `CHAIN_EXECUTION_MODE=real` 但关键配置缺失时抛出明确错误
 */
export function resolveExecutorConfig(connection?: Connection): ChainExecutorConfig {
  const rawMode = (process.env.CHAIN_EXECUTION_MODE || 'simulation').toLowerCase();
  const mode: ExecutionMode = rawMode === 'real' ? 'real' : 'simulation';

  const programIdStr = process.env.GANG_PROGRAM_ID || 'GangLaunchpad111111111111111111111111111111';
  const feeReceiverStr = process.env.GANG_PROTOCOL_FEE_RECEIVER_SOLANA || '';

  if (mode === 'real') {
    if (!feeReceiverStr) {
      throw new Error(
        '[ChainExecutor] CHAIN_EXECUTION_MODE=real 但未配置 GANG_PROTOCOL_FEE_RECEIVER_SOLANA。' +
          '拒绝启动，避免把发行费打入默认地址。',
      );
    }
    if (!connection) {
      throw new Error('[ChainExecutor] CHAIN_EXECUTION_MODE=real 但未提供 Solana 连接。');
    }
  }

  return {
    mode,
    programId: new PublicKey(programIdStr),
    // 模拟模式下允许空地址，用一个占位 pubkey 保证指令构造不崩溃
    feeReceiver: feeReceiverStr
      ? new PublicKey(feeReceiverStr)
      : new PublicKey('11111111111111111111111111111111'),
    connection,
  };
}

/**
 * 链上交易执行器。
 *
 * 负责：指令构造 → 交易签名 → 广播 → 确认，并在模拟模式下提供等价的可观测结果。
 */
export class ChainExecutor {
  private config: ChainExecutorConfig;

  constructor(config: ChainExecutorConfig) {
    this.config = config;
  }

  public getMode(): ExecutionMode {
    return this.config.mode;
  }

  public getProgramId(): PublicKey {
    return this.config.programId;
  }

  public getFeeReceiver(): PublicKey {
    return this.config.feeReceiver;
  }

  /**
   * 确保 Agent 的 Passport PDA 已在链上存在，不存在则自动注册。
   *
   * 真实模式下这是发币的必要前置条件（合约会校验 Passport）。
   */
  public async ensurePassport(
    creator: Keypair,
    soulDomain: string,
  ): Promise<{ created: boolean; signature?: string; pda: string }> {
    const [passportPda] = deriveAgentPassportPda(creator.publicKey, this.config.programId);
    const pdaStr = passportPda.toBase58();

    if (this.config.mode === 'simulation') {
      return { created: false, pda: pdaStr };
    }

    const connection = this.config.connection!;
    const existing = await connection.getAccountInfo(passportPda);
    if (existing) {
      return { created: false, pda: pdaStr };
    }

    const ix = buildRegisterPassportInstruction(
      creator.publicKey,
      this.config.programId,
      soulDomain,
    );
    const tx = new Transaction().add(ix);
    const signature = await sendAndConfirmTransaction(connection, tx, [creator], {
      commitment: 'confirmed',
      maxRetries: 3,
    });

    return { created: true, signature, pda: pdaStr };
  }

  /**
   * 创建并发行一个新代币。
   *
   * 真实模式下会：
   * 1. 自动确保 Passport 存在
   * 2. 构造 create_token 指令（含 0.02 SOL 发行费转账）
   * 3. 用 creator + mint 双签名广播
   *
   * 模拟模式下只计算 PDA 与费用，返回等价的占位结果。
   */
  public async createToken(params: {
    creator: Keypair;
    name: string;
    symbol: string;
    uri: string;
    soulDomain?: string;
    totalSupply?: bigint;
    targetSolGraduation?: bigint;
    /** 可选：外部已生成的 mint keypair（便于测试断言） */
    mintKeypair?: Keypair;
  }): Promise<ExecuteResult> {
    const mintKeypair = params.mintKeypair || generateMintKeypair();
    const mintAddress = mintKeypair.publicKey.toBase58();

    // 构造指令（模拟模式也构造，用于验证参数与 PDA 派生是否正确）
    const ix = buildCreateTokenInstruction({
      creator: params.creator.publicKey,
      mint: mintKeypair.publicKey,
      feeReceiver: this.config.feeReceiver,
      programId: this.config.programId,
      name: params.name,
      symbol: params.symbol,
      uri: params.uri,
      totalSupply: params.totalSupply,
      targetSolGraduation: params.targetSolGraduation,
    });

    const curvePda = ix.keys[3].pubkey.toBase58();
    const poolPda = ix.keys[4].pubkey.toBase58();

    // 模拟模式：不联网，直接返回占位签名
    if (this.config.mode === 'simulation') {
      return {
        mode: 'simulation',
        txSignature: `sim_launch_${Date.now()}_${mintAddress.slice(0, 8)}`,
        onChain: false,
        mint: mintAddress,
        bondingCurvePda: curvePda,
        poolTokenPda: poolPda,
        launchFeeLamports: LAUNCH_FEE_LAMPORTS.toString(),
      };
    }

    // 真实模式
    const connection = this.config.connection!;
    try {
      // 前置：确保 Passport 存在
      await this.ensurePassport(params.creator, params.soulDomain || 'agent.soul');

      const tx = new Transaction().add(ix);
      const signature = await sendAndConfirmTransaction(
        connection,
        tx,
        [params.creator, mintKeypair],
        { commitment: 'confirmed', maxRetries: 3 },
      );

      return {
        mode: 'real',
        txSignature: signature,
        onChain: true,
        mint: mintAddress,
        bondingCurvePda: curvePda,
        poolTokenPda: poolPda,
        launchFeeLamports: LAUNCH_FEE_LAMPORTS.toString(),
      };
    } catch (err) {
      return {
        mode: 'real',
        txSignature: '',
        onChain: false,
        mint: mintAddress,
        bondingCurvePda: curvePda,
        poolTokenPda: poolPda,
        launchFeeLamports: LAUNCH_FEE_LAMPORTS.toString(),
        error: (err as Error).message,
      };
    }
  }

  /**
   * 执行买入操作（buy_curve）。
   *
   * 真实模式下会：
   * 1. 自动确保 Passport 与买方 ATA 存在
   * 2. 构造 buy_curve 指令（含手续费真实转账与代币划转）
   * 3. 广播并等待确认
   *
   * 模拟模式下只构造指令、计算 PDA，返回等价占位结果。
   */
  public async buyCurve(params: {
    buyer: Keypair;
    mint: PublicKey;
    solAmountLamports: bigint;
    minTokensOut?: bigint;
    note: string;
    soulDomain?: string;
  }): Promise<TradeExecuteResult> {
    const { buyer, mint, solAmountLamports, minTokensOut = 0n, note } = params;

    const ix = buildBuyCurveInstruction({
      buyer: buyer.publicKey,
      mint,
      solAmountLamports,
      minTokensOut,
      note,
      feeReceiver: this.config.feeReceiver,
      programId: this.config.programId,
    });

    const bondingCurvePda = ix.keys[2].pubkey.toBase58();
    const buyerTokenAccount = deriveAssociatedTokenAddress(buyer.publicKey, mint).toBase58();
    const feeLamports = (solAmountLamports * 100n) / 10000n; // 1% 手续费

    if (this.config.mode === 'simulation') {
      return {
        mode: 'simulation',
        side: 'BUY',
        txSignature: `sim_buy_${Date.now()}_${mint.toBase58().slice(0, 6)}`,
        onChain: false,
        mint: mint.toBase58(),
        bondingCurvePda,
        tokenAccount: buyerTokenAccount,
        feeLamports: feeLamports.toString(),
      };
    }

    const connection = this.config.connection!;
    try {
      await this.ensurePassport(buyer, params.soulDomain || 'agent.soul');

      // 前置：买方 ATA 必须存在才能接收代币
      const ataTx = new Transaction().add(
        buildCreateAtaInstruction(buyer.publicKey, buyer.publicKey, mint),
      );
      await sendAndConfirmTransaction(connection, ataTx, [buyer], {
        commitment: 'confirmed',
        maxRetries: 3,
      });

      const tx = new Transaction().add(ix);
      const signature = await sendAndConfirmTransaction(connection, tx, [buyer], {
        commitment: 'confirmed',
        maxRetries: 3,
      });

      return {
        mode: 'real',
        side: 'BUY',
        txSignature: signature,
        onChain: true,
        mint: mint.toBase58(),
        bondingCurvePda,
        tokenAccount: buyerTokenAccount,
        feeLamports: feeLamports.toString(),
      };
    } catch (err) {
      return {
        mode: 'real',
        side: 'BUY',
        txSignature: '',
        onChain: false,
        mint: mint.toBase58(),
        bondingCurvePda,
        tokenAccount: buyerTokenAccount,
        feeLamports: feeLamports.toString(),
        error: (err as Error).message,
      };
    }
  }

  /**
   * 执行卖出操作（sell_curve）。
   *
   * 真实模式下会：
   * 1. 确保 Passport 与卖方 ATA 存在
   * 2. 构造 sell_curve 指令（收回代币、支付 SOL、抽手续费）
   * 3. 广播并等待确认
   */
  public async sellCurve(params: {
    seller: Keypair;
    mint: PublicKey;
    tokenAmount: bigint;
    minSolOut?: bigint;
    note: string;
    soulDomain?: string;
    /** 本次卖出换回的 SOL 总额（lamports），用于计算 1% 手续费 */
    grossSolLamports?: bigint;
  }): Promise<TradeExecuteResult> {
    const { seller, mint, tokenAmount, minSolOut = 0n, note } = params;

    const ix = buildSellCurveInstruction({
      seller: seller.publicKey,
      mint,
      tokenAmount,
      minSolOut,
      note,
      feeReceiver: this.config.feeReceiver,
      programId: this.config.programId,
    });

    const bondingCurvePda = ix.keys[2].pubkey.toBase58();
    const sellerTokenAccount = deriveAssociatedTokenAddress(seller.publicKey, mint).toBase58();
    // 卖出同样抽取 1% 手续费（与合约 calculate_sell_sol_out 保持一致）
    const feeLamports = params.grossSolLamports
      ? (params.grossSolLamports * 100n) / 10000n
      : 0n;

    if (this.config.mode === 'simulation') {
      return {
        mode: 'simulation',
        side: 'SELL',
        txSignature: `sim_sell_${Date.now()}_${mint.toBase58().slice(0, 6)}`,
        onChain: false,
        mint: mint.toBase58(),
        bondingCurvePda,
        tokenAccount: sellerTokenAccount,
        feeLamports: feeLamports.toString(),
      };
    }

    const connection = this.config.connection!;
    try {
      await this.ensurePassport(seller, params.soulDomain || 'agent.soul');

      const tx = new Transaction().add(ix);
      const signature = await sendAndConfirmTransaction(connection, tx, [seller], {
        commitment: 'confirmed',
        maxRetries: 3,
      });

      return {
        mode: 'real',
        side: 'SELL',
        txSignature: signature,
        onChain: true,
        mint: mint.toBase58(),
        bondingCurvePda,
        tokenAccount: sellerTokenAccount,
        feeLamports: '0',
      };
    } catch (err) {
      return {
        mode: 'real',
        side: 'SELL',
        txSignature: '',
        onChain: false,
        mint: mint.toBase58(),
        bondingCurvePda,
        tokenAccount: sellerTokenAccount,
        feeLamports: '0',
        error: (err as Error).message,
      };
    }
  }

  /**
   * 查询指定账户的 SOL 余额（仅真实模式可用）。
   */
  public async getBalance(pubkey: PublicKey): Promise<number> {
    if (this.config.mode !== 'real' || !this.config.connection) {
      return 0;
    }
    const lamports = await this.config.connection.getBalance(pubkey);
    return lamports / LAMPORTS_PER_SOL;
  }

  /**
   * 健康检查：真实模式下探测 RPC 连通性。
   */
  public async healthCheck(): Promise<{ ok: boolean; mode: ExecutionMode; detail: string }> {
    if (this.config.mode !== 'real') {
      return { ok: true, mode: 'simulation', detail: '模拟模式：不联网，不消耗资金' };
    }
    try {
      const slot = await this.config.connection!.getSlot();
      return { ok: true, mode: 'real', detail: `RPC 在线，当前 slot=${slot}` };
    } catch (err) {
      return { ok: false, mode: 'real', detail: `RPC 不可达: ${(err as Error).message}` };
    }
  }
}
