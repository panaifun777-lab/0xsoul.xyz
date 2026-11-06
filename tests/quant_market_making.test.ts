import { SolanaAgentClusterManager } from '../src/wallet/cluster';
import { SoulDomainResolver } from '../src/soul/resolver';
import { AdvancedMarketMakingEngine } from '../src/quant/market_making/engine';

async function runQuantEngineUnitTest() {
  console.log('====================================================');
  console.log('📈 启动高级量化做市引擎策略单元测试');
  console.log('====================================================');

  const testMnemonic =
    'wool vintage lock whisper razor diesel divide plastic unaware shield shock brass abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art';
  const clusterManager = new SolanaAgentClusterManager(testMnemonic);
  clusterManager.warmUpWallets(6);

  const soulResolver = new SoulDomainResolver();
  const engine = new AdvancedMarketMakingEngine(clusterManager, soulResolver);

  const testMint = 'MindQuantTestMint11111111111111111111111111111';

  // 1. 自适应双边网格做市测试
  console.log('\n[测试 1] 校验自适应网格做市 (Adaptive Grid) 买卖双边挂单与库存倾斜...');
  const virtualSol = 30;
  const virtualToken = 1_073_000_000;
  const totalRaisedSol = 5;

  // 首次运行，库存为 0
  const gridRes1 = engine.processGridMarketMaking(testMint, virtualSol, virtualToken, totalRaisedSol);
  console.log(`  中点价格: ${gridRes1.quote.midPrice.toExponential(4)} SOL`);
  console.log(`  第一层买单: 价格 ${gridRes1.executions[0]?.price.toExponential(4)}, 金额 ${gridRes1.executions[0]?.solAmount} SOL`);
  if (!gridRes1.executions[0] || gridRes1.executions[0].action !== 'BUY') {
    throw new Error('网格做市买单未能正确生成');
  }

  // 此时已有库存，再次触发应能生成卖单
  const gridRes2 = engine.processGridMarketMaking(testMint, virtualSol, virtualToken, totalRaisedSol);
  const sellExec = gridRes2.executions.find(e => e.action === 'SELL');
  if (sellExec) {
    console.log(`  成功生成做市卖单: 数量 ${sellExec.tokenAmount}, 累计点差收益: ${engine.cumulativeSpreadProfitSol.toExponential(4)} SOL`);
  } else {
    throw new Error('具有库存时网格未能生成卖出对冲单');
  }

  // 2. Hold Line 守线测试
  console.log('\n[测试 2] 校验 Hold Line 守线防跌托盘策略...');
  const normalPrice = 0.00000005; // 5e-8 SOL (高于 3e-8 防线)
  const noAction = engine.processHoldLineDefense(testMint, normalPrice);
  if (noAction !== null) {
    throw new Error('价格正常时不应触发守线托盘');
  }

  const dropPrice = 0.000000028; // 2.8e-8 SOL (跌破 3e-8 防线)
  const defenseAction = engine.processHoldLineDefense(testMint, dropPrice);
  if (defenseAction && defenseAction.strategy === 'HOLD_LINE_DEFENSE' && defenseAction.action === 'BUY') {
    console.log(`  ✅ 成功触发 Hold Line 托盘买单: 金额 ${defenseAction.solAmount} SOL, 理由: "${defenseAction.reasoningNote}"`);
  } else {
    throw new Error('价格跌破阈值时未能触发守线买单');
  }

  // 3. 85 SOL 毕业内外盘套利测试
  console.log('\n[测试 3] 校验 85 SOL 毕业内外盘套利与利差捕捉...');
  const innerPrice = 0.00000010; // 内盘价格
  const outerPriceHigh = 0.00000012; // 外盘价格高 20%
  const arbExec = engine.processGraduationArbitrage(testMint, innerPrice, outerPriceHigh, true);

  if (arbExec && arbExec.strategy === 'GRADUATION_ARBITRAGE' && arbExec.solAmount > 0) {
    console.log(`  ✅ 成功探测并执行套利: 操作资金 ${arbExec.solAmount} SOL, 累计套利预期利润: ${engine.cumulativeArbProfitSol.toFixed(4)} SOL`);
  } else {
    throw new Error('存在 20% 利差时套利引擎未能激活');
  }

  // 4. 高声誉 .soul 巨鲸跟单测试
  console.log('\n[测试 4] 校验 .soul 高声誉巨鲸跟单与黑名单防跟单安全过滤...');
  soulResolver.registerSoulDomain({
    soulDomain: 'alpha-whale.soul',
    solanaAddress: 'WhaleAddress11111111111111111111111111111111',
    role: 'MOMENTUM_SNIPER',
    reputationScore: 9200,
    isBanned: false,
    metadataUri: 'ipfs://QkWhaleData',
    registeredAt: Date.now(),
  });

  const whaleTradeSignal = {
    whaleDomain: 'alpha-whale.soul',
    whaleAddress: 'WhaleAddress11111111111111111111111111111111',
    mint: testMint,
    isBuy: true,
    solAmount: 1.2,
    tokenAmount: 12000000,
    price: 0.00000010,
    whaleNote: 'Breakout volume incoming. Entering heavy position.',
    txSignature: '5WhaleTxSignatureMock123456789',
    timestamp: Date.now(),
  };

  const copyExec = engine.processWhaleCopyTrade(whaleTradeSignal);
  if (copyExec && copyExec.strategy === 'WHALE_COPY_FOLLOW' && copyExec.solAmount > 0) {
    console.log(`  ✅ 成功跟单高声誉 Alpha 巨鲸: 跟单资金 ${copyExec.solAmount} SOL, 附带理由: "${copyExec.reasoningNote}"`);
  } else {
    throw new Error('高声誉巨鲸买单未能触发跟单');
  }

  // 验证低声誉或封禁巨鲸不跟单
  soulResolver.updateReputation('alpha-whale.soul', -9500); // 扣分封禁
  const blockedCopyExec = engine.processWhaleCopyTrade(whaleTradeSignal);
  if (blockedCopyExec === null) {
    console.log(`  ✅ 成功拦截被降分封禁的巨鲸跟单请求 (防操控风控生效)`);
  } else {
    throw new Error('被封禁巨鲸的信号被错误跟随');
  }

  console.log('\n====================================================');
  console.log('🎉 高级量化做市引擎 4 大核心策略单元测试全部通过！');
  console.log('====================================================');
}

runQuantEngineUnitTest().catch((err) => {
  console.error('❌ 量化引擎单元测试失败:', err);
  process.exit(1);
});
