import { SolanaNodeManager } from '../src/chain/node_manager';
import { DEVNET_CONFIG, MAINNET_CONFIG, getChainConfig } from '../src/config/chain';
import { PublicKey } from '@solana/web3.js';

async function runNodeManagerSuite() {
  console.log('====================================================');
  console.log('🛰️ 启动 Solana 节点连接器与高可用调度验证套件');
  console.log('====================================================');

  // 1. 配置测试
  console.log('\n[测试 1] 校验 Devnet 与 Mainnet 配置参数...');
  const devnetCfg = getChainConfig('devnet');
  const mainnetCfg = getChainConfig('mainnet-beta');

  if (devnetCfg.network !== 'devnet' || devnetCfg.rpcEndpoints.length === 0) {
    throw new Error('Devnet 配置加载失败');
  }
  if (mainnetCfg.network !== 'mainnet-beta' || mainnetCfg.jitoTipAccounts.length !== 8) {
    throw new Error('Mainnet 配置加载失败，Jito 账户数不符');
  }
  console.log(`✅ Devnet 节点数: ${devnetCfg.rpcEndpoints.length}, Jito 引擎: ${devnetCfg.jitoBlockEngineUrl}`);
  console.log(`✅ Mainnet 节点数: ${mainnetCfg.rpcEndpoints.length}, Jito Tip 账户数: ${mainnetCfg.jitoTipAccounts.length}`);

  // 2. 初始化 Devnet Node Manager
  console.log('\n[测试 2] 初始化 SolanaNodeManager 并检查健康状态矩阵...');
  const manager = new SolanaNodeManager('devnet');
  const initialStatuses = manager.getAllHealthStatuses();
  if (initialStatuses.length !== devnetCfg.rpcEndpoints.length) {
    throw new Error('节点初始状态矩阵与端点数不匹配');
  }
  console.log(`✅ 成功为 ${initialStatuses.length} 个 RPC 端点建立健康监控槽位`);

  // 3. 故障转移与容灾调度模拟
  console.log('\n[测试 3] 模拟 RPC 节点限流与自动 Failover 恢复...');
  let callCount = 0;
  const simulatedResult = await manager.executeWithFailover(async (conn) => {
    callCount++;
    if (callCount === 1) {
      // 模拟第一次调用遇到 429 报错
      throw new Error('429 Too Many Requests: node rate limited');
    }
    // 第二次调用成功
    return { success: true, attempts: callCount, endpoint: conn.rpcEndpoint };
  }, 'SimulatedRpcCall');

  if (simulatedResult.success && simulatedResult.attempts === 2) {
    console.log(`✅ 成功捕获 429 限流并自动转移至备用节点执行成功 (调用次数: ${simulatedResult.attempts})`);
  } else {
    throw new Error('故障转移重试逻辑未达预期');
  }

  console.log('\n====================================================');
  console.log('🎉 Solana 高可用节点管理器功能与容灾调度验证通过！');
  console.log('====================================================');
}

runNodeManagerSuite().catch((err) => {
  console.error('❌ 测试失败:', err);
  process.exit(1);
});
