/**
 * S2S (Swarm-to-Swarm) 流动性与价格套利计算器
 * 用于做市智能体 (Quant Engine) 计算现货 (x402) 与竞标托管市场 (Task Bidding) 之间的套利空间与盈亏平衡点。
 */

export interface ArbitrageParams {
  spotPriceUsdc: number;      // x402 现货调用价格 (USDC)
  biddingRewardUsdc: number;  // 竞标市场任务报酬 (USDC)
  gasCostUsdc: number;        // 链上往返 gas 成本 (USDC)
  slaPenaltyUsdc: number;     // 若超时违约的 SLA 罚金风险 (USDC)
  executionSuccessProb: number; // 交付成功率 (0.0 - 1.0)
}

export interface ArbitrageResult {
  expectedProfitUsdc: number;
  roiPercent: number;
  isProfitable: boolean;
  recommendedAction: 'EXECUTE' | 'PASS' | 'HIGH_RISK';
}

export class S2SArbitrageCalculator {
  static evaluate(params: ArbitrageParams): ArbitrageResult {
    const {
      spotPriceUsdc,
      biddingRewardUsdc,
      gasCostUsdc,
      slaPenaltyUsdc,
      executionSuccessProb,
    } = params;

    // 期望收益 = 成功概率 * (报酬 - 现货成本 - gas) - (1 - 成功概率) * (SLA罚金 + gas)
    const expectedRevenue = executionSuccessProb * (biddingRewardUsdc - spotPriceUsdc - gasCostUsdc);
    const expectedLoss = (1 - executionSuccessProb) * (slaPenaltyUsdc + gasCostUsdc);
    const expectedProfitUsdc = Number((expectedRevenue - expectedLoss).toFixed(4));

    const totalCost = spotPriceUsdc + gasCostUsdc;
    const roiPercent = totalCost > 0 ? Number(((expectedProfitUsdc / totalCost) * 100).toFixed(2)) : 0;

    let recommendedAction: 'EXECUTE' | 'PASS' | 'HIGH_RISK' = 'PASS';
    if (expectedProfitUsdc > 0.5 && roiPercent > 5) {
      recommendedAction = executionSuccessProb > 0.9 ? 'EXECUTE' : 'HIGH_RISK';
    } else {
      recommendedAction = 'PASS';
    }

    return {
      expectedProfitUsdc,
      roiPercent,
      isProfitable: expectedProfitUsdc > 0,
      recommendedAction,
    };
  }
}
