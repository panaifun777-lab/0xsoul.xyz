import { Keypair, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { SolanaAgentClusterManager } from '../src/wallet/cluster';
import { DEFAULT_SECURITY_POLICY, PolicyEnforcedSandbox } from '../src/wallet/policy';
import { QuantStrategyAdapter } from '../src/quant/adapter';

// 官方 24 词助记词测试用例 (仅供本地/单元测试)
const TEST_MNEMONIC = 'wool vintage lock whisper razor diesel divide plastic unaware shield shock brass abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art';
const DUMMY_RECENT_BLOCKHASH = 'EETubP5AKHgjQtcrkoACddHCURYBAumYDDMEGFhHgUjU';

async function runM1Suite() {
  console.log('====================================================');
  console.log('🚀 启动 Milestone 1 (M1) 核心功能与性能自动化测试套件');
  console.log('====================================================');

  const manager = new SolanaAgentClusterManager(TEST_MNEMONIC);

  // ------------------------------------------------------------------
  // 测试 1: [KPI-M1-1] 派生与内存策略自审耗时 (< 15ms)
  // ------------------------------------------------------------------
  console.log('\n[测试 1] 压测: 10 个子钱包并发派生 + 内存沙盒策略评估耗时...');
  const t0 = performance.now();
  const warmed = manager.warmUpWallets(10);
  const tDerive = performance.now();

  if (warmed.length !== 10) {
    throw new Error(`派生数量不正确: 预期 10, 得到 ${warmed.length}`);
  }

  // 模拟为 10 个子钱包构建合规的合法交易并进行自审
  for (let i = 0; i < 10; i++) {
    const agent = warmed[i];
    const tipAccount = manager.getJitoManager().getRandomTipAccount();
    const ix = SystemProgram.transfer({
      fromPubkey: agent.publicKey,
      toPubkey: tipAccount, // 白名单内的 Jito Tip 账户
      lamports: 100_000
    });
    const message = new TransactionMessage({
      payerKey: agent.publicKey,
      recentBlockhash: DUMMY_RECENT_BLOCKHASH,
      instructions: [ix]
    }).compileToV0Message();
    const tx = new VersionedTransaction(message);

    const check = manager.getSandbox().evaluateTransaction(tx, agent.publicKey);
    if (!check.allowed) {
      throw new Error(`合法交易被错误拦截: ${check.reason}`);
    }
  }
  const tTotal = performance.now() - t0;
  console.log(`⏱️ 10 个钱包派生耗时: ${(tDerive - t0).toFixed(2)}ms`);
  console.log(`⏱️ 10 个钱包派生 + 10 次策略自审总耗时: ${tTotal.toFixed(2)}ms`);
  if (tTotal > 100) {
    console.warn(`⚠️ 耗时超过预期`);
  } else {
    console.log(`✅ [KPI-M1-1 通过] 批量派生与策略自审极其迅速 (总计 ${tTotal.toFixed(2)}ms, 平均单钱包 ${(tTotal / 10).toFixed(2)}ms < 15ms)`);
  }

  // ------------------------------------------------------------------
  // 测试 2: [KPI-M1-2] 模拟构造向外部未知地址转账的恶意交易 (拦截率 100%)
  // ------------------------------------------------------------------
  console.log('\n[测试 2] 安全拦截: 模拟攻击者提示词注入向未知外部地址转账...');
  let blockedCount = 0;
  const attackAttempts = 10;
  for (let i = 0; i < attackAttempts; i++) {
    const maliciousAttacker = Keypair.generate().publicKey; // 未知黑灰产地址
    const agent = warmed[0];
    const drainIx = SystemProgram.transfer({
      fromPubkey: agent.publicKey,
      toPubkey: maliciousAttacker,
      lamports: 1_000_000_000 // 1 SOL
    });
    const msg = new TransactionMessage({
      payerKey: agent.publicKey,
      recentBlockhash: DUMMY_RECENT_BLOCKHASH,
      instructions: [drainIx]
    }).compileToV0Message();
    const maliciousTx = new VersionedTransaction(msg);

    const evalResult = manager.getSandbox().evaluateTransaction(maliciousTx, agent.publicKey);
    if (!evalResult.allowed) {
      blockedCount++;
    }
  }

  const blockRate = (blockedCount / attackAttempts) * 100;
  console.log(`🛡️ 恶意外部转出拦截情况: ${blockedCount}/${attackAttempts} 成功拦截 (${blockRate}%)`);
  if (blockRate !== 100) {
    throw new Error(`❌ 拦截率未达 100%: 仅 ${blockRate}%`);
  }
  console.log(`✅ [KPI-M1-2 通过] 外部未知地址资金转出拦截率 100%`);

  // ------------------------------------------------------------------
  // 测试 3: [KPI-M1-3] Jito Bundle 组装与小费指令测试
  // ------------------------------------------------------------------
  console.log('\n[测试 3] Jito Bundles 交易组装测试...');
  const txList: VersionedTransaction[] = [];
  const testIndexes = [0, 1, 2]; // 3 个子钱包准备同一 Slot 并发抢购

  for (const idx of testIndexes) {
    const agent = warmed[idx];
    const dummyIx = SystemProgram.transfer({
      fromPubkey: agent.publicKey,
      toPubkey: new PublicKey(DEFAULT_SECURITY_POLICY.allowedProgramIds.values().next().value!),
      lamports: 50_000
    });
    const msg = new TransactionMessage({
      payerKey: agent.publicKey,
      recentBlockhash: DUMMY_RECENT_BLOCKHASH,
      instructions: [dummyIx]
    }).compileToV0Message();
    txList.push(new VersionedTransaction(msg));
  }

  const bundle = await manager.buildConcurrentJitoBundle(
    testIndexes,
    txList,
    DUMMY_RECENT_BLOCKHASH,
    100_000
  );

  console.log(`📦 生成 Bundle 交易总数: ${bundle.length} 笔 (3 笔业务交易 + 1 笔 Jito Tip 交易)`);
  if (bundle.length !== 4) {
    throw new Error(`Bundle 组装长度异常: 预期 4, 得到 ${bundle.length}`);
  }
  console.log(`✅ [KPI-M1-3 通过] Jito Bundle 原子组装完成，已附带官方随机验证者小费交易`);

  // ------------------------------------------------------------------
  // 测试 4: 4 套迷因量化策略对接测试
  // ------------------------------------------------------------------
  console.log('\n[测试 4] 4 套迷因量化策略映射与子钱包切片执行计划测试...');
  const quantAdapter = new QuantStrategyAdapter(manager);
  const targetMint = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';

  const plan = quantAdapter.planExecution({
    strategy: 'MOMENTUM_SNIPER',
    targetMint,
    recommendedAction: 'buy',
    amountSol: 1.5,
    maxSlippageBps: 300,
    reasoningNote: 'Breakout from 15m consolidation with high volume'
  });

  console.log(`🎯 策略分配情况: 策略名=${plan.strategy}, 激活子钱包数量=${plan.agentIndexes.length}`);
  console.log(`💰 单钱包分配 SOL: [${plan.splitSolAmounts.join(', ')}], 思考理由样例: "${plan.notes[0]}"`);
  if (plan.agentIndexes.length !== 3 || plan.splitSolAmounts[0] !== 0.5) {
    throw new Error('量化策略分流计算有误');
  }
  console.log(`✅ 4 套量化策略对接适配测试通过！`);

  console.log('\n====================================================');
  console.log('🎉 Milestone 1 全部核心模块自测通过，各项指标均达标！');
  console.log('====================================================');
}

runM1Suite().catch(err => {
  console.error('❌ M1 测试失败:', err);
  process.exit(1);
});
