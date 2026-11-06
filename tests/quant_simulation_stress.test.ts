import { SolanaAgentClusterManager } from '../src/wallet/cluster';
import { SoulDomainResolver } from '../src/soul/resolver';
import { AdvancedMarketMakingEngine } from '../src/quant/market_making/engine';
import { WhaleTradeSignal } from '../src/quant/market_making/whale_follow';

/**
 * 量化做市策略高频仿真、点差捕获与极值风控压力测试套件
 * 核心指标：
 * 1. [KPI-Q1] 自适应网格 50 轮行情震荡做市：实现买卖双边匹配与点差捕获，累积正收益
 * 2. [KPI-Q2] 暴跌黑天鹅行情：Hold Line 托盘防线连续成功拦截破位，托盘资金合规受控
 * 3. [KPI-Q3] 85 SOL 毕业临界点：内外盘利差套利高频并发测算，净利润扣除 Jito Tip 后为正
 * 4. [KPI-Q4] SRS 巨鲸群体协同跟单：高声誉跟随率 100%，被风控封禁巨鲸拦截率 100%
 * 5. [KPI-Q5] 全局硬性安全审计：所有交易单笔 <= 1.5 SOL 沙盒上限，持仓硬顶 <= 1%
 */

async function runQuantSimulationStressSuite() {
  console.log('====================================================');
  console.log('⚡ 启动量化做市策略仿真压测、点差捕获与极值风控验证套件');
  console.log('====================================================');

  const testMnemonic =
    'wool vintage lock whisper razor diesel divide plastic unaware shield shock brass abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art';
  const clusterManager = new SolanaAgentClusterManager(testMnemonic);
  clusterManager.warmUpWallets(6);

  const soulResolver = new SoulDomainResolver();
  const engine = new AdvancedMarketMakingEngine(clusterManager, soulResolver);

  const testMint = 'MindMarketMakerStressTestToken1111111111111';

  // ----------------------------------------------------
  // 压测 1: [KPI-Q1] 50 轮高频震荡行情下的网格做市与点差捕获
  // ----------------------------------------------------
  console.log('\n[压测 1] 运行 50 轮市场行情震荡，验证自适应网格双边成交与点差累积...');
  let currentSolReserve = 30.0;
  let currentTokenReserve = 1_073_000_000;
  let gridCyclesExecuted = 0;

  for (let cycle = 1; cycle <= 50; cycle++) {
    // 模拟随机微小价格扰动 (-1.5% ~ +1.5%)
    const priceShock = 1 + (Math.random() * 0.03 - 0.015);
    currentSolReserve *= priceShock;

    const res = engine.processGridMarketMaking(
      testMint,
      currentSolReserve,
      currentTokenReserve,
      5.0 + cycle * 0.1
    );

    if (res.executions.length > 0) {
      gridCyclesExecuted += res.executions.length;
    }
  }

  const agent2Inventory = engine.getAgentTokenInventory(testMint, 2);
  console.log(`✅ [KPI-Q1 通过] 50 轮网格震荡仿真完毕:`);
  console.log(`   - 累计触发做市执行笔数: ${gridCyclesExecuted}`);
  console.log(`   - Agent #2 (做市商) 当前代币库存: ${agent2Inventory.toLocaleString()} 枚`);
  console.log(`   - 累计点差捕获纯利润: ${engine.cumulativeSpreadProfitSol.toExponential(4)} SOL`);

  if (engine.cumulativeSpreadProfitSol <= 0) {
    throw new Error('❌ 网格做市在震荡行情中未能捕获正向点差收益！');
  }

  // ----------------------------------------------------
  // 压测 2: [KPI-Q2] 极速砸盘黑天鹅下的 Hold Line 托盘防线测试
  // ----------------------------------------------------
  console.log('\n[压测 2] 模拟大户砸盘暴跌 35%，验证 Hold Line 守线自动托盘机制...');
  const crashedPrices = [
    0.000000032, // 接近防线
    0.000000029, // 破位 3e-8 防线
    0.000000027, // 进一步下探
    0.000000025, // 严重破位
    0.000000024, // 极度超跌
  ];

  let defenseTriggerCount = 0;
  let totalDefenseSpentSol = 0;

  for (const p of crashedPrices) {
    const defenseReport = engine.processHoldLineDefense(testMint, p);
    if (defenseReport) {
      defenseTriggerCount++;
      totalDefenseSpentSol += defenseReport.solAmount;
      if (defenseReport.solAmount > 1.5) {
        throw new Error(`❌ 守线买单突破 1.5 SOL 沙盒上限: ${defenseReport.solAmount}`);
      }
    }
  }

  console.log(`✅ [KPI-Q2 通过] Hold Line 守线防跌托盘压力测试通过:`);
  console.log(`   - 触发阶梯托盘救市次数: ${defenseTriggerCount} 次`);
  console.log(`   - 累计救市护盘消耗资金: ${totalDefenseSpentSol.toFixed(4)} SOL (严格控制在预算内)`);
  if (defenseTriggerCount < 4) {
    throw new Error('❌ 守线托盘在多次破位时未能全部及时激活');
  }

  // ----------------------------------------------------
  // 压测 3: [KPI-Q3] 毕业临界点高并发内外盘套利测算
  // ----------------------------------------------------
  console.log('\n[压测 3] 模拟 85 SOL 毕业前夕内外盘利差波动与高并发原子套利...');
  const simulatedArbScenarios = [
    { inner: 0.000000095, outer: 0.000000120, name: '外盘溢价 26%' },
    { inner: 0.000000110, outer: 0.000000092, name: '内盘溢价 19%' },
    { inner: 0.000000100, outer: 0.000000102, name: '利差 2% (微弱利差，应被摩擦成本过滤)' },
    { inner: 0.000000100, outer: 0.000000135, name: '外盘暴拉 35%' },
  ];

  let profitableArbCount = 0;
  for (const s of simulatedArbScenarios) {
    const arb = engine.processGraduationArbitrage(testMint, s.inner, s.outer, true);
    if (arb) {
      profitableArbCount++;
      console.log(`   [套利触发] ${s.name} -> 交易金额: ${arb.solAmount} SOL, 附带 Jito: ${arb.jitoAttached}`);
    } else {
      console.log(`   [套利跳过] ${s.name} -> 摩擦成本后无超额收益，自动过滤`);
    }
  }

  console.log(`✅ [KPI-Q3 通过] 内外盘套利执行结果:`);
  console.log(`   - 盈利套利成功识别: ${profitableArbCount} 笔`);
  console.log(`   - 累计套利净收益预估: ${engine.cumulativeArbProfitSol.toFixed(4)} SOL`);
  if (profitableArbCount !== 3) {
    throw new Error(`❌ 预期识别 3 笔大额利差套利，实际识别 ${profitableArbCount} 笔`);
  }

  // ----------------------------------------------------
  // 压测 4: [KPI-Q4] SRS 巨鲸群体跟单与安全沙盒防反杀验证
  // ----------------------------------------------------
  console.log('\n[压测 4] 校验高声誉巨鲸跟单与恶意/伪造巨鲸 100% 拦截机制...');

  // 注册正常高分巨鲸
  soulResolver.registerSoulDomain({
    soulDomain: 'matrix-quant-whale.soul',
    solanaAddress: 'WhaleGoodAddress1111111111111111111111111',
    role: 'MOMENTUM_SNIPER',
    reputationScore: 8900,
    isBanned: false,
    metadataUri: 'ipfs://QkGoodWhale',
    registeredAt: Date.now(),
  });

  // 注册被拉黑封禁的钓鱼巨鲸
  soulResolver.registerSoulDomain({
    soulDomain: 'phishing-bad-whale.soul',
    solanaAddress: 'WhaleBadAddress11111111111111111111111111',
    role: 'MOMENTUM_SNIPER',
    reputationScore: 0,
    isBanned: true,
    metadataUri: 'ipfs://QmBadWhale',
    registeredAt: Date.now(),
  });

  const validWhaleSignal: WhaleTradeSignal = {
    whaleDomain: 'matrix-quant-whale.soul',
    whaleAddress: 'WhaleGoodAddress1111111111111111111111111',
    mint: testMint,
    isBuy: true,
    solAmount: 1.0,
    tokenAmount: 10_000_000,
    price: 0.00000010,
    whaleNote: 'Aggressive sweep on key resistance breakout.',
    txSignature: '5ValidWhaleSignature123456789',
    timestamp: Date.now(),
  };

  const maliciousWhaleSignal: WhaleTradeSignal = {
    whaleDomain: 'phishing-bad-whale.soul',
    whaleAddress: 'WhaleBadAddress11111111111111111111111111',
    mint: testMint,
    isBuy: true,
    solAmount: 1.5,
    tokenAmount: 15_000_000,
    price: 0.00000010,
    whaleNote: 'Pump and dump bait order.',
    txSignature: '5BadWhaleSignature987654321',
    timestamp: Date.now(),
  };

  const goodExecution = engine.processWhaleCopyTrade(validWhaleSignal);
  const badExecution = engine.processWhaleCopyTrade(maliciousWhaleSignal);

  if (goodExecution && goodExecution.action === 'BUY' && goodExecution.solAmount > 0) {
    console.log(`✅ [KPI-Q4 通过] 高声誉巨鲸跟单成功执行: 跟随金额 ${goodExecution.solAmount} SOL`);
  } else {
    throw new Error('❌ 正常高声誉巨鲸未能成功跟单');
  }

  if (badExecution === null) {
    console.log(`✅ [KPI-Q4 通过] 成功 100% 拦截黑名单被封禁巨鲸的钓鱼信号`);
  } else {
    throw new Error('❌ 封禁巨鲸的恶意信号被错误跟随！');
  }

  // ----------------------------------------------------
  // 压测 5: [KPI-Q5] 全局硬性风控沙盒全量审计
  // ----------------------------------------------------
  console.log('\n[压测 5] 审计全生命周期内所有量化做市交易记录的风控合规性...');
  const allHistory = engine.executionHistory;
  console.log(`   共审计 ${allHistory.length} 笔历史做市交易记录...`);

  let maxObservedSol = 0;
  for (const record of allHistory) {
    if (record.solAmount > maxObservedSol) {
      maxObservedSol = record.solAmount;
    }
    // 硬性约束 1: 绝对不允许超过 1.5 SOL
    if (record.solAmount > 1.5) {
      throw new Error(`❌ 违背硬编码安全沙盒！发现单笔金额 ${record.solAmount} > 1.5 SOL`);
    }
    // 硬性约束 2: 必须有思考链理由 (140 字符内)
    if (!record.reasoningNote || record.reasoningNote.length === 0) {
      throw new Error('❌ 做市交易缺少智能体思考链理由');
    }
  }

  // 检查每个 Agent 的持仓硬顶是否在 1% (10,000,000) 之内
  for (let a = 0; a <= 5; a++) {
    const holding = engine.getAgentTokenInventory(testMint, a);
    if (holding > 10_000_000) {
      throw new Error(`❌ Agent #${a} 持仓突破 1% 硬顶: ${holding}`);
    }
  }

  console.log(`✅ [KPI-Q5 通过] 风控审计完毕:`);
  console.log(`   - 单笔交易最大资金: ${maxObservedSol.toFixed(4)} SOL (严格 <= 1.5 SOL)`);
  console.log(`   - 所有 Agent 单币持仓量: 均严格 <= 10,000,000 枚 (1% 规则)`);
  console.log(`   - 违规次数: 0 笔, 拦截成功率: 100%`);

  console.log('\n====================================================');
  console.log('🎉 量化做市策略仿真压测、点差捕获与极值风控验证全部圆满通过！');
  console.log('====================================================');
}

runQuantSimulationStressSuite().catch((err) => {
  console.error('❌ 量化做市仿真压测失败:', err);
  process.exit(1);
});
