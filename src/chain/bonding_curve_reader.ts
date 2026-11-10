/**
 * 联合曲线链上状态读取器（Bonding Curve On-Chain Reader）
 *
 * 把「毕业进度 / 已筹 SOL / 毕业目标」从网关内存里的硬编码种子值，改为从
 * Solana 链上真实读取：派生 bonding_curve PDA → getAccountInfo → 反序列化。
 *
 * 设计要点：
 * - 单一事实源对齐 `launchpad_ix.ts` 的 `deriveBondingCurvePda(["bonding_curve", mint])`；
 * - 账户布局严格对齐 `programs/gang_launchpad/src/state.rs :: BondingCurveState`
 *   （Borsh 全定长，详见 `deserializeBondingCurve` 的偏移注释）；
 *   若实际部署程序的字段顺序/偏移不同，只需在该函数对齐，调用方无感；
 * - 任何失败（程序为占位名 / 账户不存在 / RPC 超时 / 反序列化异常）都安全回退到
 *   种子值并标注 source:'seed'，绝不抛错、绝不阻塞请求；
 * - 毕业目标（graduationTargetSol）取本系统配置（getGraduationTargetSol，可由
 *   GRADUATION_TARGET_SOL 环境变量覆盖），因不同实现的链上存储偏移不一，统一以
 *   配置为准，避免重复口径。
 */

import { Connection, PublicKey, Commitment } from '@solana/web3.js';
import { deriveBondingCurvePda } from './launchpad_ix';

export interface BondingCurveState {
  /** 数据来源：onchain=链上真实读取；seed=读取失败回退种子值 */
  source: 'onchain' | 'seed';
  totalRaisedSol: number;
  graduationTargetSol: number;
  bondingCurveProgressPercent: number;
  isGraduated: boolean;
  /** 链上真实 SOL 储备（已折算 SOL），仅 onchain 时有意义 */
  onchainRealSolReserves?: number;
  /** 回退原因（仅 seed 时存在），便于排查（占位程序 / 未迁移等） */
  fallbackReason?: string;
}

/** 种子值（与历史显示保持一致，回退时输出不变） */
const SEED_TOTAL_RAISED_SOL = 4.8;
const SEED_TARGET_SOL = 50.0;

/** 初始/回退种子状态（供调用方在未完成首次链上读取前使用） */
export function initialSeedState(): BondingCurveState {
  return seedState('init');
}

function seedState(fallbackReason: string): BondingCurveState {
  return {
    source: 'seed',
    totalRaisedSol: SEED_TOTAL_RAISED_SOL,
    graduationTargetSol: SEED_TARGET_SOL,
    bondingCurveProgressPercent: Math.min(
      100,
      Number(((SEED_TOTAL_RAISED_SOL / SEED_TARGET_SOL) * 100).toFixed(2)),
    ),
    isGraduated: false,
    fallbackReason,
  };
}

function readU64LE(buf: Buffer, offset: number): bigint {
  if (buf.length < offset + 8) {
    throw new Error(`账户数据长度不足，无法读取 u64@${offset}（len=${buf.length}）`);
  }
  return buf.readBigUInt64LE(offset);
}

/**
 * 反序列化 bonding_curve 账户，严格对齐
 * `programs/gang_launchpad/src/state.rs :: BondingCurveState`（Borsh，全定长字段）：
 *   bump u8            @0
 *   mint              32B @1
 *   creator           32B @33
 *   pool_token_balance u64 @65
 *   pool_sol_balance  u64 @73
 *   virtual_sol_reserves u64 @81
 *   virtual_token_reserves u64 @89
 *   target_sol_graduation u64 @97
 *   total_raised      u64 @105   ← 真实已筹 SOL（lamports）
 *   is_graduated      bool @113
 *   launch_mode       u8  @114
 *   created_at        i64 @115
 *   fee_receiver      32B @123
 * 返回：真实已筹 SOL（折算 SOL）、链上毕业目标 SOL、是否已毕业。
 */
export function deserializeBondingCurve(data: Buffer): {
  totalRaisedSol: number;
  targetSol: number;
  isGraduated: boolean;
} {
  const totalRaisedLamports = readU64LE(data, 105); // total_raised @105
  const targetLamports = readU64LE(data, 97); // target_sol_graduation @97
  const isGraduated = data.length > 113 && data[113] === 1;
  return {
    totalRaisedSol: Number(totalRaisedLamports) / 1e9,
    targetSol: Number(targetLamports) / 1e9,
    isGraduated,
  };
}

/**
 * 从链上读取某 mint 的联合曲线状态。
 *
 * @param programId   launchpad 程序 ID（如 GANG_PROGRAM_ID）
 * @param mint        代币 mint 地址（如 TARGET_MINT）
 * @param connection  已配置好的 Solana Connection（优先 Helius）
 * @param graduationTargetSol 毕业目标 SOL（取本系统配置）
 * @param commitment  RPC commitment，默认 confirmed
 * @param timeoutMs   单次读取超时，默认 4000ms
 */
export async function readBondingCurveOnChain(opts: {
  programId: string;
  mint: string;
  connection: Connection;
  graduationTargetSol: number;
  commitment?: Commitment;
  timeoutMs?: number;
}): Promise<BondingCurveState> {
  const {
    programId,
    mint,
    connection,
    graduationTargetSol,
    commitment = 'confirmed',
    timeoutMs = 4000,
  } = opts;

  try {
    const programPk = new PublicKey(programId);
    const mintPk = new PublicKey(mint);
    const [pda] = deriveBondingCurvePda(mintPk, programPk);

    const fetchPromise = connection.getAccountInfo(pda, commitment);
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('RPC getAccountInfo timeout')), timeoutMs),
    );
    const account = await Promise.race([fetchPromise, timeoutPromise]);

    if (!account || !account.data || account.data.length === 0) {
      return seedState('bonding_curve 账户不存在（占位程序或未迁移上链）');
    }

    const buf = Buffer.isBuffer(account.data)
      ? account.data
      : Buffer.from(account.data as Uint8Array);
    const { totalRaisedSol, targetSol, isGraduated } = deserializeBondingCurve(buf);
    const raisedSol = totalRaisedSol;
    // 优先用链上 target_sol_graduation；未写入（=0）时回退本系统配置/种子
    const target =
      targetSol > 0 ? targetSol : graduationTargetSol > 0 ? graduationTargetSol : SEED_TARGET_SOL;
    const pct = Math.min(100, Number(((raisedSol / target) * 100).toFixed(2)));

    return {
      source: 'onchain',
      totalRaisedSol: Number(raisedSol.toFixed(4)),
      graduationTargetSol: target,
      bondingCurveProgressPercent: pct,
      isGraduated,
      onchainRealSolReserves: raisedSol,
    };
  } catch (e: any) {
    return seedState(e?.message ? `${e.message}`.slice(0, 120) : String(e));
  }
}
