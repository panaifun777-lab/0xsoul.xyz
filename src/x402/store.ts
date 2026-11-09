/**
 * 支付状态持久化存储层 (Payment State Store)
 *
 * ## 为什么需要
 *
 * 原先 `X402PaymentEngine` 把发票 / 已消费签名 / 结算回执全部放在进程内存里，
 * 容器一重启就归零：未结算发票作废、已付款签名可重放、结算记录丢失。
 * 本模块抽象出 `PaymentStore` 接口，提供两种实现：
 *
 * - `MemoryPaymentStore`：纯内存（默认，零依赖，适合本地 / CI / 无 Redis 场景）
 * - `RedisPaymentStore`：基于 Redis，重启不丢状态，多实例可共享（生产推荐）
 *
 * `createPaymentStore()` 按 `REDIS_URL` 自动选择；Redis 不可达时**安全回退内存**，
 * 绝不因存储故障导致网关无法启动。
 *
 * ## 接口契约
 *
 * - `saveInvoice / getInvoice / deleteInvoice`：发票生命周期
 * - `markConsumed / isConsumed / consumedCount`：防重放签名集合（跨重启持久）
 * - `saveReceipt / getReceipt`：结算回执审计
 */

import type { PaymentInvoice, SettlementReceipt } from './middleware';

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetInMs: number;
}

export interface PaymentStore {
  saveInvoice(nonce: string, invoice: PaymentInvoice): Promise<void>;
  getInvoice(nonce: string): Promise<PaymentInvoice | undefined>;
  deleteInvoice(nonce: string): Promise<void>;
  markConsumed(signature: string): Promise<void>;
  isConsumed(signature: string): Promise<boolean>;
  consumedCount(): Promise<number>;
  saveReceipt(signature: string, receipt: SettlementReceipt): Promise<void>;
  getReceipt(signature: string): Promise<SettlementReceipt | undefined>;
  rateLimit(identifier: string, limit: number, windowSeconds: number): Promise<RateLimitResult>;
}

const INV_PREFIX = 'x402:inv:';
const REC_PREFIX = 'x402:rec:';
const CONSUMED_KEY = 'x402:consumed';

/** 默认实现：进程内内存存储（无外部依赖） */
export class MemoryPaymentStore implements PaymentStore {
  private invoices = new Map<string, PaymentInvoice>();
  private receipts = new Map<string, SettlementReceipt>();
  private consumed = new Set<string>();
  private rateLimits = new Map<string, number[]>();

  async saveInvoice(nonce: string, invoice: PaymentInvoice): Promise<void> {
    this.invoices.set(nonce, invoice);
  }
  async getInvoice(nonce: string): Promise<PaymentInvoice | undefined> {
    return this.invoices.get(nonce);
  }
  async deleteInvoice(nonce: string): Promise<void> {
    this.invoices.delete(nonce);
  }
  async markConsumed(signature: string): Promise<void> {
    this.consumed.add(signature);
  }
  async isConsumed(signature: string): Promise<boolean> {
    return this.consumed.has(signature);
  }
  async consumedCount(): Promise<number> {
    return this.consumed.size;
  }
  async saveReceipt(signature: string, receipt: SettlementReceipt): Promise<void> {
    this.receipts.set(signature, receipt);
  }
  async getReceipt(signature: string): Promise<SettlementReceipt | undefined> {
    return this.receipts.get(signature);
  }
  async rateLimit(identifier: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
    const now = Date.now();
    const windowMs = windowSeconds * 1000;
    let timestamps = this.rateLimits.get(identifier) || [];
    timestamps = timestamps.filter(t => t > now - windowMs);

    if (timestamps.length >= limit) {
      this.rateLimits.set(identifier, timestamps);
      return { allowed: false, remaining: 0, resetInMs: timestamps[0] + windowMs - now };
    }

    timestamps.push(now);
    this.rateLimits.set(identifier, timestamps);
    return { allowed: true, remaining: limit - timestamps.length, resetInMs: windowMs };
  }
}

/**
 * Redis 实现。ioredis 通过动态 import 引入，仅在真正启用 Redis 时才加载，
 * 因此纯内存模式下无需安装 ioredis 也能运行。
 */
export class RedisPaymentStore implements PaymentStore {
  private redis: any = null;
  private connecting: Promise<any> | null = null;

  constructor(private url: string) {}

  /** 惰性获取已连接的客户端（带缓存，避免重复建连） */
  private async client(): Promise<any> {
    if (this.redis) return this.redis;
    if (!this.connecting) {
      const { default: Redis } = await import('ioredis');
      const r = new Redis(this.url, {
        maxRetriesPerRequest: 1,
        lazyConnect: true,
        connectTimeout: 3000,
        // 探测失败后不自动重连，避免不可达 Redis 让进程挂起；生产断线则 Fail-Closed
        retryStrategy: () => null,
        enableOfflineQueue: false,
      });
      r.on('error', () => {}); // 吞掉探测失败时的未处理 error 事件，避免噪音
      this.connecting = r.connect().then(
        () => {
          this.redis = r;
          return r;
        },
        (e) => {
          try {
            r.disconnect();
          } catch {}
          throw e;
        },
      );
    }
    return await this.connecting;
  }

  async saveInvoice(nonce: string, invoice: PaymentInvoice): Promise<void> {
    const c = await this.client();
    await c.set(INV_PREFIX + nonce, JSON.stringify(invoice));
  }
  async getInvoice(nonce: string): Promise<PaymentInvoice | undefined> {
    const c = await this.client();
    const v = await c.get(INV_PREFIX + nonce);
    return v ? (JSON.parse(v) as PaymentInvoice) : undefined;
  }
  async deleteInvoice(nonce: string): Promise<void> {
    const c = await this.client();
    await c.del(INV_PREFIX + nonce);
  }
  async markConsumed(signature: string): Promise<void> {
    const c = await this.client();
    await c.sadd(CONSUMED_KEY, signature);
  }
  async isConsumed(signature: string): Promise<boolean> {
    const c = await this.client();
    return (await c.sismember(CONSUMED_KEY, signature)) === 1;
  }
  async consumedCount(): Promise<number> {
    const c = await this.client();
    return await c.scard(CONSUMED_KEY);
  }
  async saveReceipt(signature: string, receipt: SettlementReceipt): Promise<void> {
    const c = await this.client();
    await c.set(REC_PREFIX + signature, JSON.stringify(receipt));
  }
  async getReceipt(signature: string): Promise<SettlementReceipt | undefined> {
    const c = await this.client();
    const v = await c.get(REC_PREFIX + signature);
    return v ? (JSON.parse(v) as SettlementReceipt) : undefined;
  }
  async rateLimit(identifier: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
    const c = await this.client();
    const key = 'x402:rl:' + identifier;
    const now = Date.now();
    const windowMs = windowSeconds * 1000;
    const minScore = now - windowMs;
    const member = now + ':' + Math.random().toString(36).substring(2, 8);

    const pipeline = c.pipeline();
    pipeline.zremrangebyscore(key, 0, minScore);
    pipeline.zadd(key, now, member);
    pipeline.zcard(key);
    pipeline.expire(key, windowSeconds + 1);

    const results = await pipeline.exec();
    const countRes = results?.[2]?.[1];
    const count = typeof countRes === 'number' ? countRes : limit + 1;

    const allowed = count <= limit;
    const remaining = Math.max(0, limit - count);
    return { allowed, remaining, resetInMs: windowMs };
  }

  async close(): Promise<void> {
    if (this.redis) this.redis.disconnect();
  }
}

/**
 * 按环境构造存储层。
 * - 无 REDIS_URL → 内存存储
 * - 有 REDIS_URL → 探测连通性，可达用 Redis，不可达回退内存（带告警）
 */
export async function createPaymentStore(opts?: {
  redisUrl?: string;
}): Promise<PaymentStore> {
  const url = opts?.redisUrl || process.env.REDIS_URL;
  if (!url) return new MemoryPaymentStore();
  try {
    const store = new RedisPaymentStore(url);
    const c = await (store as any).client();
    await c.ping();
    console.log(`✅ [x402] 持久化存储：Redis (${url})`);
    return store;
  } catch (err) {
    console.warn(
      `⚠️  [x402] Redis 不可达 (${url})，回退内存存储（重启将丢失状态）：${(err as Error).message}`,
    );
    return new MemoryPaymentStore();
  }
}
