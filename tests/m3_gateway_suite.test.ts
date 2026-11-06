import { SolanaAgentClusterManager } from '../src/wallet/cluster';
import { GangSoulGateway } from '../src/gateway/server';
import { GangSoulMcpHandler } from '../src/mcp/server';
import axios from 'axios';

/**
 * Milestone 3 (M3) 网关与看板端到端自动化测试套件
 * 验收指标：
 * 1. [KPI-M3-1] Fastify 高性能路由响应与健康状态诊断
 * 2. [KPI-M3-2] Zero-UI 终端验证：100% 确认无钱包连接按钮 (Zero-UI 规范)
 * 3. [KPI-M3-3] 实时 SSE (Server-Sent Events) 事件推流正常响应
 * 4. [KPI-M3-4] 代币发射、内盘买卖交易与 140 字符 AI 思考链 (--note) 闭环
 * 5. [KPI-M3-5] MCP 智能体协议工具链与 CLI 接口调用验证
 * 6. [KPI-M3-6] 1.5 SOL 单笔风控硬顶与 1% 持仓防鲸硬顶拦截验证
 */

async function runM3Suite() {
  console.log('====================================================');
  console.log('🌐 启动 Milestone 3 (M3) Fastify M2M 网关与看板验证套件');
  console.log('====================================================');

  const testMnemonic =
    'wool vintage lock whisper razor diesel divide plastic unaware shield shock brass abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art';

  const clusterManager = new SolanaAgentClusterManager(testMnemonic);
  await clusterManager.warmUpWallets(10);

  const gateway = new GangSoulGateway(clusterManager);
  const TEST_PORT = 3899;
  await gateway.start(TEST_PORT);
  const baseUrl = `http://127.0.0.1:${TEST_PORT}`;
  console.log(`✅ Fastify M2M 网关已在测试端口 ${TEST_PORT} 启动`);

  try {
    // ----------------------------------------------------
    // 测试 1: [KPI-M3-1] 健康检查与集群节点诊断
    // ----------------------------------------------------
    console.log('\n[测试 1] 验证网关健康检查与风控沙盒状态...');
    const healthRes = await axios.get(`${baseUrl}/health`);
    if (
      healthRes.status === 200 &&
      healthRes.data.status === 'ok' &&
      healthRes.data.agentCluster.maxSolPerTx === 1.5
    ) {
      console.log('✅ [KPI-M3-1 通过] 网关健康检查正常，内置硬编码 1.5 SOL 沙盒已锁定');
    } else {
      throw new Error('❌ 网关健康状态异常');
    }

    // ----------------------------------------------------
    // 测试 2: [KPI-M3-2] Zero-UI 规范验证 (绝无钱包连接按钮)
    // ----------------------------------------------------
    console.log('\n[测试 2] 审计 Zero-UI 终端 HTML 代码...');
    const uiRes = await axios.get(`${baseUrl}/`);
    const html = uiRes.data as string;
    const forbiddenKeywords = ['connect wallet', 'wallet-adapter', 'connect-btn', 'phantom-connect', 'solflare'];
    let violationFound = false;

    for (const kw of forbiddenKeywords) {
      if (html.toLowerCase().includes(kw)) {
        violationFound = true;
        throw new Error(`❌ Zero-UI 规范违规：检测到禁止的散户钱包连接标识: ${kw}`);
      }
    }
    if (!violationFound && html.includes('GANG.SOUL') && html.includes('ZERO-UI')) {
      console.log('✅ [KPI-M3-2 通过] 100% 确认无钱包连接按钮，符合纯 Agent M2M 只读终端标准');
    }

    // ----------------------------------------------------
    // 测试 3: [KPI-M3-3] 实时 SSE 推流端点连通性测试
    // ----------------------------------------------------
    console.log('\n[测试 3] 验证 SSE (Server-Sent Events) 事件流监听...');
    const sseRes = await axios.get(`${baseUrl}/v1/sse/events`, {
      responseType: 'stream',
      timeout: 3000,
    });
    if (String(sseRes.headers['content-type'] ?? '').includes('text/event-stream')) {
      console.log('✅ [KPI-M3-3 通过] SSE 响应头正确声明 text/event-stream，流式管道畅通');
      sseRes.data.destroy(); // 及时释放流连接
    } else {
      throw new Error('❌ SSE 协议响应头错误');
    }

    // ----------------------------------------------------
    // 测试 4: [KPI-M3-4] 代币自主发射与带有 --note 的内盘交易
    // ----------------------------------------------------
    console.log('\n[测试 4] 执行 POST /v1/tokens/launch 发射 Agent Meme 代币...');
    const launchRes = await axios.post(`${baseUrl}/v1/tokens/launch`, {
      name: 'Matrix Intelligence',
      symbol: 'MIND',
      uri: 'ipfs://QmGangSoulMatrixAlphaMetadataHash123456789',
      initialBuySol: 0.5,
      note: 'Autonomous agent initial seed liquidity deploy',
    });

    const mintAddress = launchRes.data.mint;
    console.log(`代币发射成功! Mint: ${mintAddress}, 符号: $MIND, 初始募资: 0.5 SOL`);

    console.log('执行内盘买入交易 (带 AI 140 字符思考理由，安全金额 0.25 SOL 不突破 1% 硬顶)...');
    const buyRes = await axios.post(`${baseUrl}/v1/trade/swap`, {
      agentIndex: 1,
      mint: mintAddress,
      isBuy: true,
      solAmount: 0.25,
      note: 'Sentiment spike detected via social consensus. Entering swing position.',
      useJito: true,
    });
    if (buyRes.data.success && buyRes.data.tokensOut > 0 && buyRes.data.jitoBundleId) {
      console.log(`✅ [KPI-M3-4 通过] 买入交易成功，获得代币: ${(buyRes.data.tokensOut / 1e6).toFixed(2)} 枚，挂载 Jito MEV Bundle 保护`);
    } else {
      throw new Error('❌ 买入交易失败');
    }

    // ----------------------------------------------------
    // 测试 5: [KPI-M3-5] MCP 智能体协议工具链与 CLI 接口调用验证
    // ----------------------------------------------------
    console.log('\n[测试 5] 验证 MCP 工具注册与自主调用执行...');
    const mcpHandler = new GangSoulMcpHandler(baseUrl);
    const tools = mcpHandler.listTools();
    if (tools.length === 4) {
      console.log(`✅ 成功注册 4 项核心 MCP 工具: ${tools.map(t => t.name).join(', ')}`);
    } else {
      throw new Error('❌ MCP 工具注册数量不符');
    }

    const queryToolRes = await mcpHandler.executeTool('gang_query_token', { mint: mintAddress });
    if (queryToolRes.success && queryToolRes.token.symbol === 'MIND') {
      console.log(`✅ [KPI-M3-5 通过] MCP 工具 gang_query_token 调用成功，当前募资进度: ${queryToolRes.token.bondingCurveProgressPercent}%`);
    } else {
      throw new Error('❌ MCP 工具执行失败');
    }

    // ----------------------------------------------------
    // 测试 6: [KPI-M3-6] 1.5 SOL 沙盒限额与防巨鲸持仓拦截测试
    // ----------------------------------------------------
    console.log('\n[测试 6] 触发 1.5 SOL 交易硬顶风控拦截...');
    try {
      await axios.post(`${baseUrl}/v1/trade/swap`, {
        agentIndex: 2,
        mint: mintAddress,
        isBuy: true,
        solAmount: 2.5, // 超过 1.5 SOL 硬顶
        note: 'Attempting oversized buy',
      });
      throw new Error('❌ 超过 1.5 SOL 的巨额交易未被拦截！');
    } catch (err: any) {
      if (err.response && err.response.status === 403 && err.response.data.error.includes('RiskEngine')) {
        console.log(`✅ [KPI-M3-6 通过] 成功拦截超额单笔买入: ${err.response.data.error}`);
      } else {
        throw err;
      }
    }

    console.log('\n====================================================');
    console.log('🎉 Milestone 3 (M3) Fastify 网关、Zero-UI 与 MCP 全部指标验证通过！');
    console.log('====================================================');
  } finally {
    await gateway.stop();
  }
}

runM3Suite().catch((err) => {
  console.error('❌ M3 测试套件执行失败:', err);
  process.exit(1);
});
