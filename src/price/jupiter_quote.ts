/**
 * Jupiter Quote 报价适配层（骨架 / 只读，不改任何底层状态机）
 *
 * 现状：src/mcp/server.ts 的 gang_preview 用硬编码 priceSol = 0.000000038（种子价），
 *       并打 priceDataSource:'seed'。本模块提供「真实报价 or null」的独立取价函数，
 *       调用方自行决定是否用它替换种子价；失败一律回退 null，绝不抛错、绝不阻塞请求。
 *
 * 官方事实（developers.jup.ag，2026-11 核验）：
 *  - V1 (Metis) 报价：GET https://lite-api.jup.ag/swap/v1/quote（免 key）
 *    或 https://api.jup.ag/swap/v1/quote（x-api-key，V1 已标注不再积极维护）
 *  - V2（官方推荐）：GET https://api.jup.ag/swap/v2/order?inputMint=..&outputMint=..&amount=..
 *    不带 taker 时只返回报价（transaction:null）。免 key 0.5 RPS，x-api-key 提额。
 *  - 必填参数：inputMint / outputMint / amount（原子单位整数，非人类可读数量）
 *  - slippageBps：基点，100 = 1%，默认 50（本骨架默认由调用方传入）
 *  - 关键响应字段：outAmount / inAmount / priceImpactPct / routePlan[{swapInfo{label,..},percent|bps}]
 *  - API key：可选（keyless 可跑），生产用 JUPITER_API_KEY 走 x-api-key 头
 *  - devnet：官方无任何 devnet 报价端点，聚合的是 Solana mainnet-beta 流动性。
 *    当前系统 SOLANA_NETWORK=devnet，故默认关闭真实报价，保持 seed 回退。
 *
 * 因此本骨架默认端点取 lite-api V1（字段最全：priceImpactPct/routePlan 齐全、免 key），
 * 可用 JUPITER_QUOTE_URL 一键切到 V2 /order。两种响应形状都能解析。
 */

/** wSOL mint（报价输出为它时，priceSol 即「每枚代币值多少 SOL」） */
const WSOL_MINT = 'So11111111111111111111111111111111111111112';
const DEFAULT_ENDPOINT = 'https://lite-api.jup.ag/swap/v1/quote';

export interface JupiterQuoteResult {
  /** Jupiter 返回的最佳输出原子单位（字符串，避免大数精度丢失） */
  outAmount: string;
  /** 实际参与报价的输入原子单位（回传便于调用方核对） */
  inAmount: string;
  /**
   * 单位价格：每 1 个「完整 input token」可换多少个「完整 output token」。
   * 当 outputMint 为 wSOL（So11111111111111111111111111111111111111112）时，它就是 SOL/token，
   * 可直接替代 gang_preview 里的 priceSol（种子值 0.000000038）。
   */
  priceSol: number;
  /** Jupiter priceImpactPct（%）转 number；V2 响应无此字段时为 0 */
  priceImpactPct: number;
  /** 路由摘要，例如 "Meteora DLMM 100%" 或 "Raydium 60% → Orca Whirlpool 40%" */
  routeSummary: string;
  dataSource: 'jupiter';
}

export interface JupiterQuoteOptions {
  /** input token 小数位；默认：input=wSOL 时 9，否则 6（meme 常见值） */
  inputDecimals?: number;
  /** output token 小数位；默认：output=wSOL 时 9，否则 6 */
  outputDecimals?: number;
  /** HTTP 超时毫秒，默认 4000（可用 JUPITER_QUOTE_TIMEOUT_MS 覆盖） */
  timeoutMs?: number;
  /** x-api-key；默认读 JUPITER_API_KEY，未配置则 keyless */
  apiKey?: string;
  /** 覆盖默认端点；默认读 JUPITER_QUOTE_URL，再默认 lite-api V1 quote */
  endpoint?: string;
  /** 显式允许在 devnet 调用（仅供实验；默认 false） */
  allowDevnet?: boolean;
}

function envFlag(name: string): boolean {
  return ['1', 'true', 'yes', 'on'].includes((process.env[name] || '').trim().toLowerCase());
}

/**
 * 是否允许走真实 Jupiter 报价。
 * 双开关：必须显式 JUPITER_QUOTE_ENABLED=true(1/yes/on)，
 * 且 SOLANA_NETWORK=mainnet-beta；devnet 默认禁用（Jupiter 无 devnet 流动性）。
 * devnet 若确需试验，需额外 JUPITER_QUOTE_ALLOW_DEVNET=true。
 */
export function isJupiterQuoteEnabled(): boolean {
  if (!envFlag('JUPITER_QUOTE_ENABLED')) return false;
  const network = (process.env.SOLANA_NETWORK || 'devnet').toLowerCase();
  if (network === 'mainnet-beta' || network === 'mainnet') return true;
  return envFlag('JUPITER_QUOTE_ALLOW_DEVNET');
}

/**
 * 取 Jupiter 真实报价；任何失败（未开启 / 参数非法 / 超时 / 非 2xx / 响应缺字段）
 * 都返回 null，由调用方保持原 seed 报价与 dataSource:'seed' 标记。
 *
 * 不改状态机：本函数是纯 HTTP 读取，不 import mcp/confirmation，不写任何内存态。
 */
export async function getJupiterQuote(
  inputMint: string,
  outputMint: string,
  /** 原子单位整数：1 SOL = 1e9，6 位小数代币 1 枚 = 1e6 */
  amount: number | string,
  slippageBps: number,
  options?: JupiterQuoteOptions,
): Promise<JupiterQuoteResult | null> {
  // 总开关必须显式开启；devnet 需额外 allowDevnet（全局 env 或本次调用）才放行
  if (!envFlag('JUPITER_QUOTE_ENABLED')) return null;
  const network = (process.env.SOLANA_NETWORK || 'devnet').toLowerCase();
  const isMainnet = network === 'mainnet-beta' || network === 'mainnet';
  if (!isMainnet && !options?.allowDevnet && !envFlag('JUPITER_QUOTE_ALLOW_DEVNET')) return null;

  const rawAmount =
    typeof amount === 'number' ? String(Math.round(amount)) : String(amount).split('.')[0];
  if (!/^\d+$/.test(rawAmount) || rawAmount === '0') return null;
  if (!inputMint || !outputMint || inputMint === outputMint) return null;
  const bps = Math.max(0, Math.min(10000, Math.round(Number(slippageBps) || 50)));

  const endpoint = options?.endpoint || process.env.JUPITER_QUOTE_URL || DEFAULT_ENDPOINT;
  const timeoutMs = Math.max(500, Number(options?.timeoutMs ?? process.env.JUPITER_QUOTE_TIMEOUT_MS ?? 4000));

  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return null;
  }
  url.searchParams.set('inputMint', inputMint);
  url.searchParams.set('outputMint', outputMint);
  url.searchParams.set('amount', rawAmount);
  url.searchParams.set('slippageBps', String(bps));
  url.searchParams.set('restrictIntermediateTokens', 'true');
  url.searchParams.set('instructionVersion', 'V2');

  try {
    const headers: Record<string, string> = { accept: 'application/json' };
    const apiKey = options?.apiKey ?? process.env.JUPITER_API_KEY;
    if (apiKey) headers['x-api-key'] = apiKey;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetch(url.toString(), { method: 'GET', headers, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) return null;

    const data: any = await response.json();
    if (data?.outAmount == null) return null;

    const inAmount = String(data.inAmount ?? rawAmount);
    const outAmount = String(data.outAmount);
    const inputDecimals = options?.inputDecimals ?? (inputMint === WSOL_MINT ? 9 : 6);
    const outputDecimals = options?.outputDecimals ?? (outputMint === WSOL_MINT ? 9 : 6);
    const inHuman = Number(inAmount) / 10 ** inputDecimals;
    const outHuman = Number(outAmount) / 10 ** outputDecimals;
    const priceSol = inHuman > 0 ? outHuman / inHuman : NaN;
    if (!Number.isFinite(priceSol) || priceSol <= 0) return null;

    const routePlan: any[] = Array.isArray(data.routePlan) ? data.routePlan : [];
    const routeSummary = routePlan.length
      ? routePlan
          .map((step) => {
            const label = String(step?.swapInfo?.label || 'AMM');
            const share =
              step?.percent != null
                ? Number(step.percent)
                : step?.bps != null
                  ? Number(step.bps) / 100
                  : 0;
            return Number.isFinite(share) && share > 0 ? `${label} ${share}%` : label;
          })
          .join(' → ')
      : String(data?.router || 'unknown');

    return {
      outAmount,
      inAmount,
      priceSol,
      priceImpactPct: Number(data.priceImpactPct) || 0,
      routeSummary,
      dataSource: 'jupiter',
    };
  } catch {
    // 网络不可达 / 超时 / JSON 解析失败 / 任意异常 → 一律安全回退
    return null;
  }
}

/*
 * ============================================================================
 * 接入点建议（本任务不改 server.ts，仅给出接入方案）
 * ============================================================================
 *
 * 1) 在 src/mcp/server.ts 顶部新增 import：
 *      import { getJupiterQuote } from '../price/jupiter_quote';
 *
 * 2) gang_preview 中把第 634 行硬编码 priceSol 改为「先真实、后种子」。
 *    统一用 token → wSOL 方向报价，因为 q.priceSol 的单位正好是 SOL/token，
 *    与种子价 0.000000038 同口径，买卖两边都适用：
 *
 *      let priceSol = 0.000000038;                 // 原种子价保留为回退
 *      let priceDataSource: 'jupiter' | 'seed' = 'seed';
 *      let quoteMeta: Record<string, unknown> = {};
 *      const q = await getJupiterQuote(
 *        args.mint, 'So11111111111111111111111111111111111111112', 1_000_000,   // 1 枚代币（6 位小数），meme 若是 9 位需改
 *        Math.round(slippagePct * 100),                  // 1% → 100bps
 *        { inputDecimals: 6, outputDecimals: 9 },
 *      );
 *      if (q) {
 *        priceSol = q.priceSol;                      // SOL/token
 *        priceDataSource = 'jupiter';
 *        quoteMeta = { priceImpactPct: q.priceImpactPct, routeSummary: q.routeSummary };
 *      }
 *      // 后续 estimatedTokens / estimatedSol / preview.estimatedPriceSol 沿用原公式即可
 *
 * 3) preview 与返回标记同步：
 *      preview.estimatedPriceSol = priceSol;
 *      // TradePreviewResponse 如无 priceDataSource 字段，可放外层 stamp：
 *      this.stamp({ ..., priceDataSource, ...quoteMeta }, priceDataSource, priceDataSource === 'seed' ? 原提示 : undefined);
 *    失败（quote 为 null）时完全走原逻辑：priceSol 保持 0.000000038、priceDataSource:'seed'，
 *    stamp 的第二参数仍是 'seed' —— 与现状零差异。确认锁、previewHash、1.5 SOL/1% 风控均不动。
 *
 * 4) 配置开关（建议加进 .env，不改本骨架即可生效）：
 *      JUPITER_QUOTE_ENABLED=false        # 默认关；mainnet 且已验证流动性后再开 true
 *      SOLANA_NETWORK=devnet              # 当前值，保持 seed 回退
 *      JUPITER_QUOTE_URL=                 # 留空=lite V1；可填 https://api.jup.ag/swap/v2/order
 *      JUPITER_QUOTE_TIMEOUT_MS=4000
 *      JUPITER_API_KEY=                   # 可选；keyless 0.5 RPS
 *
 * 5) 网络与流动性现实：devnet 上聚合器无真实 DEX 流动性，即便强制开启也大概率
 *    NO_ROUTES_FOUND/404 → null。最稳路径是保持上面的双开关，主网才默认开，
 *    devnet 继续用种子价并明确标注 dataSource:'seed'。
 */
