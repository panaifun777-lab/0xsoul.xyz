/**
 * GANG.SOUL 合约指令构造器（TypeScript 侧）
 *
 * 严格对齐 `docs/16_CREATE_TOKEN_CONTRACT.md` 冻结契约。
 * 仅负责「构造指令」，不负责签名与广播——那些由 `ChainExecutor` 处理。
 *
 * ## 为什么单独抽一个模块
 *
 * 合约的 Borsh 序列化格式、账户顺序、PDA 种子是**最容易出错**的部分。
 * 把它集中在单一文件、单一路径产出，可以避免网关、脚本、测试三处各写一遍而漂移。
 */

import {
  PublicKey,
  TransactionInstruction,
  Keypair,
  SystemProgram,
} from '@solana/web3.js';

/* ------------------------------------------------------------------ */
/* 常量                                                                */
/* ------------------------------------------------------------------ */

/** SPL Token 程序地址 */
export const SPL_TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
/** 系统程序地址 */
export const SYSTEM_PROGRAM_ID = SystemProgram.programId;
/** 租金 Sysvar 地址 */
export const SYSVAR_RENT_PUBKEY = new PublicKey('SysvarRent111111111111111111111111111111111');

/** 指令标签：create_token（与 Rust lib.rs 分发保持一致） */
export const IX_TAG_CREATE_TOKEN = 7;
/** 指令标签：init_curve */
export const IX_TAG_INIT_CURVE = 6;

/** 代币精度 */
export const TOKEN_DECIMALS = 6;
/** 默认总供应量（10 亿枚固定，含 6 位精度） */
export const DEFAULT_TOTAL_SUPPLY = 1_000_000_000_000_000n;
/** 内盘代币储备（8 亿枚 = 80%） */
export const REAL_TOKEN_RESERVES = 800_000_000_000_000n;
/** 外盘 DEX 播种储备（2 亿枚 = 20%） */
export const DEX_SEED_TOKEN_RESERVES = 200_000_000_000_000n;
/** 发行费（lamports） */
export const LAUNCH_FEE_LAMPORTS = 20_000_000n;

/* ------------------------------------------------------------------ */
/* Borsh 编码工具                                                      */
/* ------------------------------------------------------------------ */

/** 编码 u64（小端） */
function encodeU64(value: bigint | number): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(BigInt(value));
  return buf;
}

/** 编码 u8 */
function encodeU8(value: number): Buffer {
  return Buffer.from([value & 0xff]);
}

/** 编码 Borsh String：u32 长度（小端）+ UTF-8 字节 */
function encodeString(value: string): Buffer {
  const bytes = Buffer.from(value, 'utf8');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32LE(bytes.length, 0);
  return Buffer.concat([lenBuf, bytes]);
}

/* ------------------------------------------------------------------ */
/* PDA 派生                                                            */
/* ------------------------------------------------------------------ */

/** 派生联合曲线 PDA：["bonding_curve", mint] */
export function deriveBondingCurvePda(mint: PublicKey, programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('bonding_curve'), mint.toBuffer()],
    programId,
  );
}

/** 派生内盘代币金库 PDA：["pool_token", mint] */
export function derivePoolTokenPda(mint: PublicKey, programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('pool_token'), mint.toBuffer()],
    programId,
  );
}

/** 派生 AgentPassport PDA：["agent_passport", authority] */
export function deriveAgentPassportPda(authority: PublicKey, programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('agent_passport'), authority.toBuffer()],
    programId,
  );
}

/* ------------------------------------------------------------------ */
/* create_token 指令                                                   */
/* ------------------------------------------------------------------ */

export interface CreateTokenParams {
  /** 发币 Agent 钱包（签名者，支付发行费与租金） */
  creator: PublicKey;
  /** 新代币 Mint（需客户端生成 Keypair 并作为额外签名者） */
  mint: PublicKey;
  /** 协议发行费收款地址 */
  feeReceiver: PublicKey;
  /** 合约 Program ID */
  programId: PublicKey;
  /** 代币名称，1~32 字节 */
  name: string;
  /** 代币符号，1~10 字节 */
  symbol: string;
  /** 元数据 URI，1~200 字节 */
  uri: string;
  /** 总供应量（含精度），传 0 或省略则使用默认 10.73 亿枚 */
  totalSupply?: bigint;
  /** 毕业目标（lamports），传 0 或省略则使用合约默认档位 */
  targetSolGraduation?: bigint;
}

/**
 * 构造 `create_token` 指令。
 *
 * 账户顺序必须与 `programs/gang_launchpad/src/instructions/create_token.rs` 严格一致：
 *   0. [signer, writable]  creator
 *   1. []                  agent_passport
 *   2. [signer, writable]  mint
 *   3. [writable]          bonding_curve PDA
 *   4. [writable]          pool_token PDA
 *   5. [writable]          fee_receiver
 *   6. []                  token_program
 *   7. []                  system_program
 *   8. []                  rent
 */
export function buildCreateTokenInstruction(params: CreateTokenParams): TransactionInstruction {
  const {
    creator,
    mint,
    feeReceiver,
    programId,
    name,
    symbol,
    uri,
    totalSupply = 0n,
    targetSolGraduation = 0n,
  } = params;

  // 参数前置校验（与合约端保持一致，早失败早报错）
  if (!name || Buffer.byteLength(name, 'utf8') > 32) {
    throw new Error('Invalid token name: must be 1-32 bytes');
  }
  if (!symbol || Buffer.byteLength(symbol, 'utf8') > 10) {
    throw new Error('Invalid token symbol: must be 1-10 bytes');
  }
  if (!uri || Buffer.byteLength(uri, 'utf8') > 200) {
    throw new Error('Invalid token uri: must be 1-200 bytes');
  }
  if (feeReceiver.equals(PublicKey.default)) {
    throw new Error('feeReceiver must not be the default (all-zero) pubkey');
  }

  const [bondingCurve] = deriveBondingCurvePda(mint, programId);
  const [poolToken] = derivePoolTokenPda(mint, programId);
  const [agentPassport] = deriveAgentPassportPda(creator, programId);

  // 数据布局：tag(1) | name | symbol | uri | decimals(1) | total_supply(8) | target_sol_graduation(8)
  const data = Buffer.concat([
    encodeU8(IX_TAG_CREATE_TOKEN),
    encodeString(name),
    encodeString(symbol),
    encodeString(uri),
    encodeU8(TOKEN_DECIMALS),
    encodeU64(totalSupply),
    encodeU64(targetSolGraduation),
  ]);

  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: creator, isSigner: true, isWritable: true },
      { pubkey: agentPassport, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: true, isWritable: true },
      { pubkey: bondingCurve, isSigner: false, isWritable: true },
      { pubkey: poolToken, isSigner: false, isWritable: true },
      { pubkey: feeReceiver, isSigner: false, isWritable: true },
      { pubkey: SPL_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
    ],
    data,
  });
}

/* ------------------------------------------------------------------ */
/* register_passport 指令（发币前置门禁）                                */
/* ------------------------------------------------------------------ */

export const IX_TAG_REGISTER_PASSPORT = 0;

/**
 * 构造 `register_passport` 指令，为 Agent 注册链上身份。
 *
 * 账户：0. [signer, writable] authority  1. [writable] passport PDA  2. [] system_program
 */
export function buildRegisterPassportInstruction(
  authority: PublicKey,
  programId: PublicKey,
  soulDomain: string,
): TransactionInstruction {
  const [passportPda] = deriveAgentPassportPda(authority, programId);
  const data = Buffer.concat([encodeU8(IX_TAG_REGISTER_PASSPORT), encodeString(soulDomain)]);

  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: authority, isSigner: true, isWritable: true },
      { pubkey: passportPda, isSigner: false, isWritable: true },
      { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data,
  });
}

/* ------------------------------------------------------------------ */
/* 辅助：生成新代币 Mint                                               */
/* ------------------------------------------------------------------ */

/** 生成一个新的代币 Mint Keypair（调用方需作为额外签名者） */
export function generateMintKeypair(): Keypair {
  return Keypair.generate();
}

/* ------------------------------------------------------------------ */
/* buy_curve / sell_curve 指令                                          */
/* ------------------------------------------------------------------ */

/** 指令标签：buy_curve */
export const IX_TAG_BUY_CURVE = 1;
/** 指令标签：sell_curve */
export const IX_TAG_SELL_CURVE = 2;

/** Associated Token Account 程序地址 */
export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
);

/** 派生 AgentPosition PDA：["agent_position", mint, agent] */
export function deriveAgentPositionPda(
  mint: PublicKey,
  agent: PublicKey,
  programId: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('agent_position'), mint.toBuffer(), agent.toBuffer()],
    programId,
  );
}

/** 派生关联代币账户（ATA）地址 */
export function deriveAssociatedTokenAddress(
  owner: PublicKey,
  mint: PublicKey,
  tokenProgramId: PublicKey = SPL_TOKEN_PROGRAM_ID,
): PublicKey {
  const [ata] = PublicKey.findProgramAddressSync(
    [owner.toBuffer(), tokenProgramId.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  return ata;
}

/** 编码固定长度 String（Borsh，u32 长度前缀） */
function encodeNote(note: string): Buffer {
  const trimmed = note.slice(0, 140);
  return encodeString(trimmed);
}

export interface BuyCurveParams {
  /** 买方 Agent 钱包（签名者） */
  buyer: PublicKey;
  /** 代币 Mint */
  mint: PublicKey;
  /** 买入投入的 SOL（lamports） */
  solAmountLamports: bigint;
  /** 最小获得代币量（滑点保护，0 表示不限制） */
  minTokensOut?: bigint;
  /** AI 思考理由，≤140 字节 */
  note: string;
  /** 协议手续费收款地址 */
  feeReceiver: PublicKey;
  /** 合约 Program ID */
  programId: PublicKey;
}

/**
 * 构造 `buy_curve` 指令。
 *
 * 账户顺序（与 `buy_curve.rs` 严格一致）：
 *   0. [signer, writable]  buyer
 *   1. []                  agent_passport
 *   2. [writable]          bonding_curve
 *   3. [writable]          agent_position
 *   4. [writable]          fee_receiver
 *   5. []                  system_program
 *   6. [writable]          pool_token_account
 *   7. [writable]          buyer_token_account
 *   8. []                  token_program
 */
export function buildBuyCurveInstruction(params: BuyCurveParams): TransactionInstruction {
  const { buyer, mint, solAmountLamports, minTokensOut = 0n, note, feeReceiver, programId } = params;

  const [bondingCurve] = deriveBondingCurvePda(mint, programId);
  const [agentPosition] = deriveAgentPositionPda(mint, buyer, programId);
  const [agentPassport] = deriveAgentPassportPda(buyer, programId);
  const [poolToken] = derivePoolTokenPda(mint, programId);
  const buyerTokenAccount = deriveAssociatedTokenAddress(buyer, mint);

  // 数据布局：tag(1) | sol_amount(8) | min_tokens_out(8) | note(String)
  const data = Buffer.concat([
    encodeU8(IX_TAG_BUY_CURVE),
    encodeU64(solAmountLamports),
    encodeU64(minTokensOut),
    encodeNote(note),
  ]);

  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: buyer, isSigner: true, isWritable: true },
      { pubkey: agentPassport, isSigner: false, isWritable: false },
      { pubkey: bondingCurve, isSigner: false, isWritable: true },
      { pubkey: agentPosition, isSigner: false, isWritable: true },
      { pubkey: feeReceiver, isSigner: false, isWritable: true },
      { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: poolToken, isSigner: false, isWritable: true },
      { pubkey: buyerTokenAccount, isSigner: false, isWritable: true },
      { pubkey: SPL_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data,
  });
}

export interface SellCurveParams {
  /** 卖方 Agent 钱包（签名者） */
  seller: PublicKey;
  /** 代币 Mint */
  mint: PublicKey;
  /** 卖出的代币数量（含精度） */
  tokenAmount: bigint;
  /** 最小换回 SOL（lamports，滑点保护） */
  minSolOut?: bigint;
  /** AI 思考理由，≤140 字节 */
  note: string;
  /** 协议手续费收款地址 */
  feeReceiver: PublicKey;
  /** 合约 Program ID */
  programId: PublicKey;
}

/**
 * 构造 `sell_curve` 指令。
 *
 * 账户顺序（与 `sell_curve.rs` 严格一致）：
 *   0. [signer, writable]  seller
 *   1. []                  agent_passport
 *   2. [writable]          bonding_curve
 *   3. [writable]          agent_position
 *   4. [writable]          fee_receiver
 *   5. []                  system_program
 *   6. [writable]          seller_token_account
 *   7. [writable]          pool_token_account
 *   8. []                  token_program
 */
export function buildSellCurveInstruction(params: SellCurveParams): TransactionInstruction {
  const { seller, mint, tokenAmount, minSolOut = 0n, note, feeReceiver, programId } = params;

  const [bondingCurve] = deriveBondingCurvePda(mint, programId);
  const [agentPosition] = deriveAgentPositionPda(mint, seller, programId);
  const [agentPassport] = deriveAgentPassportPda(seller, programId);
  const [poolToken] = derivePoolTokenPda(mint, programId);
  const sellerTokenAccount = deriveAssociatedTokenAddress(seller, mint);

  // 数据布局：tag(1) | token_amount(8) | min_sol_out(8) | note(String)
  const data = Buffer.concat([
    encodeU8(IX_TAG_SELL_CURVE),
    encodeU64(tokenAmount),
    encodeU64(minSolOut),
    encodeNote(note),
  ]);

  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: seller, isSigner: true, isWritable: true },
      { pubkey: agentPassport, isSigner: false, isWritable: false },
      { pubkey: bondingCurve, isSigner: false, isWritable: true },
      { pubkey: agentPosition, isSigner: false, isWritable: true },
      { pubkey: feeReceiver, isSigner: false, isWritable: true },
      { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: sellerTokenAccount, isSigner: false, isWritable: true },
      { pubkey: poolToken, isSigner: false, isWritable: true },
      { pubkey: SPL_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data,
  });
}

/**
 * 构造创建买方/卖方 ATA 的指令（真实上链时必需）。
 *
 * 使用 Associated Token Account 程序的 CreateIdempotent 变体（tag=1），
 * 账户已存在时不会报错，可安全重复调用。
 */
export function buildCreateAtaInstruction(
  payer: PublicKey,
  owner: PublicKey,
  mint: PublicKey,
): TransactionInstruction {
  const ata = deriveAssociatedTokenAddress(owner, mint);

  return new TransactionInstruction({
    programId: ASSOCIATED_TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: ata, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SPL_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: Buffer.from([1]), // CreateIdempotent
  });
}
