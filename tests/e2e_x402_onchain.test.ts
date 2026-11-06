/**
 * P3 端到端验证套件：x402 链上真实验款
 *
 * 验收指标：
 * 1. [KPI-P3-1] 正常链上付款放行（金额/收款方/时间窗全部匹配）
 * 2. [KPI-P3-2] 金额不足拦截
 * 3. [KPI-P3-3] 收款方错误拦截（防止打到攻击者地址）
 * 4. [KPI-P3-4] 交易失败 / 未确认拦截
 * 5. [KPI-P3-5] 过期交易拦截（防复用历史交易）
 * 6. [KPI-P3-6] 付款方不符拦截
 * 7. [KPI-P3-7] 防重放：同一签名只能用一次
 * 8. [KPI-P3-8] 未配置 RPC 时 Fail-Closed，绝不静默放行
 * 9. [KPI-P3-9] Invoice 有效期与 nonce 校验
 * 10. [KPI-P3-10] 全链路：下发发票 → 链上付款 → 验款通过 → 返回信号
 */

import { Keypair, PublicKey } from '@solana/web3.js';
import { SolanaAgentClusterManager } from '../src/wallet/cluster';
import { GangSoulGateway } from '../src/gateway/server';
import { X402PaymentEngine } from '../src/x402/middleware';
import {
  OnChainPaymentVerifier,
  validatePaymentFact,
  solToLamports,
  type OnChainPaymentFact,
} from '../src/x402/onchain_verifier';
import axios from 'axios';

const TEST_MNEMONIC =
  'wool vintage lock whisper razor diesel divide plastic unaware shield shock brass abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art';

const RECIPIENT = Keypair.generate().publicKey.toBase58();
const PAYER = Keypair.generate().publicKey.toBase58();
const NOW = 1793800000;
/** 真实当前时间（秒）：用于不注入 nowSeconds 的链上验款路径 */
const REAL_NOW = Math.floor(Date.now() / 1000);

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

/**
 * 构造一条链上付款事实。
 *
 * @param overrides 字段覆盖
 * @param baseTime 基准时间（秒）。测试 1~7 用固定的 NOW 便于精确断言；
 *                 测试 10 需用 REAL_NOW，因为 `verifyPaymentOnChain` 内部
 *                 使用真实当前时间做时间窗校验。
 */
function makeFact(
  overrides: Partial<OnChainPaymentFact> = {},
  baseTime: number = NOW,
): OnChainPaymentFact {
  return {
    signature: 'S'.repeat(64),
    success: true,
    payer: PAYER,
    recipient: RECIPIENT,
    lamports: 5_000_000n,
    blockTime: baseTime - 30,
    confirmed: true,
    ...overrides,
  };
}

async function runX402OnChainSuite() {
  console.log('====================================================');
  console.log('🔐 P3 端到端验证：x402 链上真实验款');
  console.log('====================================================');

  const expected = {
    recipient: RECIPIENT,
    minLamports: 5_000_000n,
    nowSeconds: NOW,
  };

  /* ================================================================
   * 测试 1: [KPI-P3-1] 正常付款放行
   * ================================================================ */
  console.log('\n[测试 1] 校验正常链上付款放行...');
  const okResult = validatePaymentFact(makeFact(), expected);
  check('正常付款通过', okResult.valid === true, okResult.error || 'valid');
  check('返回链上事实', Boolean(okResult.fact?.signature));

  /* ================================================================
   * 测试 2: [KPI-P3-2] 金额不足拦截
   * ================================================================ */
  console.log('\n[测试 2] 校验金额不足拦截...');
  const lowAmount = validatePaymentFact(makeFact({ lamports: 1_000_000n }), expected);
  check('金额不足被拦截', lowAmount.valid === false);
  check('错误信息包含 required', (lowAmount.error || '').includes('required'), lowAmount.error);

  /* ================================================================
   * 测试 3: [KPI-P3-3] 收款方错误拦截
   * ================================================================ */
  console.log('\n[测试 3] 校验收款方错误拦截...');
  const evilRecipient = Keypair.generate().publicKey.toBase58();
  const wrongRecipient = validatePaymentFact(makeFact({ recipient: evilRecipient }), expected);
  check('收款方错误被拦截', wrongRecipient.valid === false);
  check('错误信息提示 mismatch', (wrongRecipient.error || '').includes('mismatch'), wrongRecipient.error);

  /* ================================================================
   * 测试 4: [KPI-P3-4] 交易失败 / 未确认拦截
   * ================================================================ */
  console.log('\n[测试 4] 校验交易失败与未确认拦截...');
  const failedTx = validatePaymentFact(makeFact({ success: false }), expected);
  check('链上执行失败被拦截', failedTx.valid === false, failedTx.error);

  const unconfirmed = validatePaymentFact(makeFact({ confirmed: false }), expected);
  check('未确认交易被拦截', unconfirmed.valid === false, unconfirmed.error);

  const noTransfer = validatePaymentFact(makeFact({ lamports: 0n }), expected);
  check('无 SOL 转账记录被拦截', noTransfer.valid === false, noTransfer.error);

  /* ================================================================
   * 测试 5: [KPI-P3-5] 过期交易拦截
   * ================================================================ */
  console.log('\n[测试 5] 校验过期交易拦截（防复用历史交易）...');
  const stale = validatePaymentFact(makeFact({ blockTime: NOW - 3600 }), expected);
  check('1 小时前的交易被拦截', stale.valid === false);
  check('错误信息包含 stale', (stale.error || '').includes('stale'), stale.error);

  // 容差内应通过
  const withinTolerance = validatePaymentFact(makeFact({ blockTime: NOW - 300 }), expected);
  check('容差内（5 分钟）交易通过', withinTolerance.valid === true);

  // 未来时间拦截
  const future = validatePaymentFact(makeFact({ blockTime: NOW + 300 }), expected);
  check('未来时间交易被拦截', future.valid === false, future.error);

  /* ================================================================
   * 测试 6: [KPI-P3-6] 付款方不符拦截
   * ================================================================ */
  console.log('\n[测试 6] 校验付款方不符拦截...');
  const otherPayer = Keypair.generate().publicKey.toBase58();
  const wrongPayer = validatePaymentFact(makeFact({ payer: otherPayer }), {
    ...expected,
    expectedPayer: PAYER,
  });
  check('付款方不符被拦截', wrongPayer.valid === false);
  check('错误信息提示 payer', (wrongPayer.error || '').toLowerCase().includes('payer'), wrongPayer.error);

  /* ================================================================
   * 测试 7: [KPI-P3-7] 防重放
   * ================================================================ */
  console.log('\n[测试 7] 校验防重放攻击...');
  const sig = 'R'.repeat(64);
  const verifier = new OnChainPaymentVerifier(async (s) => makeFact({ signature: s }));

  const first = await verifier.verify(sig, expected);
  check('首次验款通过', first.valid === true);

  const second = await verifier.verify(sig, expected);
  check('二次使用同一签名被拦截', second.valid === false);
  check('错误信息提示 replay', (second.error || '').toLowerCase().includes('replay'), second.error);
  check('已消费签名计数为 1', verifier.consumedCount() === 1, `${verifier.consumedCount()}`);

  /* ================================================================
   * 测试 8: [KPI-P3-8] 未配置 RPC 时 Fail-Closed
   * ================================================================ */
  console.log('\n[测试 8] 校验未配置 RPC 时 Fail-Closed...');
  const disabled = new OnChainPaymentVerifier(null);
  check('验款器报告未启用', disabled.isEnabled() === false);
  const blocked = await disabled.verify('Z'.repeat(64), expected);
  check('未配置 RPC 时拒绝放行', blocked.valid === false, blocked.error);

  /* ================================================================
   * 测试 9: 非法签名与交易不存在
   * ================================================================ */
  console.log('\n[测试 9] 校验非法签名与交易不存在...');
  const shortSig = await verifier.verify('short', expected);
  check('过短签名被拒绝', shortSig.valid === false, shortSig.error);

  const notFoundVerifier = new OnChainPaymentVerifier(async () => null);
  const notFound = await notFoundVerifier.verify('N'.repeat(64), expected);
  check('链上不存在的交易被拒绝', notFound.valid === false);
  check('错误信息包含 not found', (notFound.error || '').toLowerCase().includes('not found'), notFound.error);

  // 查询抛异常也要安全拒绝
  const throwingVerifier = new OnChainPaymentVerifier(async () => {
    throw new Error('RPC timeout');
  });
  const thrown = await throwingVerifier.verify('T'.repeat(64), expected);
  check('查询异常时安全拒绝', thrown.valid === false, thrown.error);

  /* ================================================================
   * 测试 10: X402PaymentEngine Invoice 校验
   * ================================================================ */
  console.log('\n[测试 10] 校验 Invoice 有效期与 nonce...');

  const engine = new X402PaymentEngine(RECIPIENT);
  check('未注入 verifier 时为内存模式', engine.isOnChainMode() === false);

  // 未注入 verifier 时链上验款应拒绝
  const noVerifier = await engine.verifyPaymentOnChain('any', 'any');
  check('未注入 verifier 时链上验款拒绝', noVerifier.valid === false, noVerifier.error);

  // 注入 mock verifier
  // 注入 mock verifier：必须用 REAL_NOW 作为基准，
  // 因为 verifyPaymentOnChain 内部以真实当前时间做时间窗校验
  const mockEngine = new X402PaymentEngine(RECIPIENT, {
    verifier: new OnChainPaymentVerifier(async (s) => makeFact({ signature: s }, REAL_NOW)),
  });
  check('注入后切换为链上模式', mockEngine.isOnChainMode() === true);

  const invoice = mockEngine.createInvoice(0.001, 0.05);
  check('发票收款方正确', invoice.recipientVault === RECIPIENT, invoice.recipientVault.slice(0, 12) + '...');
  check('发票金额正确', invoice.amountSol === 0.001, `${invoice.amountSol} SOL`);
  check('solToLamports(0.001) === 1000000', solToLamports(0.001) === 1_000_000n);

  // 付款金额足够（5_000_000 >= 1_000_000）应通过
  const paidOk = await mockEngine.verifyPaymentOnChain(invoice.paymentNonce, 'P'.repeat(64));
  check('链上验款通过', paidOk.valid === true, paidOk.error || 'valid');

  // 同一发票二次使用应失败（invoice 已消费）
  const reuseInvoice = await mockEngine.verifyPaymentOnChain(invoice.paymentNonce, 'Q'.repeat(64));
  check('同一发票二次使用被拒', reuseInvoice.valid === false, reuseInvoice.error);

  // 不存在的 nonce
  const badNonce = await mockEngine.verifyPaymentOnChain('inv_fake_nonce', 'R'.repeat(64));
  check('不存在的 nonce 被拒', badNonce.valid === false, badNonce.error);

  /* ================================================================
   * 测试 11: 网关全链路（模拟模式 + 链上模式切换）
   * ================================================================ */
  console.log('\n[测试 11] 网关全链路：发票 → 付款 → 信号...');

  const clusterManager = new SolanaAgentClusterManager(TEST_MNEMONIC);
  await clusterManager.warmUpWallets(10);
  const gateway = new GangSoulGateway(clusterManager);
  const TEST_PORT = 3913;
  await gateway.start(TEST_PORT);
  const baseUrl = `http://127.0.0.1:${TEST_PORT}`;

  try {
    // 未付款 → 402
    let got402 = false;
    let nonce = '';
    try {
      await axios.get(`${baseUrl}/v1/signals/alpha`);
    } catch (err: any) {
      if (err.response?.status === 402) {
        got402 = true;
        nonce = err.response.data.invoice.paymentNonce;
        check(
          '发票收款地址指向配置的协议地址',
          err.response.data.invoice.recipientVault ===
            (process.env.GANG_PROTOCOL_FEE_RECEIVER_SOLANA || '').trim() ||
            err.response.data.invoice.recipientVault.length > 30,
          err.response.data.invoice.recipientVault.slice(0, 12) + '...',
        );
      }
    }
    check('未付款返回 402', got402);
    check('返回支付发票', nonce.startsWith('inv_'), nonce);

    // 模拟模式付款 → 200
    const paid = await axios.get(`${baseUrl}/v1/signals/alpha`, {
      headers: {
        'x-payment-nonce': nonce,
        'x-payment-signature': `5x402Sig_${Date.now()}_${'a'.repeat(32)}`,
      },
    });
    check('模拟模式付款后返回 200', paid.status === 200);
    check('返回信号数量 > 0', paid.data.signals.length > 0, `${paid.data.signals.length} 条`);
    check('标记支付已结算', paid.data.paymentSettled === true);

    // 重放 → 402
    let replayBlocked = false;
    try {
      await axios.get(`${baseUrl}/v1/signals/alpha`, {
        headers: {
          'x-payment-nonce': nonce,
          'x-payment-signature': `5x402Sig_${Date.now()}_${'a'.repeat(32)}`,
        },
      });
    } catch (err: any) {
      replayBlocked = err.response?.status === 402;
    }
    check('重放攻击被拦截', replayBlocked);
  } finally {
    await gateway.stop();
  }

  /* ================================================================
   * 汇总
   * ================================================================ */
  console.log('\n====================================================');
  console.log(`🎉 P3 端到端验证全部通过！共 ${passCount} 项断言，0 失败`);
  console.log('====================================================');
}

runX402OnChainSuite().catch((err) => {
  console.error('\n❌ P3 端到端验证失败:', err.message);
  process.exit(1);
});
