import { ArbitrageOpportunity, MarketMakerExecutionReport } from './types';

export interface GraduationArbitrageConfig {
  minSpreadPercent: number; // 最小套利毛利差 (例如 2.5%)
  maxTradeSol: number;      // 单笔套利上限 (受 1.5 SOL 沙盒约束)
  jitoTipSol: number;       // Jito 防夹捆绑小费 (例如 0.005 SOL)
  dexFeeBps: number;        // Raydium / Meteora DEX 手续费 (例如 25 bps = 0.25%)
}

export const DEFAULT_ARBITRAGE_CONFIG: GraduationArbitrageConfig = {
  minSpreadPercent: 2.5,
  maxTradeSol: 1.2,
  jitoTipSol: 0.005,
  dexFeeBps: 25,
};

/**
 * 85 SOL 毕业内外盘套利引擎 (Graduation Arbitrage Engine)
 * 职责：
 * 1. 监测内盘联合曲线边际价格与外盘 DEX (Raydium CPMM / Meteora DAMM) 深度价格
 * 2. 精确扣除内盘 1% 税率、外盘 0.25% 手续费与 Jito 小费后，测算无风险净套利空间
 * 3. 驱动 3 号套利子钱包发起原子双向 Swap 或单边抢平水交易
 */
export class GraduationArbitrageEngine {
  private config: GraduationArbitrageConfig;

  constructor(config: GraduationArbitrageConfig = DEFAULT_ARBITRAGE_CONFIG) {
    this.config = config;
  }

  /**
   * 探测并计算套利机会
   */
  public detectOpportunity(
    mint: string,
    innerCurvePriceSol: number,
    outerDexPriceSol: number,
    isGraduated: boolean
  ): ArbitrageOpportunity | null {
    if (innerCurvePriceSol <= 0 || outerDexPriceSol <= 0) {
      return null;
    }

    // 价格比对
    const priceDiff = Math.abs(outerDexPriceSol - innerCurvePriceSol);
    const avgPrice = (outerDexPriceSol + innerCurvePriceSol) / 2;
    const spreadPercent = (priceDiff / avgPrice) * 100;

    // 扣除摩擦成本 (内盘 1% + 外盘 0.25% + Jito 估算 0.5% = 1.75%)
    const frictionPercent = 1.75;
    const netProfitPercent = spreadPercent - frictionPercent;

    if (netProfitPercent < this.config.minSpreadPercent) {
      return null; // 利差未覆盖成本与目标收益
    }

    const direction =
      innerCurvePriceSol < outerDexPriceSol
        ? 'BUY_INNER_SELL_OUTER'
        : 'BUY_OUTER_SELL_INNER';

    // 根据利差大小动态分配套利资金 (最高 maxTradeSol)
    const scaleFactor = Math.min(1.0, netProfitPercent / 5.0);
    const optimalTradeSol = Math.max(0.1, Number((this.config.maxTradeSol * scaleFactor).toFixed(3)));
    const estimatedProfitSol = Number(
      (optimalTradeSol * (netProfitPercent / 100) - this.config.jitoTipSol).toFixed(4)
    );

    if (estimatedProfitSol <= 0) {
      return null;
    }

    return {
      mint,
      innerCurvePrice: innerCurvePriceSol,
      outerDexPrice: outerDexPriceSol,
      spreadPercent: Number(spreadPercent.toFixed(2)),
      direction,
      optimalTradeSol,
      estimatedProfitSol,
      confidenceScore: Math.min(0.99, Number((0.8 + netProfitPercent * 0.03).toFixed(2))),
    };
  }

  /**
   * 生成套利执行报告
   */
  public generateArbitrageExecution(
    opp: ArbitrageOpportunity,
    agentIndex: number
  ): MarketMakerExecutionReport {
    return {
      strategy: 'GRADUATION_ARBITRAGE',
      action: 'ARBITRAGE',
      mint: opp.mint,
      solAmount: opp.optimalTradeSol,
      tokenAmount: 0,
      price: opp.innerCurvePrice,
      agentIndex,
      reasoningNote: `[Arb] Spread ${opp.spreadPercent}% (${opp.direction}). Est profit: ${opp.estimatedProfitSol} SOL. Jito Bundle attached.`,
      jitoAttached: true,
      status: 'SUBMITTED',
      timestamp: Date.now(),
    };
  }
}
