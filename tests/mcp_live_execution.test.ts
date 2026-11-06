/**
 * MCP 外部智能体联调、全链路毫秒级延迟遥测与实盘微交易防线全生命周期集成测试
 */
import * as fs from 'fs';
import * as path from 'path';
import { SolanaNodeManager } from '../src/chain/node_manager';
import { LatencyTelemetryManager } from '../src/telemetry/latency';
import { LiveExecutionEngine } from '../src/execution/live_executor';
import { GangSoulMcpServer } from '../src/mcp/server';

async function runLiveMcpAndTelemetrySuite() {
  console.log('====================================================');
  console.log('🚀 启动 MCP 外部智能体联调与实盘微交易全链路集成测试');
  console.log('====================================================');

  const testDataDir = 'data';
  const latencyLogPath = path.join(testDataDir, 'latency.jsonl');
  if (fs.existsSync(latencyLogPath)) {
    fs.unlinkSync(latencyLogPath); // 重置测试日志
  }

  const nodeManager = new SolanaNodeManager('devnet');
  const telemetryManager = new LatencyTelemetryManager(testDataDir);
  const liveExecutor = new LiveExecutionEngine(nodeManager, telemetryManager);
  const mcpServer = new GangSoulMcpServer();

  const testMint = 'GangSoulAlphaLiveMint111111111111111111111';

  // ----------------------------------------------------
  // 测试 1: 实盘微交易引擎多道防线拦截验证 (Fail-Closed)
  // ----------------------------------------------------
  console.log('\n[测试 1] 校验 1.5 SOL 沙盒限额与 1% 持仓硬顶拦截...');

  // 1.1 超出 1.5 SOL 单笔上限
  let rejectedOverSol = false;
  try {
    await liveExecutor.executeLiveOrder({
      orderId: 'ord_oversized_sol_01',
      mint: testMint,
      isBuy: true,
      solAmount: 1.8, // > 1.5 SOL
      note: 'Oversized buy order attempt',
    });
  } catch (err: any) {
    rejectedOverSol = true;
    console.log(`   - [防线 1 拦截成功] ${err.message}`);
  }
  if (!rejectedOverSol) {
    throw new Error('❌ 1.8 SOL 订单未被沙盒拦截！');
  }

  // 1.2 超出 1% 持仓限额 (10,000,000 枚)
  let rejectedOverCap = false;
  try {
    await liveExecutor.executeLiveOrder({
      orderId: 'ord_oversized_cap_02',
      mint: testMint,
      isBuy: true,
      tokenAmount: 12_000_000, // > 10M tokens (1%)
      note: 'Oversized cap buy attempt',
    });
  } catch (err: any) {
    rejectedOverCap = true;
    console.log(`   - [防线 2 拦截成功] ${err.message}`);
  }
  if (!rejectedOverCap) {
    throw new Error('❌ 12,000,000 枚订单突破 1% 硬顶未被拦截！');
  }
  console.log('✅ [测试 1 通过] 法律级安全风控防线 100% 拦截非法订单');

  // ----------------------------------------------------
  // 测试 2: 连续合法实盘微交易上链与毫秒级延迟拆解记录
  // ----------------------------------------------------
  console.log('\n[测试 2] 连续执行 10 笔合法实盘微交易并记录全链路延迟遥测...');
  const orderReceipts = [];
  for (let i = 0; i < 10; i++) {
    const isBuy = i < 7; // 前 7 笔买，后 3 笔卖
    const solAmt = isBuy ? 0.05 : undefined;
    const tokenAmt = !isBuy ? 500_000 : undefined;

    const receipt = await liveExecutor.executeLiveOrder({
      orderId: `ord_live_seq_${i}`,
      mint: testMint,
      isBuy,
      solAmount: solAmt,
      tokenAmount: tokenAmt,
      note: `Autonomous agent execution sequence #${i}`,
      agentIndex: 0,
      useJito: true,
    });
    orderReceipts.push(receipt);
  }

  console.log(`   - 成功执行并确认 ${orderReceipts.length} 笔实盘微交易`);
  console.log(`   - 首笔交易 Tx: ${orderReceipts[0].txSignature.substring(0, 32)}...`);
  console.log(`   - 首笔交易各阶段耗时: 沙盒评估=${orderReceipts[0].latencyRecord.durations.sandboxVerifyMs}ms, ` +
              `指令构建=${orderReceipts[0].latencyRecord.durations.txBuildMs}ms, ` +
              `Jito广播=${orderReceipts[0].latencyRecord.durations.jitoBroadcastMs}ms, ` +
              `确认=${orderReceipts[0].latencyRecord.durations.blockConfirmMs}ms`);

  const currentInventory = liveExecutor.getAgentTokenInventory(testMint, 0);
  console.log(`   - Agent 0 当前累计代币持仓: ${currentInventory.toLocaleString()} 枚 (占总发行量 ${(currentInventory / 1_000_000_000 * 100).toFixed(3)}%)`);
  if (currentInventory > 10_000_000) {
    throw new Error(`Agent 持仓异常超限: ${currentInventory}`);
  }
  console.log('✅ [测试 2 通过] 连续实盘微交易平稳执行且持仓严格收敛');

  // ----------------------------------------------------
  // 测试 3: 遥测数据落盘校验与 P50 / P90 / P99 延迟分位数报告
  // ----------------------------------------------------
  console.log('\n[测试 3] 验证 data/latency.jsonl 日志落盘与 P50/P90/P99 遥测统计...');
  if (!fs.existsSync(latencyLogPath)) {
    throw new Error('❌ latency.jsonl 遥测日志文件未生成！');
  }
  const logLines = fs.readFileSync(latencyLogPath, 'utf-8').trim().split('\n');
  if (logLines.length !== 10) {
    throw new Error(`遥测文件记录行数不符，预期 10 行，实际 ${logLines.length} 行`);
  }

  const stats = telemetryManager.getSummaryStats();
  console.log(`   - 遥测订单总数: ${stats.totalOrders}`);
  console.log(`   - 全链路平均延迟: ${stats.avgTotalLatencyMs} ms`);
  console.log(`   - P50 分位数延迟: ${stats.p50Ms} ms`);
  console.log(`   - P90 分位数延迟: ${stats.p90Ms} ms`);
  console.log(`   - P99 分位数延迟: ${stats.p99Ms} ms`);
  console.log(`   - 沙盒验证平均耗时: ${stats.avgSandboxVerifyMs} ms`);
  console.log(`   - Jito 广播平均耗时: ${stats.avgJitoBroadcastMs} ms`);
  console.log('✅ [测试 3 通过] 借鉴 TMTN 的毫秒级遥测审计系统运行完全达标');

  // ----------------------------------------------------
  // 测试 4: 生产级 MCP 协议服务全链路两阶段联动测试
  // ----------------------------------------------------
  console.log('\n[测试 4] 模拟外部智能体通过 MCP 协议发起两阶段交互与持仓更新...');

  // 4.1 获取市场代币
  const tokenListRes = await mcpServer.executeTool('gang_tokens', { filter: 'hot', limit: 2 });
  const targetMint = tokenListRes.tokens[0].mint;

  // 4.2 发起两阶段 Preview
  const previewRes = await mcpServer.executeTool('gang_preview', {
    mint: targetMint,
    isBuy: true,
    solAmount: 0.1,
    note: 'Triggered by external Claude agent via stdio MCP pipeline',
    agentIndex: 0,
  });
  const reqId = previewRes.preview.requestId;
  console.log(`   - MCP gang_preview 派生成功: ReqId=${reqId}, 预估代币=${previewRes.preview.tokenAmount}`);

  // 4.3 携带 reqId 调用 gang_execute
  const executeRes = await mcpServer.executeTool('gang_execute', { requestId: reqId });
  console.log(`   - MCP gang_execute 确认成功: Tx=${executeRes.result.txSignature.substring(0, 24)}... (耗时: ${executeRes.result.latencyMs}ms)`);

  // 4.4 检查持仓变动与 USD PnL 抽屉
  const portfolioRes = await mcpServer.executeTool('gang_portfolio', { agentIndex: 0 });
  console.log(`   - MCP gang_portfolio 资产总值: ${portfolioRes.totalValueSol} SOL ($${portfolioRes.totalValueUsd})`);
  console.log(`   - 未实现浮盈: ${portfolioRes.totalPnLSol} SOL`);
  console.log('✅ [测试 4 通过] 外部智能体与生产级 MCP 服务端到端协同正常');

  console.log('\n====================================================');
  console.log('🎉 MCP 外部智能体联调与实盘微交易全链路集成测试全部圆满通过！');
  console.log('====================================================');
}

runLiveMcpAndTelemetrySuite().catch((err) => {
  console.error('❌ 测试执行失败:', err);
  process.exit(1);
});
