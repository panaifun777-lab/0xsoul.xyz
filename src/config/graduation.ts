/**
 * 毕业门槛统一配置（单一事实源 Single Source of Truth）
 *
 * 行业对标说明（2026-11 市场行情）：
 * - pump.fun  / gang.fun : 约 85 SOL（约 $17,000 USD）
 * - Moonshot             : 约 2.5 SOL（极低门槛，速度优先）
 * - Raydium LaunchPad    : 自定义 5~50 SOL
 *
 * 本系统默认采用 STANDARD = 50 SOL（约 $10,000 USD），同时保留
 * MICRO（30 SOL）与 WHALE（85 SOL）两档，可通过环境变量
 * GRADUATION_TIER 切换，或在链上 GlobalConfig PDA 中按代币单独覆盖。
 */

export type GraduationTier = 'MICRO' | 'STANDARD' | 'WHALE' | 'SUPER_WHALE';

export interface GraduationTierConfig {
  tier: GraduationTier;
  /** 毕业目标金额（SOL） */
  targetSol: number;
  /** 中文档位标签 */
  labelZh: string;
  /** 英文档位标签 */
  labelEn: string;
  /** 毕业时注入 DEX 的手续费（SOL） */
  dexInjectionFeeSol: number;
  /** 目标定位说明 */
  positioningZh: string;
}

export const GRADUATION_TIERS: Record<GraduationTier, GraduationTierConfig> = {
  MICRO: {
    tier: 'MICRO',
    targetSol: 25,
    labelZh: '超微盘极速',
    labelEn: 'Ultra Micro (25 SOL)',
    dexInjectionFeeSol: 0.25,
    positioningZh: '对标 BANG.fun 原生微盘，极速毕业迁移 DEX，约 $5,000 USD',
  },
  STANDARD: {
    tier: 'STANDARD',
    targetSol: 50,
    labelZh: '标准毕业',
    labelEn: 'Standard (50 SOL)',
    dexInjectionFeeSol: 0.5,
    positioningZh: '系统默认档位，流动性与参与门槛的最佳平衡，约 $10,000 USD',
  },
  WHALE: {
    tier: 'WHALE',
    targetSol: 85,
    labelZh: '巨鲸满标',
    labelEn: 'Whale Cap (85 SOL)',
    dexInjectionFeeSol: 0.85,
    positioningZh: '对齐 gang.fun / pump.fun 传统标准，约 $17,000 USD',
  },
  SUPER_WHALE: {
    tier: 'SUPER_WHALE',
    targetSol: 150,
    labelZh: '深度超级池',
    labelEn: 'Super Whale (150 SOL)',
    dexInjectionFeeSol: 1.5,
    positioningZh: '专为高市值机构项目与高流动性做市 Agent 打造，约 $30,000 USD',
  },
};

/**
 * 解析当前生效的毕业门槛档位
 * 优先级：显式参数 > 环境变量 GRADUATION_TIER > GRADUATION_TARGET_SOL > 默认 STANDARD
 */
export function resolveGraduationTier(explicit?: GraduationTier): GraduationTierConfig {
  if (explicit && GRADUATION_TIERS[explicit]) {
    return GRADUATION_TIERS[explicit];
  }

  const envTier = (process.env.GRADUATION_TIER || '').toUpperCase() as GraduationTier;
  if (envTier && GRADUATION_TIERS[envTier]) {
    return GRADUATION_TIERS[envTier];
  }

  const envTarget = Number(process.env.GRADUATION_TARGET_SOL);
  if (Number.isFinite(envTarget) && envTarget > 0) {
    const matched = Object.values(GRADUATION_TIERS).find((t) => t.targetSol === envTarget);
    if (matched) return matched;
    // 自定义金额：回落到 STANDARD 的元数据，但使用自定义目标
    return { ...GRADUATION_TIERS.STANDARD, targetSol: envTarget };
  }

  return GRADUATION_TIERS.STANDARD;
}

/** 当前生效的毕业目标金额（SOL） */
export function getGraduationTargetSol(explicit?: GraduationTier): number {
  return resolveGraduationTier(explicit).targetSol;
}

/** 计算联合曲线进度百分比（0~100，保留两位） */
export function calcCurveProgress(totalRaisedSol: number, explicit?: GraduationTier): number {
  const target = getGraduationTargetSol(explicit);
  if (target <= 0) return 0;
  return Math.min(100, Number(((totalRaisedSol / target) * 100).toFixed(2)));
}

/* ------------------------------------------------------------------ */
/* 协议收益配置（严禁硬编码，全部由环境变量注入）                        */
/* ------------------------------------------------------------------ */

/**
 * 协议收益配置。
 *
 * 安全铁律：收益地址不硬编码在源码中，一律通过环境变量注入；
 * Solana 侧权威归属由链上 GlobalConfig PDA 存储，受 Squads v4 多签治理保护。
 */
export interface ProtocolRevenueConfig {
  /** EVM 侧（Arc L1）USDC 收款地址 */
  evmBeneficiary: string;
  /** Solana 侧 SOL/SPL 收款地址 */
  solanaBeneficiary: string;
  /** 代币发行创建费（SOL） */
  launchFeeSol: number;
  /** 交易手续费中归协议金库的比例（bps，总手续费为 100 bps = 1%） */
  protocolFeeBps: number;
}

export function getProtocolRevenueConfig(): ProtocolRevenueConfig {
  return {
    evmBeneficiary: process.env.GANG_PROTOCOL_FEE_RECEIVER_EVM || '',
    solanaBeneficiary: process.env.GANG_PROTOCOL_FEE_RECEIVER_SOLANA || '',
    launchFeeSol: Number(process.env.GANG_LAUNCH_FEE_SOL || 0.02),
    protocolFeeBps: Number(process.env.GANG_PROTOCOL_FEE_BPS || 20),
  };
}

/** 基础交易手续费基点 (100 bps = 1%) */
export const BASE_TRADING_FEE_BPS = 100;
/** 反狙击初始最高开盘费 (5000 bps = 50%) */
export const ANTI_SNIPE_MAX_FEE_BPS = 5000;
/** 反狙击费率线性衰减时长 (120 秒) */
export const ANTI_SNIPE_DECAY_SECONDS = 120;

/**
 * 计算反狙击动态手续费率 (bps)
 * @param createdAtSeconds 代币联合曲线创建的 Unix 秒级时间戳
 * @param currentTimestampSeconds 当前交易的 Unix 秒级时间戳 (默认当前时间)
 * @param isCreator 是否为代币发行者 (首发 bundle 享有豁免，直接为基础费率 1%)
 */
export function calculateDynamicAntiSnipeFeeBps(
  createdAtSeconds: number,
  currentTimestampSeconds: number = Math.floor(Date.now() / 1000),
  isCreator: boolean = false,
): number {
  if (isCreator) {
    return BASE_TRADING_FEE_BPS; // 创作者豁免 1%
  }
  const elapsed = Math.max(0, currentTimestampSeconds - createdAtSeconds);
  if (elapsed >= ANTI_SNIPE_DECAY_SECONDS) {
    return BASE_TRADING_FEE_BPS; // 120s 后完全衰减为 1%
  }
  const delta = ANTI_SNIPE_MAX_FEE_BPS - BASE_TRADING_FEE_BPS;
  const remaining = ANTI_SNIPE_DECAY_SECONDS - elapsed;
  const extra = Math.floor((delta * remaining) / ANTI_SNIPE_DECAY_SECONDS);
  return BASE_TRADING_FEE_BPS + extra;
}

/** 校验收益配置是否已完整注入（生产环境启动自检） */
export function validateRevenueConfig(): { ok: boolean; missing: string[] } {
  const cfg = getProtocolRevenueConfig();
  const missing: string[] = [];
  if (!cfg.evmBeneficiary) missing.push('GANG_PROTOCOL_FEE_RECEIVER_EVM');
  if (!cfg.solanaBeneficiary) missing.push('GANG_PROTOCOL_FEE_RECEIVER_SOLANA');
  return { ok: missing.length === 0, missing };
}
