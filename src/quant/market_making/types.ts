export type MarketMakingStrategyType =
  | 'ADAPTIVE_GRID'           // 自适应网格做市 (自适应点差与库存倾斜)
  | 'HOLD_LINE_DEFENSE'       // Hold Line 守线做市 (Token-2022 税捕获与防跌托盘)
  | 'GRADUATION_ARBITRAGE'    // 85 SOL 毕业内外盘套利
  | 'WHALE_COPY_FOLLOW';      // 高声誉 .soul 巨鲸跟单

export interface OrderBookQuote {
  bidPrice: number;
  askPrice: number;
  midPrice: number;
  spreadBps: number;
  virtualSol: number;
  virtualToken: number;
  totalRaisedSol: number;
}

export interface GridLevel {
  levelIndex: number;
  side: 'buy' | 'sell';
  targetPrice: number;
  amountSol: number;
  amountTokens: number;
  filled: boolean;
}

export interface ArbitrageOpportunity {
  mint: string;
  innerCurvePrice: number;
  outerDexPrice: number;
  spreadPercent: number;
  direction: 'BUY_INNER_SELL_OUTER' | 'BUY_OUTER_SELL_INNER';
  optimalTradeSol: number;
  estimatedProfitSol: number;
  confidenceScore: number;
}

export interface MarketMakerExecutionReport {
  strategy: MarketMakingStrategyType;
  action: 'BUY' | 'SELL' | 'ARBITRAGE' | 'HOLD';
  mint: string;
  solAmount: number;
  tokenAmount: number;
  price: number;
  agentIndex: number;
  reasoningNote: string;
  jitoAttached: boolean;
  status: 'SUBMITTED' | 'SKIPPED' | 'FAILED';
  timestamp: number;
}
