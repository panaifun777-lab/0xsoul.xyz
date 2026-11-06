import { MarketMakerExecutionReport } from './types';
import { SoulDomainResolver, SoulDidRecord } from '../../soul/resolver';

export interface WhaleFollowConfig {
  minWhaleReputationScore: number; // 最小巨鲸声誉分 (例如 >= 8000 SRS)
  followRatio: number;              // 跟单比例 (例如 0.2 = 20% 资金)
  maxFollowSol: number;             // 单笔跟单硬顶 (例如 0.5 SOL，严格受 1.5 SOL 约束)
  allowedWhaleRoles: string[];      // 允许跟单的角色
}

export const DEFAULT_WHALE_FOLLOW_CONFIG: WhaleFollowConfig = {
  minWhaleReputationScore: 7500,
  followRatio: 0.25,
  maxFollowSol: 0.45,
  allowedWhaleRoles: ['MOMENTUM_SNIPER', 'QUANT_MAKER'],
};

export interface WhaleTradeSignal {
  whaleDomain: string;
  whaleAddress: string;
  mint: string;
  isBuy: boolean;
  solAmount: number;
  tokenAmount: number;
  price: number;
  whaleNote: string;
  txSignature: string;
  timestamp: number;
}

/**
 * 高声誉 .soul 巨鲸跟单策略 (Whale Copy Follow)
 * 职责：
 * 1. 监听链上大单与高声誉 .soul Agent 的内盘买卖交易
 * 2. 校验巨鲸的 DID 身份与其 SRS 信用评级（低于阈值或黑名单则绝不跟单）
 * 3. 动态计算跟随仓位大小，挂载 Jito Bundle 抢占紧跟 Slot，实现群体智能跟投
 */
export class WhaleCopyFollowMaker {
  private config: WhaleFollowConfig;
  private soulResolver: SoulDomainResolver;

  constructor(soulResolver: SoulDomainResolver, config: WhaleFollowConfig = DEFAULT_WHALE_FOLLOW_CONFIG) {
    this.soulResolver = soulResolver;
    this.config = config;
  }

  /**
   * 评估巨鲸交易信号并决定是否跟单
   */
  public evaluateWhaleTrade(
    trade: WhaleTradeSignal,
    followerAgentIndex: number
  ): MarketMakerExecutionReport | null {
    // 1. 身份反向查询与声誉核验
    const soulRecord = this.soulResolver.resolve(trade.whaleDomain);
    if (!soulRecord) {
      return null; // 无法识别的非 .soul 匿名地址，跳过
    }

    if (soulRecord.isBanned || soulRecord.reputationScore < this.config.minWhaleReputationScore) {
      return null; // 声誉不足或在黑名单中，拒绝跟单
    }

    // 2. 角色校验
    if (!this.config.allowedWhaleRoles.includes(soulRecord.role)) {
      return null;
    }

    // 3. 计算跟单金额
    if (trade.isBuy) {
      const followSol = Math.min(
        this.config.maxFollowSol,
        Math.max(0.05, trade.solAmount * this.config.followRatio)
      );
      const estTokens = followSol / trade.price;

      return {
        strategy: 'WHALE_COPY_FOLLOW',
        action: 'BUY',
        mint: trade.mint,
        solAmount: Number(followSol.toFixed(4)),
        tokenAmount: Math.floor(estTokens),
        price: trade.price,
        agentIndex: followerAgentIndex,
        reasoningNote: `[CopyTrade] Following Alpha Agent ${trade.whaleDomain} (SRS ${soulRecord.reputationScore}). Note: "${trade.whaleNote.substring(0, 50)}"`,
        jitoAttached: true,
        status: 'SUBMITTED',
        timestamp: Date.now(),
      };
    } else {
      // 卖出跟单
      return {
        strategy: 'WHALE_COPY_FOLLOW',
        action: 'SELL',
        mint: trade.mint,
        solAmount: 0,
        tokenAmount: Math.floor(trade.tokenAmount * this.config.followRatio),
        price: trade.price,
        agentIndex: followerAgentIndex,
        reasoningNote: `[CopyTrade] Mirroring exit with Alpha Agent ${trade.whaleDomain} (SRS ${soulRecord.reputationScore}).`,
        jitoAttached: true,
        status: 'SUBMITTED',
        timestamp: Date.now(),
      };
    }
  }
}
