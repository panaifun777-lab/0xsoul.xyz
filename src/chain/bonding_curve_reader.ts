/**
 * 联合曲线链上状态读取器（Bonding Curve On-Chain Reader）
 *
 * 把「毕业进度 / 已筹 SOL / 毕业目标」从网关内存里的硬编码种子值，改为从
 * Solana 链上真实读取：派生 bonding_curve PDA → getAccountInfo → 反序列化。
 *
 * 设计要点：
 * - 单一事实源对齐 `launchpad_ix.ts` 的 `deriveBondingCurvePda(["bonding_curve", mint])`；
 * - 账户布局采用 pump.fun 兼容的标准（gang_launchpad 对齐该标准）：
 *     virtual_token_reserves u64(0) | virtual_sol_reserves u64(8) |
 *     real_token_reserves u64(16) | real_sol_reserves u64(24) |
 *     token_total_supply u64(32) | complete bool(40+)
 *   若实际部署程序的字段顺序/偏移不同，只需在此函数对齐，调用方无感；
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
 * 反序列化 bonding_curve 账户（pump.fun 兼容布局）。
 * 返回真实 SOL 储备（lamports）与是否毕业。
 */
export function deserializeBondingCurve(data: Buffer): {
  realSolReserves: bigint;
  complete: boolean;
} {
  const realSolReserves = readU64LE(data, 24); // real_sol_reserves @24
  const complete = data.length > 40 && data[40] === 1;
  return { realSolReserves, complete };
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
    const { realSolReserves, complete } = deserializeBondingCurve(buf);
    const raisedSol = Number(realSolReserves) / 1e9;
    const target = graduationTargetSol > 0 ? graduationTargetSol : SEED_TARGET_SOL;
    const pct = Math.min(100, Number(((raisedSol / target) * 100).toFixed(2)));

    return {
      source: 'onchain',
      totalRaisedSol: Number(raisedSol.toFixed(4)),
      graduationTargetSol: target,
      bondingCurveProgressPercent: pct,
      isGraduated: complete,
      onchainRealSolReserves: raisedSol,
    };
  } catch (e: any) {
    return seedState(e?.message ? `${e.message}`.slice(0, 120) : String(e));
  }
}
