/**
 * x402 动态档位定价表 (Dynamic Tier Pricing)
 *
 * Alpha 信号按档位差异化计价：越高档位，信号置信度/覆盖深度越高，单价越贵。
 * 价格以「SOL + USDC 双报价」给出，网关按账单资产（asset）选择结算币种。
 *
 * 设计要点：
 * - 纯数据 + 纯函数，无副作用，可完整单测；
 * - 未知档位安全回退到默认档（PREMIUM_ALPHA_SNIPER），绝不抛错；
 * - 价格集中在此处维护，避免散落在网关多处硬编码。
 */

import type { PaymentAsset } from './middleware';

/** 支持的定价档位 */
export type SignalTier =
  | 'STANDARD_ALPHA'
  | 'PREMIUM_ALPHA_SNIPER'
  | 'WHALE_ALPHA'
  | 'INSTITUTIONAL';

export interface TierPrice {
  /** 档位展示名 */
  label: string;
  /** SOL 报价 */
  sol: number;
  /** USDC 报价 */
  usdc: number;
  /** 该档位提供的信号能力说明 */
  description: string;
  /** 该档位返回的信号条数 */
  signalCount: number;
}

/** 全量档位定价表 */
export const TIER_PRICING: Record<SignalTier, TierPrice> = {
  STANDARD_ALPHA: {
    label: 'Standard Alpha',
    sol: 0.002,
    usdc: 0.1,
    description: '基础 Alpha 流：WHALE_ACCUMULATION + BREAKOUT_MOMENTUM 两条信号',
    signalCount: 1,
  },
  PREMIUM_ALPHA_SNIPER: {
    label: 'Premium Alpha Sniper',
    sol: 0.005,
    usdc: 0.25,
    description: '高阶狙击流：含 SOL 与 0x.SOUL 双资产动量 + 推荐买入区间',
    signalCount: 2,
  },
  WHALE_ALPHA: {
    label: 'Whale Alpha',
    sol: 0.02,
    usdc: 1.0,
    description: '巨鲸级流：深度智能资金流入追踪 + Hold Line 防御位实时测算',
    signalCount: 3,
  },
  INSTITUTIONAL: {
    label: 'Institutional',
    sol: 0.1,
    usdc: 5.0,
    description: '机构级全量流：全策略集群推理 + 毕业曲线套利窗口 + 优先 Jito 打包',
    signalCount: 5,
  },
};

export const DEFAULT_TIER: SignalTier = 'PREMIUM_ALPHA_SNIPER';

/** 全部合法档位名（用于白名单校验） */
export const VALID_TIERS: ReadonlySet<string> = new Set(
  Object.keys(TIER_PRICING) as SignalTier[],
);

/**
 * 解析并校验请求中的档位。
 * - 非法 / 缺失 → 回退到默认档位（安全，不抛错）
 * - 返回规范化后的档位名与对应价格
 */
export function resolveTier(requested?: string): {
  tier: SignalTier;
  price: TierPrice;
} {
  const normalized = (requested || '').toUpperCase().trim();
  const tier: SignalTier = (VALID_TIERS.has(normalized)
    ? normalized
    : DEFAULT_TIER) as SignalTier;
  return { tier, price: TIER_PRICING[tier] };
}

/** 按资产返回该档位的报价（SOL 或 USDC） */
export function priceForAsset(price: TierPrice, asset: PaymentAsset): number {
  return asset === 'USDC' ? price.usdc : price.sol;
}
