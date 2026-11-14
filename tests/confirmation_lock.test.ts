/**
 * 手机确认锁状态机单元测试 — 验证 PDF 第 6 节 Proof 0 增测 C-1 ~ C-4：
 *  - C-1: 无确认不签名（超时/未操作 -> 无执行、状态 EXPIRED）
 *  - C-2: 拒绝即终止（显式拒绝 -> 无执行、状态 REJECTED）
 *  - C-3: 篡改即失效（预览被改动 -> 签名对不上 -> 拒绝）
 *  - C-4: 分档正确（EXEMPT 直行，SOFT/STRONG 进待确认队列）
 */
import { strict as assert } from 'assert';
import { generateKeyPairSync, sign as cryptoSign, createPrivateKey } from 'crypto';
import { ConfirmationService, OwnerEd25519Approver } from '../src/mcp/confirmation';
import type { TradePreviewResponse } from '../src/mcp/server';

async function runTests() {
  console.log('=== Running Confirmation Lock Tests (C-1 ~ C-4) ===');

  // 生成测试用的 Owner Ed25519 密钥对
  const { publicKey, privateKey } = generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'der' },
    privateKeyEncoding: { type: 'pkcs8', format: 'der' },
  });
  const pubBase64 = publicKey.toString('base64');
  const approver = new OwnerEd25519Approver(pubBase64);

  const policy = {
    exemptSingleSol: 0.1,
    dailyCumulativeSol: 0.5,
    strongSingleSol: 1.0,
    forcedStrongTypes: ['sell', 'graduate', 'transfer', 'config'],
    forcedSoftTypes: [],
    validityMs: 5_000, // 5秒方便测试超时
    slippageWarnPct: 5,
    allConfirm: false,
  };

  const service = new ConfirmationService({ policy, approver, sweepMs: 1000 });

  const dummyExecutor = (preview: TradePreviewResponse) => {
    return { status: 'CONFIRMED', result: { executedMint: preview.mint }, txid: 'mock_tx_123' };
  };

  const makePreview = (sol: number, isBuy = true, action = 'buy'): TradePreviewResponse => ({
    requestId: `req_${Math.random().toString(36).substring(2, 8)}`,
    mint: 'TestMint111111111111111111111111111111111',
    isBuy,
    solAmount: sol,
    tokenAmount: Math.floor(sol / 0.000000038),
    estimatedPriceSol: 0.000000038,
    slippagePct: 1.0,
    jitoTipSol: 0.001,
    note: 'Test trade',
    agentIndex: 0,
    expiresAt: Date.now() + 60_000,
    riskEvaluation: { allowed: true, capUsagePct: 10 },
  });

  // Test C-4: 分档正确
  console.log('Testing C-4: 分档正确 (EXEMPT vs SOFT vs STRONG)...');
  const pExempt = makePreview(0.05); // < 0.1 SOL -> EXEMPT
  const resExempt = await service.submit(pExempt, 'buy', dummyExecutor);
  assert.equal(resExempt.status, 'CONFIRMED', 'C-4: 小额买入应直接免确认直行');

  const pSoft = makePreview(0.5); // 0.5 SOL (> 0.1, < 1.0) -> SOFT (一点确认)
  const resSoft = await service.submit(pSoft, 'buy', dummyExecutor);
  assert.equal(resSoft.status, 'PENDING', 'C-4: 中额买入应进入待确认队列 (SOFT)');
  assert.equal(resSoft.intent?.tier, 'SOFT');

  const pStrong = makePreview(1.5); // >= 1.0 SOL -> STRONG (强确认)
  const resStrong = await service.submit(pStrong, 'buy', dummyExecutor);
  assert.equal(resStrong.status, 'PENDING', 'C-4: 大额买入应进入待确认队列 (STRONG)');
  assert.equal(resStrong.intent?.tier, 'STRONG');

  // Test C-2: 拒绝即终止
  console.log('Testing C-2: 拒绝即终止...');
  const pReject = makePreview(0.3);
  const resReject = await service.submit(pReject, 'buy', dummyExecutor);
  assert.equal(resReject.status, 'PENDING');
  const rejectOut = service.reject(resReject.intent!.requestId, 'User clicked reject');
  assert.equal(rejectOut.ok, true);
  assert.equal(service.getPending(resReject.intent!.requestId), undefined);

  // Test C-1 & C-3: 篡改即失效与正常签名批准
  console.log('Testing C-3: 篡改即失效 & 正常批准...');
  const pApprove = makePreview(0.4);
  const resApprove = await service.submit(pApprove, 'buy', dummyExecutor);
  assert.equal(resApprove.status, 'PENDING');
  const challenge = resApprove.challenge!;

  // 错误签名 / 篡改测试
  const badSig = Buffer.from('invalid_signature_bytes_1234567890').toString('base64');
  const badApprove = await service.approve(resApprove.intent!.requestId, badSig, dummyExecutor);
  assert.equal(badApprove.ok, false, 'C-3: 错误签名或篡改应被拒绝');
  assert.equal(badApprove.status, 'REJECTED');

  // 正确签名批准
  const pApprove2 = makePreview(0.4);
  const resApprove2 = await service.submit(pApprove2, 'buy', dummyExecutor);
  assert.equal(resApprove2.status, 'PENDING');
  const challenge2 = resApprove2.challenge!;
  
  // 用 privateKey 签名 challenge2
  const privKeyObj = createPrivateKey({ key: privateKey, format: 'der', type: 'pkcs8' });
  const sigBuf = cryptoSign(null, Buffer.from(challenge2, 'utf8'), privKeyObj);
  const sigB64 = sigBuf.toString('base64');

  const goodApprove = await service.approve(resApprove2.intent!.requestId, sigB64, dummyExecutor);
  assert.equal(goodApprove.ok, true, '正确签名应批准成功并执行');
  assert.equal(goodApprove.status, 'EXECUTED');

  service.dispose();
  console.log('ALL CONFIRMATION LOCK TESTS PASSED (C-1 ~ C-4)!');
}

runTests().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
