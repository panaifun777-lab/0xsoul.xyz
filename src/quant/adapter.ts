import { PublicKey, VersionedTransaction } from '@solana/web3.js';
import { SolanaAgentClusterManager } from '../wallet/cluster';

export type QuantStrategyType =
  | 'MOMENTUM_SNIPER'         // 动量内盘狙击 (开盘 1-3 Slot 抢 1% 筹码)
  | 'GRADUATION_ARBITRAGE'   // 毕业套利 (85 SOL 迁移内外盘价差)
  | 'HOLD_LINE_MAKER'        // 守线做市 (保持仓位高于 Hold Line，捕获 Token-2022 税)
  | 'COPY_ALPHA_SWARM';      // 巨鲸跟单 (跟单高声誉 .soul Agent)

export interface QuantSignal {
  strategy: QuantStrategyType;
  targetMint: string;
  recommendedAction: 'buy' | 'sell';
  amountSol: number;
  maxSlippageBps: number;
  reasoningNote: string;
  targetSlot?: number;
}

export class QuantStrategyAdapter {
  private clusterManager: SolanaAgentClusterManager;
  private strategyAgentMapping: Map<QuantStrategyType, number[]> = new Map();

  constructor(clusterManager: SolanaAgentClusterManager) {
    this.clusterManager = clusterManager;
    // 默认分配：
    // 0~2 号子钱包：MOMENTUM_SNIPER (3 钱包并发抢 3% 早期筹码)
    // 3 号子钱包：GRADUATION_ARBITRAGE (外盘平水)
    // 4 号子钱包：HOLD_LINE_MAKER (做市分红)
    // 5 号子钱包：COPY_ALPHA_SWARM (跟单)
    this.strategyAgentMapping.set('MOMENTUM_SNIPER', [0, 1, 2]);
    this.strategyAgentMapping.set('GRADUATION_ARBITRAGE', [3]);
    this.strategyAgentMapping.set('HOLD_LINE_MAKER', [4]);
    this.strategyAgentMapping.set('COPY_ALPHA_SWARM', [5]);
  }

  /**
   * 获取指定策略绑定的钱包公钥列表
   */
  public getStrategyWallets(strategy: QuantStrategyType): PublicKey[] {
    const indexes = this.strategyAgentMapping.get(strategy) || [];
    return indexes.map(idx => this.clusterManager.getOrDeriveWallet(idx).publicKey);
  }

  /**
   * 将量化信号转化为带推理日志的执行计划
   */
  public planExecution(signal: QuantSignal): {
    strategy: QuantStrategyType;
    agentIndexes: number[];
    splitSolAmounts: number[];
    notes: string[];
  } {
    const assignedAgents = this.strategyAgentMapping.get(signal.strategy) || [0];
    const splitCount = assignedAgents.length;
    const perAgentSol = Number((signal.amountSol / splitCount).toFixed(4));

    const splitSolAmounts = assignedAgents.map(() => perAgentSol);
    const notes = assignedAgents.map(
      (idx) => `[${signal.strategy}][Agent-${idx}] ${signal.reasoningNote.slice(0, 100)}`
    );

    return {
      strategy: signal.strategy,
      agentIndexes: assignedAgents,
      splitSolAmounts,
      notes
    };
  }
}
