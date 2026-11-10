/**
 * 托管远程 MCP HTTP JSON-RPC 2.0 端点集成测试 (/v1/mcp)
 */
import { GangSoulGateway } from '../src/gateway/server';
import axios from 'axios';

async function runRemoteMcpHttpTest() {
  console.log('====================================================');
  console.log('🚀 启动托管远程 MCP HTTP JSON-RPC 2.0 端点测试');
  console.log('====================================================');

  const gateway = new GangSoulGateway();
  const port = 3988;
  await gateway.start(port, '127.0.0.1');
  console.log(`✅ 网关已启动并在 http://127.0.0.1:${port}`);

  try {
    // 测试 1: tools/list 请求
    console.log('\n[测试 1] 发送 tools/list JSON-RPC 请求...');
    const listRes = await axios.post(`http://127.0.0.1:${port}/v1/mcp`, {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
      params: {},
    });

    const listData = listRes.data;
    console.log(`   - 响应状态: ${listRes.status}`);
    console.log(`   - 返回工具数量: ${listData.result.tools.length}`);
    if (listData.result.tools.length !== 8) {
      throw new Error(`预期 8 个工具，实际返回 ${listData.result.tools.length}`);
    }
    console.log('✅ [测试 1 通过] tools/list 返回正确');

    // 测试 2: tools/call 调用 gang_tokens
    console.log('\n[测试 2] 发送 tools/call (gang_tokens) JSON-RPC 请求...');
    const callRes = await axios.post(`http://127.0.0.1:${port}/v1/mcp`, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'gang_tokens',
        arguments: { filter: 'hot', limit: 3 },
      },
    });

    const callData = callRes.data;
    console.log(`   - JSON-RPC ID: ${callData.id}`);
    console.log(`   - 工具调用结果摘要: ${callData.result.content[0].text.substring(0, 100)}...`);
    console.log('✅ [测试 2 通过] tools/call gang_tokens 成功');

    // 测试 3: /init-agent.js 配置助手脚本可下载
    console.log('\n[测试 3] 下载 /init-agent.js 配置助手脚本...');
    const scriptRes = await axios.get(`http://127.0.0.1:${port}/init-agent.js`, { responseType: 'text' });
    const scriptText = String(scriptRes.data);
    if (scriptRes.status !== 200 || !scriptText.includes('0x.SOUL') || !scriptText.includes('mcpServers')) {
      throw new Error('init-agent.js 内容不正确');
    }
    console.log(`   - 脚本字节数: ${scriptText.length}`);
    console.log('✅ [测试 3 通过] /init-agent.js 可下载且内容正确');

    // 测试 4: /llms.txt 含远程 MCP 规范
    console.log('\n[测试 4] 校验 /llms.txt 远程 MCP 规范...');
    const llmsRes = await axios.get(`http://127.0.0.1:${port}/llms.txt`, { responseType: 'text' });
    const llmsText = String(llmsRes.data);
    for (const needle of ['Hosted Remote MCP', '/v1/mcp', 'gang_preview', 'init-agent.js']) {
      if (!llmsText.includes(needle)) throw new Error(`/llms.txt 缺少: ${needle}`);
    }
    console.log('✅ [测试 4 通过] /llms.txt 含完整远程 MCP 规范与工具清单');

    // 测试 5: /docs 含远程 MCP 接入专节
    console.log('\n[测试 5] 校验 /docs 远程 MCP 接入专节...');
    const docsRes = await axios.get(`http://127.0.0.1:${port}/docs`, { responseType: 'text' });
    const docsText = String(docsRes.data);
    for (const needle of ['id="mcp"', 'Remote MCP Integration', 'init-agent.js', 'gang_launch']) {
      if (!docsText.includes(needle)) throw new Error(`/docs 缺少: ${needle}`);
    }
    console.log('✅ [测试 5 通过] /docs 含远程 MCP 接入专节');

    console.log('\n====================================================');
    console.log('🎉 托管远程 MCP HTTP JSON-RPC 2.0 端点测试全部通过！');
    console.log('====================================================');
  } finally {
    await gateway.stop();
    console.log('✅ 网关测试服务已安全关闭');
  }
}

runRemoteMcpHttpTest().catch((err) => {
  console.error('❌ 远程 MCP 测试失败:', err);
  process.exit(1);
});
