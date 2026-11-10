import { SolanaAgentClusterManager } from '../../wallet/cluster';
import { SoulDomainResolver } from '../../soul/resolver';
import { AdaptiveGridMaker, DEFAULT_GRID_CONFIG, GridMakerConfig } from './grid_maker';
import { HoldLineDefenseMaker, DEFAULT_HOLD_LINE_CONFIG, HoldLineConfig } from './hold_line';
import { GraduationArbitrageEngine, DEFAULT_ARBITRAGE_CONFIG, GraduationArbitrageConfig } from './graduation_arbitrage';
import { WhaleCopyFollowMaker, DEFAULT_WHALE_FOLLOW_CONFIG, WhaleFollowConfig, WhaleTradeSignal } from './whale_follow';
import { MarketMakerExecutionReport, OrderBookQuote, ArbitrageOpportunity } from './types';
import { Transaction } from '@solana/web3.js';
import { MAX_WALLET_CAP_TOKENS } from '../../config/tokenomics';

export interface MarketMakerEngineConfig {
  gridConfig?: GridMakerConfig;
  holdLineConfig?: HoldLineConfig;
  arbitrageConfig?: GraduationArbitrageConfig;
  whaleFollowConfig?: WhaleFollowConfig;
}

/**
 * 高级智能体量化做市集成引擎 (Advanced Market Making Engine)
 * 编排协同：
 * - Agent #2: QUANT_MAKER (执行自适应双边网格做市，捕获买卖点差)
 * - Agent #3: ARBITRAGEUR (执行内外盘利差套利与滑点平水)
 * - Agent #1: MOMENTUM_SNIPER (执行 .soul 高声誉巨鲸跟单与突破捕捉)
 * - Agent #0: DEV_TREASURY (执行 Hold Line 守线防跌与代币税捕获)
 */
export class AdvancedMarketMakingEngine {
  public gridMaker: AdaptiveGridMaker;
  public holdLineMaker: HoldLineDefenseMaker;
  public arbEngine: GraduationArbitrageEngine;
  public whaleFollower: WhaleCopyFollowMaker;
  private clusterManager: SolanaAgentClusterManager;
  private soulResolver: SoulDomainResolver;

  // 记录各代币库存分布: Mint -> AgentIndex -> TokenAmount
  private inventoryMap: Map<string, Map<number, number>> = new Map();
  // 累计做市与套利收益统计 (SOL)
  public cumulativeSpreadProfitSol: number = 0;
  public cumulativeArbProfitSol: number = 0;
  public executionHistory: MarketMakerExecutionReport[] = [];

  constructor(
    clusterManager: SolanaAgentClusterManager,
    soulResolver: SoulDomainResolver,
    config: MarketMakerEngineConfig = {}
  ) {
    this.clusterManager = clusterManager;
    this.soulResolver = soulResolver;
    this.gridMaker = new AdaptiveGridMaker(config.gridConfig || DEFAULT_GRID_CONFIG);
    this.holdLineMaker = new HoldLineDefenseMaker(config.holdLineConfig || DEFAULT_HOLD_LINE_CONFIG);
    this.arbEngine = new GraduationArbitrageEngine(config.arbitrageConfig || DEFAULT_ARBITRAGE_CONFIG);
    this.whaleFollower = new WhaleCopyFollowMaker(soulResolver, config.whaleFollowConfig || DEFAULT_WHALE_FOLLOW_CONFIG);
  }

  /**
   * 更新或获取 Agent 代币库存
   */
  public getAgentTokenInventory(mint: string, agentIndex: number): number {
    const mintMap = this.inventoryMap.get(mint);
    if (!mintMap) return 0;
    return mintMap.get(agentIndex) || 0;
  }

  public updateAgentTokenInventory(mint: string, agentIndex: number, deltaTokens: number) {
    if (!this.inventoryMap.has(mint)) {
      this.inventoryMap.set(mint, new Map());
    }
    const mintMap = this.inventoryMap.get(mint)!;
    const current = mintMap.get(agentIndex) || 0;
    mintMap.set(agentIndex, Math.max(0, current + deltaTokens));
  }

  /**
   * 1. 触发自适应双边网格做市挂单
   * 由 Agent 2 (QUANT_MAKER) 主导
   */
  public processGridMarketMaking(
    mint: string,
    virtualSol: number,
    virtualToken: number,
    totalRaisedSol: number
  ): { quote: OrderBookQuote; executions: MarketMakerExecutionReport[] } {
    const quote = this.gridMaker.calculateQuote(virtualSol, virtualToken, totalRaisedSol);
    const agentIndex = 2; // 固定分配给专业做市商智能体
    const currentHolding = this.getAgentTokenInventory(mint, agentIndex);

    const { bids, asks } = this.gridMaker.generateGrid(quote, currentHolding);
    const executions: MarketMakerExecutionReport[] = [];

    // 处理买单网格第一层触发 (模拟成交，严格受 1% 10,000,000 持仓硬顶约束)
    if (bids.length > 0) {
      const topBid = bids[0];
      const remainingCapacity = Math.max(0, MAX_WALLET_CAP_TOKENS - currentHolding);
      const desiredTokens = Math.floor(topBid.amountTokens);
      const buyTokens = Math.min(desiredTokens, remainingCapacity);
      const actualBuySol = buyTokens > 0 ? Number((buyTokens * topBid.targetPrice).toFixed(4)) : 0;

      // 检查单笔金额在安全沙盒 1.5 SOL 内且有持仓容量
      if (actualBuySol > 0 && actualBuySol <= 1.5) {
        executions.push({
          strategy: 'ADAPTIVE_GRID',
          action: 'BUY',
          mint,
          solAmount: actualBuySol,
          tokenAmount: buyTokens,
          price: topBid.targetPrice,
          agentIndex,
          reasoningNote: `[GridBid] Level 1 spread capture. Price: ${topBid.targetPrice.toExponential(3)}, Sol: ${actualBuySol.toFixed(3)}`,
          jitoAttached: false,
          status: 'SUBMITTED',
          timestamp: Date.now(),
        });
        this.updateAgentTokenInventory(mint, agentIndex, buyTokens);
      }
    }

    // 处理卖单网格触发 (如有库存)
    if (asks.length > 0 && currentHolding > 0) {
      const topAsk = asks[0];
      const sellTokens = Math.min(currentHolding, Math.floor(topAsk.amountTokens));
      const actualSellSol = Number((sellTokens * topAsk.targetPrice).toFixed(4));

      if (sellTokens > 0) {
        executions.push({
          strategy: 'ADAPTIVE_GRID',
          action: 'SELL',
          mint,
          solAmount: actualSellSol,
          tokenAmount: sellTokens,
          price: topAsk.targetPrice,
          agentIndex,
          reasoningNote: `[GridAsk] Level 1 profit taking. Price: ${topAsk.targetPrice.toExponential(3)}, Tokens: ${sellTokens}`,
          jitoAttached: false,
          status: 'SUBMITTED',
          timestamp: Date.now(),
        });
        this.updateAgentTokenInventory(mint, agentIndex, -sellTokens);
        // 记录点差捕获收益
        const spreadCapture = actualSellSol * (quote.spreadBps / 10000);
        this.cumulativeSpreadProfitSol += spreadCapture;
      }
    }

    this.executionHistory.push(...executions);
    return { quote, executions };
  }

  /**
   * 2. 触发 Hold Line 守线检查
   * 由 Agent 0 (DEV_TREASURY) 主导，受 1% 法律级持仓约束
   */
  public processHoldLineDefense(mint: string, currentPrice: number): MarketMakerExecutionReport | null {
    const agentIndex = 0;
    const currentHolding = this.getAgentTokenInventory(mint, agentIndex);
    const report = this.holdLineMaker.evaluateDefense(currentPrice, mint, agentIndex, currentHolding);
    if (report) {
      this.updateAgentTokenInventory(mint, agentIndex, report.tokenAmount);
      this.executionHistory.push(report);
      return report;
    }
    return null;
  }

  /**
   * 3. 触发 85 SOL 毕业内外盘套利
   * 由 Agent 3 (ARBITRAGEUR) 主导
   */
  public processGraduationArbitrage(
    mint: string,
    innerPrice: number,
    outerPrice: number,
    isGraduated: boolean
  ): MarketMakerExecutionReport | null {
    const opp = this.arbEngine.detectOpportunity(mint, innerPrice, outerPrice, isGraduated);
    if (!opp) return null;

    const agentIndex = 3;
    const report = this.arbEngine.generateArbitrageExecution(opp, agentIndex);
    this.cumulativeArbProfitSol += opp.estimatedProfitSol;
    this.executionHistory.push(report);
    return report;
  }

  /**
   * 4. 触发巨鲸跟单评估
   * 由 Agent 1 (MOMENTUM_SNIPER) 主导
   */
  public processWhaleCopyTrade(trade: WhaleTradeSignal): MarketMakerExecutionReport | null {
    const agentIndex = 1;
    const report = this.whaleFollower.evaluateWhaleTrade(trade, agentIndex);
    if (report) {
      if (report.action === 'BUY') {
        this.updateAgentTokenInventory(report.mint, agentIndex, report.tokenAmount);
      } else if (report.action === 'SELL') {
        this.updateAgentTokenInventory(report.mint, agentIndex, -report.tokenAmount);
      }
      this.executionHistory.push(report);
      return report;
    }
    return null;
  }
}
