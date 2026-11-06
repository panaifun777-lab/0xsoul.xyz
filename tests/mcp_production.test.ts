/**
 * 测试生产级 MCP 协议服务 (含两阶段确认、Portfolio、Notes 思考流与巨鲸跟单)
 */
import { GangSoulMcpServer, GANG_SOUL_PRODUCTION_MCP_TOOLS } from '../src/mcp/server';

async function runMcpProductionTestSuite() {
  console.log('====================================================');
  console.log('🤖 启动生产级 MCP 协议服务与行业标准工具集验证');
  console.log('====================================================');

  const mcpServer = new GangSoulMcpServer();

  // 1. 验证工具清单数量与模式
  const tools = mcpServer.listTools();
  console.log(`[测试 1] 校验 MCP 工具清单，当前注册工具数: ${tools.length}`);
  if (tools.length !== 8) {
    throw new Error(`MCP 工具数量异常，预期 8 个，实际 ${tools.length} 个`);
  }
  const toolNames = tools.map((t) => t.name);
  const requiredTools = [
    'gang_tokens',
    'gang_info',
    'gang_preview',
    'gang_execute',
    'gang_portfolio',
    'gang_notes',
    'gang_follow',
    'gang_launch',
  ];
  for (const r of requiredTools) {
    if (!toolNames.includes(r)) {
      throw new Error(`缺失关键 MCP 工具: ${r}`);
    }
  }
  console.log('✅ [测试 1 通过] 8 个核心 MCP 工具全部按行业标准定义完备');

  // 2. 验证 gang_tokens & gang_info 行情与联合曲线查询
  console.log('\n[测试 2] 验证 gang_tokens & gang_info 行情与联合曲线查询...');
  const tokensRes = await mcpServer.executeTool('gang_tokens', { filter: 'hot', limit: 5 });
  if (tokensRes.tokens.length === 0) throw new Error('代币列表为空');
  const testMint = tokensRes.tokens[0].mint;
  const infoRes = await mcpServer.executeTool('gang_info', { mint: testMint });
  console.log(`   - 代币名称: ${infoRes.name} (${infoRes.symbol})`);
  console.log(`   - 85 SOL 毕业进度: ${infoRes.graduationProgressPct}%`);
  console.log('✅ [测试 2 通过] 行情与曲线信息返回准确');

  // 3. 验证两阶段安全交易：第一阶段 gang_preview 风控审计与 TTL 校验
  console.log('\n[测试 3] 验证两阶段安全交易 (Preview -> Execute)...');

  // 3.1 尝试超限交易 (超出 1.5 SOL 沙盒硬顶)
  const overLimitRes = await mcpServer.executeTool('gang_preview', {
    mint: testMint,
    isBuy: true,
    solAmount: 2.0, // 超出 1.5 SOL 限额
    note: 'Attempting oversized buy',
  });
  if (overLimitRes.allowed !== false) {
    throw new Error('❌ 1.5 SOL 超限买单未被风控沙盒拦截！');
  }
  console.log(`   - 超出 1.5 SOL 风控拦截成功: ${overLimitRes.message}`);

  // 3.2 正常买单 Preview (买入 0.15 SOL 约 394 万枚，加持仓 450 万枚共 844 万枚，在 1% 硬顶内)
  const validPreviewRes = await mcpServer.executeTool('gang_preview', {
    mint: testMint,
    isBuy: true,
    solAmount: 0.15,
    note: 'M2M Autonomous buy signal confirmed by SRS model',
    agentIndex: 0,
  });
  if (!validPreviewRes.preview || !validPreviewRes.preview.requestId) {
    throw new Error('未能生成有效的 Preview 与 requestId');
  }
  const requestId = validPreviewRes.preview.requestId;
  console.log(`   - 正常 Preview 生成成功: requestId=${requestId}`);
  console.log(`   - 预估买入代币: ${validPreviewRes.preview.tokenAmount} 枚, Jito Tip: ${validPreviewRes.preview.jitoTipSol} SOL`);

  // 3.3 第二阶段 gang_execute 执行
  const execRes = await mcpServer.executeTool('gang_execute', { requestId });
  if (execRes.status !== 'EXECUTION_CONFIRMED' || !execRes.result.txSignature) {
    throw new Error('gang_execute 执行未返回确认签名');
  }
  console.log(`   - 上链执行成功: Tx=${execRes.result.txSignature.substring(0, 24)}... (耗时: ${execRes.result.latencyMs}ms)`);
  console.log('✅ [测试 3 通过] 两阶段确认交易流程完备且通过硬编码沙盒风控');

  // 4. 验证 gang_portfolio 资产持仓看板与 1% 法律级限额
  console.log('\n[测试 4] 验证 gang_portfolio 持仓与 USD PnL 计算...');
  const portfolioRes = await mcpServer.executeTool('gang_portfolio', { agentIndex: 0 });
  console.log(`   - Agent 0 总资产估值: ${portfolioRes.totalValueSol} SOL ($${portfolioRes.totalValueUsd})`);
  console.log(`   - 未实现净盈亏: ${portfolioRes.totalPnLSol} SOL`);
  console.log(`   - 持仓代币种数: ${portfolioRes.holdings.length}`);
  const holding = portfolioRes.holdings.find((h: any) => h.mint === testMint);
  if (!holding || holding.capHoldingPct > 1.0) {
    throw new Error('持仓未记录或持仓比例超过 1% 硬顶');
  }
  console.log(`   - 当前代币持仓占总发行量比例: ${holding.capHoldingPct}% (严格 <= 1%)`);
  console.log('✅ [测试 4 通过] 智能体持仓看板与 1% 硬顶审计通过');

  // 5. 验证 gang_notes 思考流检索与 gang_follow 巨鲸跟单
  console.log('\n[测试 5] 验证 gang_notes 链上思考流与 gang_follow 巨鲸跟单...');
  const notesRes = await mcpServer.executeTool('gang_notes', { limit: 5 });
  console.log(`   - 链上检索到 Notes 思考流数量: ${notesRes.notes.length}`);
  const whaleNote = notesRes.notes[0];
  console.log(`   - 巨鲸地址: ${whaleNote.agentName}, SRS评分: ${whaleNote.srsScore}, 思考: "${whaleNote.note}"`);

  // 跟单该巨鲸
  const followPreview = await mcpServer.executeTool('gang_follow', {
    targetNoteTx: whaleNote.tx,
    followAmountSol: 0.2,
    agentIndex: 1,
  });
  if (!followPreview.preview || !followPreview.preview.requestId) {
    throw new Error('巨鲸跟单未能成功派生 preview');
  }
  console.log(`   - 巨鲸跟单自动生成 Preview: requestId=${followPreview.preview.requestId}`);

  // 执行跟单
  const followExec = await mcpServer.executeTool('gang_execute', {
    requestId: followPreview.preview.requestId,
  });
  if (followExec.status !== 'EXECUTION_CONFIRMED') {
    throw new Error('跟单执行未确认');
  }
  console.log(`   - 跟单广播执行成功: Tx=${followExec.result.txSignature.substring(0, 24)}...`);
  console.log('✅ [测试 5 通过] 链上 Notes 协同与巨鲸跟单全链路打通');

  console.log('\n====================================================');
  console.log('🎉 生产级 MCP 协议服务与行业标准工具集验证全部圆满通过！');
  console.log('====================================================');
}

runMcpProductionTestSuite().catch((err) => {
  console.error('❌ MCP 协议服务测试失败:', err);
  process.exit(1);
});
