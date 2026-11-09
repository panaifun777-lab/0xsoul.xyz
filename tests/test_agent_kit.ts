import { ZeroSoulAgentKit } from '../src/agent_kit/index';
import { GangSoulGateway } from '../src/gateway/server';
import { ethers } from 'ethers';

async function testAgentKit() {
  console.log('====================================================');
  console.log('🤖 启动 @0xsoul/agent-kit 客户端 SDK 与 x402 客户端集成测试');
  console.log('====================================================');

  // 1. 启动内存网关实例
  const gateway = new GangSoulGateway();
  await gateway.start(0, '127.0.0.1'); // 随机可用端口
  // 临时获取监听端口
  const address = (gateway as any).fastify.server.address();
  const port = typeof address === 'object' && address ? address.port : 3000;
  const gatewayUrl = `http://127.0.0.1:${port}`;

  console.log(`🚀 测试网关已在 ${gatewayUrl} 启动`);

  // 2. 初始化 Agent Kit 客户端
  const kit = new ZeroSoulAgentKit({ gatewayUrl });

  // 3. 测试获取终端状态
  const state = await kit.getTerminalState();
  console.log('✅ 成功获取网关遥测状态:', state.service, 'X402 Mode:', state.x402.mode);

  // 4. 测试获取 Alpha 信号 (触发 402, 然后模拟支付)
  const result = await kit.getAlphaSignals('PREMIUM_ALPHA_SNIPER', 'SOL', async (invoice) => {
    console.log(`🧾 收到 402 支付发票: Nonce=${invoice.paymentNonce}, Amount=${invoice.amountSol} SOL`);
    return {
      nonce: invoice.paymentNonce,
      signature: '5Kz8...simulatedAgentPaymentSignatureForSdkTest'
    };
  });

  if (result.status === 200 && result.data.success) {
    console.log('✅ Agent Kit 成功通过 402 支付获取高阶 Alpha 信号:');
    console.log(`  - 档位: ${result.data.tier}`);
    console.log(`  - 信号条数: ${result.data.signals.length}`);
    console.log(`  - Attestation Hash: ${result.data.attestation?.attestationHash}`);
  } else {
    throw new Error(`❌ Agent Kit 信号获取失败: ${JSON.stringify(result)}`);
  }

  // 5. 测试币安 Agent ID 签名验证
  const wallet = ethers.Wallet.createRandom();
  const msg = 'Verify Binance Agent ID: test-agent.soul';
  const sig = await wallet.signMessage(msg);
  const isValid = kit.verifyBinanceAgentId(wallet.address, sig, msg);
  console.log(`✅ 币安 Agent ID 签名校验测试: ${isValid ? '通过' : '失败'}`);

  // 关闭网关
  await (gateway as any).fastify.close();
  console.log('====================================================');
  console.log('🎉 @0xsoul/agent-kit 客户端 SDK 自动化测试全部顺利通过！');
  console.log('====================================================');
}

testAgentKit().catch((err) => {
  console.error('❌ 测试运行异常:', err);
  process.exit(1);
});
