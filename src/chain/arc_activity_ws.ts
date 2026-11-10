/**
 * ARC 链上实时活动订阅器（ARC Live On-Chain Activity Watcher）
 *
 * 通过 WSS（eth_subscribe）实时订阅 ARC 主网上 $0x.SOUL 代币合约的 Transfer 事件，
 * 维护一个滚动的最近转账缓冲区与统计（累计观察数 / 订阅起始时间 / 连接状态）。
 *
 * 为什么用 WSS 而非 eth_getLogs：
 * - QuickNode discover 套餐把历史 eth_getLogs 限制在 5 个区块窗口，无法回扫全量日志
 *   来推导持有人 / 活动历史；
 * - 而 eth_subscribe 是「向前订阅」，不受 5 区块限制，实测可正常推送 newHeads 与日志，
 *   因此用实时订阅来呈现「链上真实活动流」——只缺「持有人总数」这类累计指标。
 *
 * 容错：任何连接 / 解析失败都只记录 lastError 并尝试重连，绝不抛错、绝不阻塞网关。
 */

import { ethers } from "ethers";
import { ARC_PRODUCTION_CONFIG } from "../config/arc_production";

const TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

const TOKEN_DECIMALS = 18;

export interface ArcTransfer {
  blockNumber: number;
  txHash: string;
  from: string;
  to: string;
  valueRaw: string;
  valueFormatted: string;
  timestamp: number;
}

export interface ArcActivityState {
  /** live=WSS 已连接并收到过区块；offline=未连接 */
  source: "live" | "offline";
  wssConnected: boolean;
  subscribedSince: number | null;
  totalObserved: number;
  recent: ArcTransfer[];
  lastError?: string;
}

export class ArcActivityWatcher {
  private provider: ethers.WebSocketProvider | null = null;
  private recent: ArcTransfer[] = [];
  private totalObserved = 0;
  private subscribedSince: number | null = null;
  private wssConnected = false;
  private lastError: string | undefined;
  private connecting = false;
  private stopped = false;

  private readonly maxRecent = 50;
  private readonly tokenAddress: string;
  private readonly wssUrl: string;

  constructor(opts?: { wssUrl?: string; tokenAddress?: string }) {
    this.tokenAddress = (
      opts?.tokenAddress || ARC_PRODUCTION_CONFIG.contracts.token
    ).toLowerCase();
    const base =
      opts?.wssUrl ||
      process.env.ARC_WSS_URL ||
      ARC_PRODUCTION_CONFIG.rpcUrl
        .replace(/^https:\/\//, "wss://")
        .replace(/^http:\/\//, "ws://");
    this.wssUrl = base;
  }

  start(): void {
    this.stopped = false;
    this.connect();
  }

  private connect(): void {
    if (this.stopped || this.connecting) return;
    this.connecting = true;
    try {
      this.provider = new ethers.WebSocketProvider(this.wssUrl);
    } catch (e: any) {
      this.lastError = `WS init fail: ${String(e?.message || e).slice(0, 120)}`;
      this.connecting = false;
      this.scheduleReconnect();
      return;
    }

    this.provider.on("error", (e: any) => {
      this.lastError = `WS error: ${String(e?.message || e).slice(0, 120)}`;
      this.wssConnected = false;
      this.connecting = false;
      this.scheduleReconnect();
    });

    // 区块心跳：收到即证明 WSS 订阅链路存活，并标记订阅起始时间
    this.provider.on("block", () => {
      this.wssConnected = true;
      this.connecting = false;
      if (!this.subscribedSince) this.subscribedSince = Date.now();
    });

    // 代币 Transfer 事件实时订阅
    this.provider.on({ address: this.tokenAddress, topics: [TRANSFER_TOPIC] }, (log: any) => {
      this.ingest(log);
    });
  }

  private ingest(log: any): void {
    try {
      const from = "0x" + String(log.topics[1]).slice(26);
      const to = "0x" + String(log.topics[2]).slice(26);
      const valueRaw = BigInt(log.data).toString();
      const valueFormatted = ethers.formatUnits(valueRaw, TOKEN_DECIMALS);
      const t: ArcTransfer = {
        blockNumber: Number(log.blockNumber),
        txHash: log.transactionHash,
        from,
        to,
        valueRaw,
        valueFormatted,
        timestamp: Date.now(),
      };
      this.recent.unshift(t);
      if (this.recent.length > this.maxRecent) this.recent.length = this.maxRecent;
      this.totalObserved++;
    } catch (e: any) {
      this.lastError = `parse fail: ${String(e?.message || e).slice(0, 100)}`;
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    setTimeout(() => this.connect(), 5000);
  }

  getState(): ArcActivityState {
    return {
      source: this.wssConnected ? "live" : "offline",
      wssConnected: this.wssConnected,
      subscribedSince: this.subscribedSince,
      totalObserved: this.totalObserved,
      recent: this.recent.slice(0, this.maxRecent),
      lastError: this.lastError,
    };
  }

  stop(): void {
    this.stopped = true;
    try {
      this.provider?.destroy();
    } catch {
      /* noop */
    }
    this.provider = null;
  }
}
