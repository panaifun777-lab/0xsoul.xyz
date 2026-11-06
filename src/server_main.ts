/**
 * 0x.SOUL 网关与 Zero-UI 终端生产启动入口
 * 端口默认 3000，提供 RESTful API、SSE 实时思考流与纯只读终端看板
 */
import { loadEnv } from './config/env';

// 必须在任何业务模块读取 process.env 之前加载配置
loadEnv();

import { GangSoulGateway } from './gateway/server';
import { SolanaAgentClusterManager } from './wallet/cluster';
import { DEFAULT_SECURITY_POLICY } from './wallet/policy';
import { getProtocolRevenueConfig } from './config/graduation';

async function bootstrapGateway() {
  const mnemonic = process.env.AGENT_MNEMONIC || 
    'wool vintage lock whisper razor diesel divide plastic unaware shield shock brass abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art';
  
  const port = parseInt(process.env.PORT || '3000', 10);
  const host = process.env.HOST || '0.0.0.0';

  console.log('========================================================');
  console.log('🚀 正在启动 0x.SOUL 网关与 Zero-UI 终端服务...');
  console.log('========================================================');

  // 初始化钱包集群管理器
  const clusterManager = new SolanaAgentClusterManager(mnemonic);
  await clusterManager.warmUpWallets(10);
  console.log('✅ 10 个 Agent 执行子钱包预热完成，沙盒安全策略装载完毕');

  // 初始化 Fastify 网关
  const gateway = new GangSoulGateway(clusterManager);

  await gateway.start(port, host);
  console.log(`🌐 [0x.SOUL GATEWAY] 服务已成功监听在: http://${host}:${port}`);
  console.log(`📊 [ZERO-UI TERMINAL] 实时终端看板访问: http://${host}:${port}/terminal`);
  console.log(`📡 [SSE EVENT STREAM] 实时思考流监听: http://${host}:${port}/v1/sse/events`);

  // 优雅停机保护
  const shutdown = async (signal: string) => {
    console.log(`\n🛑 接收到 ${signal} 信号，正在优雅关闭网关服务...`);
    await gateway.stop();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

bootstrapGateway().catch((err) => {
  console.error('❌ 网关服务启动致命错误:', err);
  process.exit(1);
});
