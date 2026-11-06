/**
 * 全链路毫秒级延迟追踪与遥测系统 (Latency Telemetry)
 * 借鉴 TMTN (The Match, The Night) 架构设计
 * 
 * 追踪维度：
 * 1. requestReceivedMs: 请求到达网关或 MCP 接口时间
 * 2. sandboxVerifiedMs: 1.5 SOL 沙盒与 1% 持仓法律级风控评估完成时间
 * 3. txSerializedMs: Solana 指令装配、Keypair 离线签名与区块哈希绑定时间
 * 4. jitoBroadcastMs: Jito MEV 引擎 Bundle 提交与 Tip 捆绑时间
 * 5. blockConfirmedMs: 区块确认上链时间
 * 
 * 产出物：
 * - 实时写入 data/latency.jsonl 审计流水
 * - 动态计算 P50 / P90 / P99 分位数性能报告
 */

import * as fs from 'fs';
import * as path from 'path';

export interface LatencyRecord {
  orderId: string;
  mint: string;
  action: 'BUY' | 'SELL';
  solAmount: number;
  jitoEnabled: boolean;
  durations: {
    sandboxVerifyMs: number;
    txBuildMs: number;
    jitoBroadcastMs: number;
    blockConfirmMs: number;
    totalLatencyMs: number;
  };
  timestamp: number;
}

export interface LatencySummaryStats {
  totalOrders: number;
  avgTotalLatencyMs: number;
  p50Ms: number;
  p90Ms: number;
  p99Ms: number;
  avgSandboxVerifyMs: number;
  avgTxBuildMs: number;
  avgJitoBroadcastMs: number;
  avgBlockConfirmMs: number;
}

export class LatencyTelemetryManager {
  private logFilePath: string;
  private records: LatencyRecord[] = [];

  constructor(dataDir = 'data') {
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    this.logFilePath = path.join(dataDir, 'latency.jsonl');
  }

  /**
   * 记录一次订单全生命周期的执行耗时并落盘
   */
  public recordLatency(record: LatencyRecord): void {
    this.records.push(record);
    const line = JSON.stringify(record) + '\n';
    fs.appendFileSync(this.logFilePath, line, 'utf-8');
  }

  /**
   * 计算指定时间窗口内的延迟统计分布 (P50, P90, P99)
   */
  public getSummaryStats(): LatencySummaryStats {
    if (this.records.length === 0) {
      return {
        totalOrders: 0,
        avgTotalLatencyMs: 0,
        p50Ms: 0,
        p90Ms: 0,
        p99Ms: 0,
        avgSandboxVerifyMs: 0,
        avgTxBuildMs: 0,
        avgJitoBroadcastMs: 0,
        avgBlockConfirmMs: 0,
      };
    }

    const n = this.records.length;
    const totalLatencies = this.records.map((r) => r.durations.totalLatencyMs).sort((a, b) => a - b);
    const sumTotal = totalLatencies.reduce((acc, v) => acc + v, 0);

    const sumSandbox = this.records.reduce((acc, r) => acc + r.durations.sandboxVerifyMs, 0);
    const sumTxBuild = this.records.reduce((acc, r) => acc + r.durations.txBuildMs, 0);
    const sumJito = this.records.reduce((acc, r) => acc + r.durations.jitoBroadcastMs, 0);
    const sumBlock = this.records.reduce((acc, r) => acc + r.durations.blockConfirmMs, 0);

    const getPercentile = (arr: number[], pct: number) => {
      const idx = Math.min(arr.length - 1, Math.floor((pct / 100) * arr.length));
      return arr[idx];
    };

    return {
      totalOrders: n,
      avgTotalLatencyMs: Number((sumTotal / n).toFixed(2)),
      p50Ms: getPercentile(totalLatencies, 50),
      p90Ms: getPercentile(totalLatencies, 90),
      p99Ms: getPercentile(totalLatencies, 99),
      avgSandboxVerifyMs: Number((sumSandbox / n).toFixed(2)),
      avgTxBuildMs: Number((sumTxBuild / n).toFixed(2)),
      avgJitoBroadcastMs: Number((sumJito / n).toFixed(2)),
      avgBlockConfirmMs: Number((sumBlock / n).toFixed(2)),
    };
  }

  public getRecentRecords(limit = 10): LatencyRecord[] {
    return this.records.slice(-limit);
  }
}
