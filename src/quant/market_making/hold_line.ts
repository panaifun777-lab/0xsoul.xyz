import { MarketMakerExecutionReport } from './types';
import { MAX_WALLET_CAP_TOKENS } from '../../config/tokenomics';

export interface HoldLineConfig {
  defensePriceSol: number;      // 目标守线价格 (SOL/Token)
  toleranceBps: number;         // 容忍偏离度 (例如 300 bps = 3%)
  defenseOrderBudgetSol: number; // 每次托盘最大预算 (<= 1.5 SOL 沙盒上限)
  minHoldLineDays: number;      // 需维持守线天数以捕获全部 Token-2022 手续费
  maxInventoryTokens: number;   // 1% 单钱包持仓硬顶（= 总供应 1%，单一事实源 config/tokenomics）
  trancheRatio: number;         // 单次阶梯托盘比例 (默认 0.25，分批托盘)
}

export const DEFAULT_HOLD_LINE_CONFIG: HoldLineConfig = {
  defensePriceSol: 0.00000003, // 3e-8 SOL
  toleranceBps: 200,            // 2%
  defenseOrderBudgetSol: 0.4,
  minHoldLineDays: 3,
  maxInventoryTokens: MAX_WALLET_CAP_TOKENS,
  trancheRatio: 0.25,
};

/**
 * Hold Line 守线做市策略 (Hold Line Defense Maker)
 * 职责：
 * 1. 监控代币价格是否接近或跌破防线阈值
 * 2. 当价格下探时自动触发分批阶梯式挂单买入托盘，稳定市场共识
 * 3. 严格遵循 1% 单钱包持仓上限风控
 * 4. 满足 Token-2022 TransferFee 持仓守线资格，持续捕获外部交易手续费分红
 */
export class HoldLineDefenseMaker {
  private config: HoldLineConfig;
  private consecutiveDefendedHours: number = 0;

  constructor(config: HoldLineConfig = DEFAULT_HOLD_LINE_CONFIG) {
    this.config = config;
  }

  /**
   * 评估是否需要触发守线托盘买入 (受到 1% 持仓限额约束与分批阶梯托盘保护)
   */
  public evaluateDefense(
    currentPrice: number,
    mint: string,
    agentIndex: number,
    currentHoldingTokens: number = 0
  ): MarketMakerExecutionReport | null {
    const defenseTriggerPrice = this.config.defensePriceSol * (1 + this.config.toleranceBps / 10000);

    // 价格低于触发线，且持仓未达到 1% 上限时，激活防守买入
    if (currentPrice <= defenseTriggerPrice) {
      const remainingCapacityTokens = Math.max(0, this.config.maxInventoryTokens - currentHoldingTokens);
      if (remainingCapacityTokens <= 0) {
        // 当前子钱包持仓已满 1%，受 1% 法律级风控约束跳过此子钱包
        return null;
      }

      // 单次阶梯式托盘容量控制 (每次买入上限为总硬顶的 25%)
      const maxTrancheTokens = Math.floor(this.config.maxInventoryTokens * this.config.trancheRatio);
      const effectiveTokenCap = Math.min(remainingCapacityTokens, maxTrancheTokens);

      const priceGapRatio = (this.config.defensePriceSol - currentPrice) / this.config.defensePriceSol;
      // 根据偏离严重程度自适应计算救市资金 (上限为 defenseOrderBudgetSol)
      const targetBuySol = Math.min(
        this.config.defenseOrderBudgetSol,
        Math.max(0.05, this.config.defenseOrderBudgetSol * (1 + priceGapRatio))
      );

      // 结合阶梯配额确定实际买入代币量与 SOL
      const desiredTokens = targetBuySol / currentPrice;
      const actualTokens = Math.min(effectiveTokenCap, Math.floor(desiredTokens));
      const actualBuySol = Math.min(targetBuySol, Number((actualTokens * currentPrice).toFixed(4)));

      if (actualTokens <= 0 || actualBuySol <= 0) {
        return null;
      }

      return {
        strategy: 'HOLD_LINE_DEFENSE',
        action: 'BUY',
        mint,
        solAmount: actualBuySol,
        tokenAmount: actualTokens,
        price: currentPrice,
        agentIndex,
        reasoningNote: `[HoldLine] Price ${currentPrice.toExponential(3)} fell below defense line ${this.config.defensePriceSol.toExponential(3)}. Deploying support order (Tranche safe: ${actualTokens} tokens).`,
        jitoAttached: true,
        status: 'SUBMITTED',
        timestamp: Date.now(),
      };
    }

    // 价格在防线之上，健康运转
    return null;
  }

  /**
   * 记录维持守线成功时长
   */
  public recordDefenseSuccess(hours = 1) {
    this.consecutiveDefendedHours += hours;
  }

  public isEligibleForToken2022FeeDistribution(): boolean {
    return this.consecutiveDefendedHours >= this.config.minHoldLineDays * 24;
  }
}
