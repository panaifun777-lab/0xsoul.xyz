/**
 * 网关侧真实 Jupiter swap 构造与校验（纯模块，不碰状态机/确认锁/网关）。
 * Turnkey 策略引擎对 Jupiter CPI 的 spl_transfers 完全不可见，因此程序白名单、
 * 买卖方向、滑点下限只能在广播前于网关层校验。任何失败一律返回 null/ok:false，
 * 绝不抛到上层、绝不伪造成交。
 */
import { PublicKey, SystemProgram, VersionedTransaction } from '@solana/web3.js';

export const WSOL_MINT = 'So11111111111111111111111111111111111111112';

const DEFAULT_QUOTE_URL = 'https://lite-api.jup.ag/swap/v1/quote';
const DEFAULT_SWAP_URL = 'https://lite-api.jup.ag/swap/v1/swap';
const MAX_SLIPPAGE_BPS = 500;

const COMPUTE_BUDGET_PROGRAM_ID = 'ComputeBudget111111111111111111111111111111';
const JUPITER_V6_PROGRAM_ID = 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4';
const SPL_TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022_PROGRAM_ID = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const ASSOCIATED_TOKEN_PROGRAM_ID = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
const RAYDIUM_CPMM_PROGRAM_ID = 'CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C';
const JITO_TIP_ACCOUNT = '96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5';

export const DEFAULT_ALLOWED_PROGRAM_IDS: string[] = [
  SystemProgram.programId.toBase58(),
  COMPUTE_BUDGET_PROGRAM_ID,
  JUPITER_V6_PROGRAM_ID,
  SPL_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  RAYDIUM_CPMM_PROGRAM_ID,
  JITO_TIP_ACCOUNT,
];

export interface JupiterSwapQuote {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  slippageBps?: number;
  minOut?: string;
  routePlan?: Array<{
    swapInfo?: { label?: string; programId?: string; ammKey?: string };
  }>;
  [key: string]: unknown;
}

export interface SwapBuildResult {
  unsignedHex: string;
  quote: JupiterSwapQuote;
  minOut: string;
  inputAmount: string;
  outputMint: string;
  programs: string[];
  dataSource: 'jupiter';
}

export interface SwapValidationResult {
  ok: boolean;
  reason?: string;
}

export interface BuildJupiterSwapParams {
  isBuy: boolean;
  solAmount: number;
  mint: string;
  slippagePct: number;
  walletAddress?: string;
  timeoutMs?: number;
  quoteUrl?: string;
  swapUrl?: string;
  apiKey?: string;
  additionalAllowedPrograms?: string[];
}

function envFlag(name: string): boolean {
  return ['1', 'true', 'yes', 'on'].includes((process.env[name] || '').trim().toLowerCase());
}

export function isJupiterSwapEnabled(): boolean {
  if (!envFlag('JUPITER_SWAP_ENABLED')) return false;
  const network = (process.env.SOLANA_NETWORK || 'devnet').trim().toLowerCase();
  if (network === 'mainnet-beta' || network === 'mainnet') return true;
  return envFlag('JUPITER_SWAP_ALLOW_DEVNET');
}

function isPubkey(value: unknown): value is string {
  if (typeof value !== 'string' || value.length < 32 || value.length > 44) return false;
  try {
    new PublicKey(value);
    return true;
  } catch {
    return false;
  }
}

function computeMinOut(outAmount: string, slippageBps: number): string | null {
  if (!/^\d+$/.test(outAmount)) return null;
  try {
    return ((BigInt(outAmount) * BigInt(10000 - slippageBps)) / 10000n).toString();
  } catch {
    return null;
  }
}

function extractPrograms(unsignedHex: string): string[] | null {
  try {
    if (!/^[0-9a-fA-F]+$/.test(unsignedHex || '') || unsignedHex.length % 2 !== 0) return null;
    const tx = VersionedTransaction.deserialize(Buffer.from(unsignedHex, 'hex'));
    const keys = tx.message.staticAccountKeys.map((k) => k.toBase58());
    const programs: string[] = [];
    for (const ix of tx.message.compiledInstructions) {
      const idx = ix.programIdIndex;
      if (!Number.isInteger(idx) || idx < 0 || idx >= keys.length) return null;
      const id = keys[idx];
      if (!programs.includes(id)) programs.push(id);
    }
    return programs.length ? programs : null;
  } catch {
    return null;
  }
}

function collectAllowedProgramIds(quote: JupiterSwapQuote, extra: string[] = []): string[] {
  const set = new Set<string>(DEFAULT_ALLOWED_PROGRAM_IDS);
  for (const id of extra) if (isPubkey(id)) set.add(id);
  for (const id of (process.env.JUPITER_SWAP_ALLOWED_PROGRAMS || '').split(/[\s,;]+/)) {
    if (isPubkey(id)) set.add(id);
  }
  const routePlan = Array.isArray(quote?.routePlan) ? quote.routePlan : [];
  for (const step of routePlan) {
    const info = step?.swapInfo;
    for (const candidate of [info?.programId, info?.ammKey]) {
      if (isPubkey(candidate)) set.add(candidate);
    }
  }
  return [...set];
}

async function fetchJson(url: string, init: any, timeoutMs: number): Promise<any | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function validateSwapTransaction(
  unsignedHex: string,
  expectedMint: string,
  quote: JupiterSwapQuote,
  allowedProgramIds: string[],
): SwapValidationResult {
  try {
    if (!isPubkey(expectedMint)) return { ok: false, reason: 'invalid expected mint' };
    if (!quote || typeof quote !== 'object') return { ok: false, reason: 'missing quote' };
    if (quote.outputMint !== expectedMint) return { ok: false, reason: 'quote outputMint mismatch' };
    if (quote.inputMint !== WSOL_MINT) return { ok: false, reason: 'quote inputMint is not wSOL' };

    const outAmount = String(quote.outAmount ?? '');
    if (!/^\d+$/.test(outAmount) || BigInt(outAmount) <= 0n) {
      return { ok: false, reason: 'invalid quote outAmount' };
    }
    const bps = Number(quote.slippageBps);
    if (!Number.isInteger(bps) || bps <= 0 || bps > MAX_SLIPPAGE_BPS) {
      return { ok: false, reason: 'invalid slippageBps' };
    }
    const minOut = computeMinOut(outAmount, bps);
    if (!minOut) return { ok: false, reason: 'minOut computation failed' };
    if (quote.minOut != null && String(quote.minOut) !== minOut) {
      return { ok: false, reason: 'minOut mismatch' };
    }

    const programs = extractPrograms(unsignedHex);
    if (!programs) return { ok: false, reason: 'transaction deserialize failed' };
    const allowed = new Set((allowedProgramIds || []).filter((p): p is string => typeof p === 'string'));
    for (const id of programs) {
      if (!allowed.has(id)) return { ok: false, reason: 'unauthorized program: ' + id };
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, reason: 'validate failed: ' + (e?.message || String(e)) };
  }
}

export async function buildJupiterSwap(
  params: BuildJupiterSwapParams,
): Promise<SwapBuildResult | null> {
  try {
    if (!params || params.isBuy !== true || !isJupiterSwapEnabled()) return null;

    const mint = String(params.mint || '');
    if (!isPubkey(mint)) return null;
    const walletAddress = String(params.walletAddress || process.env.AGENT_WALLET_ADDRESS || '');
    if (!isPubkey(walletAddress)) return null;

    const solAmount = Number(params.solAmount);
    const slippagePct = Number(params.slippagePct);
    if (!Number.isFinite(solAmount) || solAmount <= 0) return null;
    if (!Number.isFinite(slippagePct) || slippagePct <= 0) return null;
    const slippageBps = Math.round(slippagePct * 100);
    if (!Number.isInteger(slippageBps) || slippageBps <= 0 || slippageBps > MAX_SLIPPAGE_BPS) return null;

    const inputAmount = String(Math.round(solAmount * 1e9));
    if (!/^\d+$/.test(inputAmount) || inputAmount === '0') return null;

    const timeoutMs = Math.max(500, Number(params.timeoutMs ?? process.env.JUPITER_SWAP_TIMEOUT_MS ?? 6000));
    const headers: Record<string, string> = { accept: 'application/json' };
    const apiKey = params.apiKey ?? process.env.JUPITER_API_KEY;
    if (apiKey) headers['x-api-key'] = apiKey;

    let quoteUrl: URL;
    try {
      quoteUrl = new URL(params.quoteUrl || process.env.JUPITER_QUOTE_URL || DEFAULT_QUOTE_URL);
    } catch {
      return null;
    }
    quoteUrl.searchParams.set('inputMint', WSOL_MINT);
    quoteUrl.searchParams.set('outputMint', mint);
    quoteUrl.searchParams.set('amount', inputAmount);
    quoteUrl.searchParams.set('slippageBps', String(slippageBps));

    const rawQuote = await fetchJson(quoteUrl.toString(), { method: 'GET', headers }, timeoutMs);
    if (!rawQuote || typeof rawQuote !== 'object') return null;

    const outAmount = String(rawQuote.outAmount ?? '');
    if (!/^\d+$/.test(outAmount) || BigInt(outAmount) <= 0n) return null;
    const minOut = computeMinOut(outAmount, slippageBps);
    if (!minOut) return null;

    const quote: JupiterSwapQuote = {
      ...rawQuote,
      inputMint: String(rawQuote.inputMint ?? ''),
      outputMint: String(rawQuote.outputMint ?? ''),
      inAmount: String(rawQuote.inAmount ?? inputAmount),
      outAmount,
      slippageBps,
      minOut,
    };
    if (quote.inputMint !== WSOL_MINT || quote.outputMint !== mint) return null;

    const quoteForApi: Record<string, unknown> = { ...quote };
    delete quoteForApi.minOut;

    const swapUrl = params.swapUrl || process.env.JUPITER_SWAP_URL || DEFAULT_SWAP_URL;
    const swapResponse = await fetchJson(
      swapUrl,
      {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({
          quoteResponse: quoteForApi,
          userPublicKey: walletAddress,
          wrapAndUnwrapSol: true,
          dynamicComputeUnitLimit: true,
        }),
      },
      timeoutMs,
    );
    const encoded = swapResponse?.swapTransaction;
    if (typeof encoded !== 'string' || !encoded) return null;

    let unsignedHex: string;
    try {
      unsignedHex = Buffer.from(encoded, 'base64').toString('hex');
    } catch {
      return null;
    }
    const programs = extractPrograms(unsignedHex);
    if (!programs) return null;

    const allowed = collectAllowedProgramIds(quote, params.additionalAllowedPrograms || []);
    if (!validateSwapTransaction(unsignedHex, mint, quote, allowed).ok) return null;

    return {
      unsignedHex,
      quote,
      minOut,
      inputAmount,
      outputMint: mint,
      programs,
      dataSource: 'jupiter',
    };
  } catch {
    return null;
  }
}
