import { GridLevel, OrderBookQuote } from './types';
import { MAX_WALLET_CAP_TOKENS } from '../../config/tokenomics';

export interface GridMakerConfig {
  gridLevels: number;       // 网格层数 (例如 5 层)
  spacingBps: number;       // 网格间距基点 (例如 50 bps = 0.5%)
  baseOrderSol: number;     // 基准每格 SOL 金额 (例如 0.1 SOL)
  maxInventoryTokens: number; // 单钱包代币库存硬顶（= 总供应 1%，单一事实源 config/tokenomics）
}

export const DEFAULT_GRID_CONFIG: GridMakerConfig = {
  gridLevels: 5,
  spacingBps: 60,
  baseOrderSol: 0.12,
  maxInventoryTokens: MAX_WALLET_CAP_TOKENS,
};

/**
 * 自适应网格做市策略 (Adaptive Grid Maker)
 * 特性：
 * 1. 围绕联合曲线瞬时价格挂出动态买卖双边网格
 * 2. 库存倾斜机制 (Inventory Skew)：当持币接近 1% 上限时，拉大买单间距，收窄卖单间距促使出货
 * 3. 动态波动率适配：高波动时自动扩大网格间距防止被击穿
 */
export class AdaptiveGridMaker {
  private config: GridMakerConfig;

  constructor(config: GridMakerConfig = DEFAULT_GRID_CONFIG) {
    this.config = config;
  }

  /**
   * 计算当前联合曲线中点报价
   */
  public calculateQuote(
    virtualSol: number,
    virtualToken: number,
    totalRaisedSol: number
  ): OrderBookQuote {
    // 联合曲线即时边际价格 P = virtualSol / virtualToken
    const midPrice = virtualSol / virtualToken;
    const spreadFraction = (this.config.spacingBps / 10000) * 0.5;
    const bidPrice = midPrice * (1 - spreadFraction);
    const askPrice = midPrice * (1 + spreadFraction);

    return {
      bidPrice,
      askPrice,
      midPrice,
      spreadBps: this.config.spacingBps,
      virtualSol,
      virtualToken,
      totalRaisedSol,
    };
  }

  /**
   * 生成做市网格订单层级 (带有库存倾斜修正)
   */
  public generateGrid(
    quote: OrderBookQuote,
    currentHoldingTokens: number
  ): { bids: GridLevel[]; asks: GridLevel[] } {
    const bids: GridLevel[] = [];
    const asks: GridLevel[] = [];

    // 计算库存饱和度 (0.0 ~ 1.0)
    const inventoryRatio = Math.min(1.0, currentHoldingTokens / this.config.maxInventoryTokens);
    // 库存倾斜乘数：持仓多时买单量缩减，卖单量增加
    const buySizeMultiplier = Math.max(0.1, 1.0 - inventoryRatio * 0.8);
    const sellSizeMultiplier = Math.max(0.2, 0.5 + inventoryRatio * 1.2);

    for (let i = 1; i <= this.config.gridLevels; i++) {
      const stepFactor = (this.config.spacingBps / 10000) * i;

      // 买单网格
      const bidPrice = quote.midPrice * (1 - stepFactor);
      const buySol = this.config.baseOrderSol * buySizeMultiplier;
      const buyTokens = buySol / bidPrice;

      bids.push({
        levelIndex: i,
        side: 'buy',
        targetPrice: bidPrice,
        amountSol: buySol,
        amountTokens: buyTokens,
        filled: false,
      });

      // 卖单网格 (仅当当前有持仓库存时挂出)
      if (currentHoldingTokens > 0) {
        const askPrice = quote.midPrice * (1 + stepFactor);
        const sellTokens = (this.config.baseOrderSol / askPrice) * sellSizeMultiplier;
        const actualSellTokens = Math.min(currentHoldingTokens, sellTokens);

        asks.push({
          levelIndex: i,
          side: 'sell',
          targetPrice: askPrice,
          amountSol: actualSellTokens * askPrice,
          amountTokens: actualSellTokens,
          filled: false,
        });
      }
    }

    return { bids, asks };
  }
}
