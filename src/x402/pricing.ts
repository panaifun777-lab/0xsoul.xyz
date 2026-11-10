/**
 * x402 动态档位定价表 (Dynamic Tier Pricing)
 *
 * Alpha 信号按档位差异化计价：越高档位，信号置信度/覆盖深度越高，单价越贵。
 *
 * 定价锚设计（修复「SOL 隐含锚 $50」漏洞）：
 * - USDC 为唯一权威报价（美元稳定币，锚定 $1.00）；
 * - SOL 报价不再写死，而是由 USDC 价 ÷ 实时 SOL/USD 市场价 动态折算，
 *   因此 SOL 支付始终等价于 USDC 报价，不会随 SOL 市价漂移而系统性多/少付；
 * - SOL/USD 市场价默认 $86.36，可通过环境变量 SOL_USD_PRICE 覆盖（部署时按实时市价注入）。
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
  /** USDC 报价（定价锚，权威） */
  usdc: number;
  /** 该档位提供的信号能力说明 */
  description: string;
  /** 该档位返回的信号条数 */
  signalCount: number;
}

/** SOL/USD 默认市场价（美元）。部署时应通过 SOL_USD_PRICE 环境变量按实时市价覆盖。 */
const DEFAULT_SOL_USD_PRICE = 86.36;

/** 读取 SOL/USD 市场价：优先环境变量覆盖，否则回退默认值。 */
export function getSolUsdPrice(): number {
  const env = Number(process.env.SOL_USD_PRICE);
  return Number.isFinite(env) && env > 0 ? env : DEFAULT_SOL_USD_PRICE;
}

/** 由 USDC 锚定价折算出的 SOL 报价（实时随 SOL/USD 市场价变化）。 */
export function solAmountFor(price: TierPrice): number {
  return price.usdc / getSolUsdPrice();
}

/** 全量档位定价表（USDC 为权威价，SOL 价由 solAmountFor 动态折算） */
export const TIER_PRICING: Record<SignalTier, TierPrice> = {
  STANDARD_ALPHA: {
    label: 'Standard Alpha',
    usdc: 0.1,
    description: '基础 Alpha 流：WHALE_ACCUMULATION + BREAKOUT_MOMENTUM 两条信号',
    signalCount: 1,
  },
  PREMIUM_ALPHA_SNIPER: {
    label: 'Premium Alpha Sniper',
    usdc: 0.25,
    description: '高阶狙击流：含 SOL 与 0x.SOUL 双资产动量 + 推荐买入区间',
    signalCount: 2,
  },
  WHALE_ALPHA: {
    label: 'Whale Alpha',
    usdc: 1.0,
    description: '巨鲸级流：深度智能资金流入追踪 + Hold Line 防御位实时测算',
    signalCount: 3,
  },
  INSTITUTIONAL: {
    label: 'Institutional',
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

/** 按资产返回该档位的报价（SOL 由 USDC 锚实时折算，USDC 为权威价） */
export function priceForAsset(price: TierPrice, asset: PaymentAsset): number {
  return asset === 'USDC' ? price.usdc : solAmountFor(price);
}
