/**
 * 真实 Jupiter swap 交易构造探针（只构造、不签名、不广播）。
 *
 * 用途：验证 Turnkey solana.tx 策略引擎对 Jupiter 聚合器 CPI 的解析能力。
 * userPublicKey 固定为 devnet 交易钱包地址；quote/swap 走 mainnet lite-api，
 * 因为 Jupiter 官方没有 devnet 流动性。全过程不提交签名，不触碰真实资产。
 *
 * 输出：{ outAmount, route, programs, hex }
 */
import { VersionedTransaction } from '@solana/web3.js';

const BUYER = '31qjM51uaPmEux4hoWnVopqjNBYgzHugGjQRzMtSx8ZL';
const WSOL = 'So11111111111111111111111111111111111111112';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const BASE = 'https://lite-api.jup.ag/swap/v1';

async function main() {
  const quoteUrl = `${BASE}/quote?inputMint=${WSOL}&outputMint=${USDC}`
    + '&amount=1000000&slippageBps=100&restrictIntermediateTokens=true';
  const quoteRes = await fetch(quoteUrl, { headers: { accept: 'application/json' } });
  const quote = await quoteRes.json();
  if (!quote.outAmount) throw new Error(`quote failed ${quoteRes.status}: ${JSON.stringify(quote).slice(0, 400)}`);

  const swapRes = await fetch(`${BASE}/swap`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      quoteResponse: quote,
      userPublicKey: BUYER,
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
    }),
  });
  const swap = await swapRes.json();
  if (!swap.swapTransaction) throw new Error(`swap failed ${swapRes.status}: ${JSON.stringify(swap).slice(0, 400)}`);

  const raw = Buffer.from(swap.swapTransaction, 'base64');
  const tx = VersionedTransaction.deserialize(raw);
  const keys = tx.message.staticAccountKeys.map((k) => k.toBase58());
  const programs = [...new Set(tx.message.compiledInstructions.map((i) => keys[i.programIdIndex]))];

  console.log(JSON.stringify({
    outAmount: quote.outAmount,
    route: (quote.routePlan || []).map((s) => s?.swapInfo?.label).filter(Boolean),
    programs,
    instructionCount: tx.message.compiledInstructions.length,
    hex: raw.toString('hex'),
  }));
}

main().catch((e) => { console.error(e.message); process.exit(1); });
