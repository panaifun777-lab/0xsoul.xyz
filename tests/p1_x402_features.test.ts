/**
 * P1 功能验证套件：USDC/SPL 链上验款、动态档位定价、thoughtHash 买方 attestation、持久化存储
 *
 * 验收：
 * 1. USDC ATA 派生确定性与 token 转账校验（金额/收款 ATA/不足/错址）
 * 2. 引擎 USDC 发票 → 链上验款（mock）闭环
 * 3. 档位定价：合法档位、非法回退、SOL/USDC 双报价
 * 4. attestation 往返校验 + 篡改检测
 * 5. MemoryPaymentStore 生命周期 + Redis 不可达安全回退
 */

import { Keypair, PublicKey } from '@solana/web3.js';
import {
  validatePaymentFact,
  OnChainPaymentVerifier,
  deriveAssociatedTokenAddress,
  USDC_MAINNET_MINT,
  type OnChainPaymentFact,
} from '../src/x402/onchain_verifier';
import { X402PaymentEngine } from '../src/x402/middleware';
import { resolveTier, priceForAsset, TIER_PRICING, DEFAULT_TIER } from '../src/x402/pricing';
import { buildAttestation, verifyAttestation, DEFAULT_ATTESTATION_SALT } from '../src/x402/attestation';
import { MemoryPaymentStore, createPaymentStore } from '../src/x402/store';
import { createHash } from 'crypto';

let passCount = 0;
let failCount = 0;
function check(name: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  ✅ ${name}${detail ? ' — ' + detail : ''}`);
    passCount++;
  } else {
    console.error(`  ❌ ${name}${detail ? ' — ' + detail : ''}`);
    failCount++;
    throw new Error(`Assertion failed: ${name}`);
  }
}

const WALLET = Keypair.generate().publicKey.toBase58();
const USDC_ATA = deriveAssociatedTokenAddress(WALLET, USDC_MAINNET_MINT);
const NOW = Math.floor(Date.now() / 1000);

function tokenFact(overrides: Partial<OnChainPaymentFact> = {}): OnChainPaymentFact {
  return {
    signature: 'U'.repeat(64),
    success: true,
    payer: Keypair.generate().publicKey.toBase58(),
    recipient: '',
    lamports: 0n,
    blockTime: NOW - 20,
    confirmed: true,
    tokenTransfers: [{ recipient: USDC_ATA, amount: 250_000n, decimals: 6 }],
    ...overrides,
  };
}

async function run() {
  console.log('====================================================');
  console.log('🔧 P1 功能验证：USDC / 档位 / attestation / 持久化');
  console.log('====================================================');

  /* ---- 1. USDC/SPL 链上验款 ---- */
  console.log('\n[P1-1] USDC/SPL 链上验款');
  // ATA 派生确定性：同 wallet+mint 两次派生一致
  const ataAgain = deriveAssociatedTokenAddress(WALLET, USDC_MAINNET_MINT);
  check('ATA 派生确定性', ataAgain === USDC_ATA);
  check('ATA 与钱包不同（是 PDA）', USDC_ATA !== WALLET);

  const expectedToken = { expectedTokenRecipient: USDC_ATA, expectedTokenMinAmount: 250_000n, nowSeconds: NOW };
  const ok = validatePaymentFact(tokenFact(), expectedToken);
  check('正常 USDC 付款通过', ok.valid === true, ok.error || 'valid');

  const low = validatePaymentFact(tokenFact({ tokenTransfers: [{ recipient: USDC_ATA, amount: 100_000n, decimals: 6 }] }), expectedToken);
  check('USDC 金额不足被拦截', low.valid === false, low.error);

  const wrongAta = Keypair.generate().publicKey.toBase58();
  const wrong = validatePaymentFact(tokenFact({ tokenTransfers: [{ recipient: wrongAta, amount: 250_000n, decimals: 6 }] }), expectedToken);
  check('USDC 收款 ATA 错误被拦截', wrong.valid === false, wrong.error);

  const noToken = validatePaymentFact(tokenFact({ tokenTransfers: [] }), expectedToken);
  check('无 SPL 转账被拦截', noToken.valid === false, noToken.error);

  // 引擎 USDC 发票 → mock 链上验款闭环
  const mockVerifier = new OnChainPaymentVerifier(async (s) => tokenFact({ signature: s }));
  const engine = new X402PaymentEngine(WALLET, { verifier: mockVerifier });
  check('引擎为链上模式', engine.isOnChainMode() === true);
  const usdcInvoice = await engine.createInvoice(0, 0.25, 120, { asset: 'USDC', tier: 'PREMIUM_ALPHA_SNIPER', thoughtHash: '0xtestUSDCsignal' });
  check('USDC 发票资产正确', usdcInvoice.asset === 'USDC');
  check('USDC 发票 mint 为主网 USDC', usdcInvoice.usdcMint === USDC_MAINNET_MINT);
  const paid = await engine.verifyPaymentOnChain(usdcInvoice.paymentNonce, 'U'.repeat(64));
  check('USDC 链上验款通过', paid.valid === true, paid.error || 'valid');
  const receipt = await engine.getSettlementReceipt('U'.repeat(64));
  check('回执记录 USDC 金额', receipt?.amountToken === 0.25, String(receipt?.amountToken));
  check('回执记录 USDC 符号', receipt?.tokenSymbol === 'USDC');

  /* ---- 2. 动态档位定价 ---- */
  console.log('\n[P1-2] 动态档位定价表');
  const t = resolveTier('whale_alpha'); // 大小写不敏感
  check('档位大小写归一化', t.tier === 'WHALE_ALPHA');
  check('WHALE_ALPHA 报价正确', t.price.sol === TIER_PRICING.WHALE_ALPHA.sol);
  const fallback = resolveTier('NOT_A_TIER');
  check('非法档位回退默认档', fallback.tier === DEFAULT_TIER);
  check('SOL 报价选择正确', priceForAsset(TIER_PRICING.INSTITUTIONAL, 'SOL') === 0.1);
  check('USDC 报价选择正确', priceForAsset(TIER_PRICING.INSTITUTIONAL, 'USDC') === 5.0);
  check('四档齐全', Object.keys(TIER_PRICING).length === 4);

  /* ---- 3. thoughtHash 买方 attestation ---- */
  console.log('\n[P1-3] thoughtHash 买方 attestation');
  const receiptForAtt = await engine.getSettlementReceipt('U'.repeat(64));
  const att = buildAttestation(receiptForAtt!, WALLET);
  check('attestation 含 thoughtHash', att.thoughtHash === receiptForAtt!.thoughtHash);
  check('attestation 含 attestationHash', att.attestationHash.startsWith('0x') && att.attestationHash.length === 66);
  check('买方独立复算通过', verifyAttestation(att) === true);
  // 篡改 thoughtHash → 校验失败
  const tampered = { ...att, thoughtHash: '0xdeadbeef' };
  check('篡改后校验失败', verifyAttestation(tampered) === false);
  // 换盐 → 校验失败（证明绑定了命名空间）
  check('错误盐校验失败', verifyAttestation(att, 'wrong-salt') === false);

  /* ---- 4. 持久化存储 ---- */
  console.log('\n[P1-4] 持久化存储层');
  const store = new MemoryPaymentStore();
  const inv = await engine.createInvoice(0.005, 0.25, 120, { tier: 'STANDARD_ALPHA' });
  await store.saveInvoice(inv.paymentNonce, inv);
  const got = await store.getInvoice(inv.paymentNonce);
  check('发票存取往返', got?.paymentNonce === inv.paymentNonce);
  await store.deleteInvoice(inv.paymentNonce);
  check('发票删除后不可取', (await store.getInvoice(inv.paymentNonce)) === undefined);
  await store.markConsumed('SIG1');
  check('签名消费记录', (await store.isConsumed('SIG1')) === true);
  check('消费计数', (await store.consumedCount()) === 1);
  const rec = { paymentNonce: inv.paymentNonce, txSignature: 'SIG1', payer: 'p', amountSol: 0.005, thoughtHash: '0xabc', settledAt: Date.now() };
  await store.saveReceipt('SIG1', rec);
  check('回执存取往返', (await store.getReceipt('SIG1'))?.txSignature === 'SIG1');

  // 无 REDIS_URL → 内存存储
  const autoMem = await createPaymentStore({ redisUrl: undefined });
  check('无 REDIS_URL 返回内存存储', autoMem instanceof MemoryPaymentStore);

  // 不可达 Redis → 安全回退内存（不抛错）
  console.log('  ⏳ 探测不可达 Redis（约 3s 超时）...');
  const fallbackStore = await createPaymentStore({ redisUrl: 'redis://127.0.0.1:59999' });
  check('Redis 不可达时安全回退内存', fallbackStore instanceof MemoryPaymentStore);

  console.log('\n====================================================');
  console.log(`🎉 P1 功能验证全部通过！共 ${passCount} 项断言，${failCount} 失败`);
  console.log('====================================================');
}

run().catch((err) => {
  console.error('\n❌ P1 功能验证失败:', err.message);
  process.exit(1);
});
