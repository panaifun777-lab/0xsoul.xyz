/**
 * 0x.SOUL MCP stdio 协议守护入口 (MCP Stdio Daemon)
 * 供 Claude Desktop、Cursor 等外部 AI Agent 宿主通过标准输入输出 (stdio) 调用 8 大生产级工具
 */
import { loadEnv } from './config/env';

// 必须在任何业务模块读取 process.env 之前加载配置
loadEnv();

import { GangSoulMcpServer } from './mcp/server';

function bootstrapMcpStdioDaemon() {
  const server = new GangSoulMcpServer();
  // 输出启动诊断到 stderr，绝不污染 stdout (stdout 专用于 JSON-RPC 2.0 传输)
  console.error('========================================================');
  console.error('🤖 0x.SOUL MCP Stdio 协议守护服务已激活');
  console.error(`🛠️ 已注册生产级工具数: ${server.listTools().length}`);
  console.error('📡 正在监听 stdin JSON-RPC 2.0 消息流...');
  console.error('========================================================');

  server.startStdioServer();
}

bootstrapMcpStdioDaemon();
