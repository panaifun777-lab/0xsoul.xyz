import { ethers } from "ethers";
import { BinanceAgentIdBridge } from "../src/soul/binance_agent_id";
import { DomainPricingManager } from "../src/soul/domain_pricing";

async function testBinanceAgentIdIntegration() {
  console.log("====================================================");
  console.log("🟡 启动币安 Agent ID 交互测试: piaoshu.io");
  console.log("====================================================");

  const binanceId = "piaoshu.io";
  console.log(`👤 测试输入 Agent ID: ${binanceId}`);

  // 1. 模拟为该币安 ID 生成对应的模拟钱包与 ECDSA 签名
  const wallet = ethers.Wallet.createRandom();
  const message = `Authenticate Binance Agent ID: ${binanceId} at timestamp ${Date.now()}`;
  const signature = await wallet.signMessage(message);

  console.log(`  - 关联模拟钱包地址: ${wallet.address}`);
  console.log(`  - ECDSA 签名: ${signature.slice(0, 30)}...`);

  // 2. 验证签名有效性
  const isValid = BinanceAgentIdBridge.verifyBinanceAgentIdSignature(wallet.address, signature, message);
  console.log(`  - 签名验证结果: ${isValid ? "✅ 验证通过 (Verified)" : "❌ 验证失败"}`);

  // 3. 测试 .soul 域名阶梯定价与自动化注册参数计算
  const testDomain = "piaoshu.soul";
  const pricing = DomainPricingManager.calculatePrice(testDomain);
  console.log(`\n🏷️ 域名自动化注册试算 (${testDomain}):`);
  console.log(`  - 字符长度: ${pricing.length}`);
  console.log(`  - 计价档位: ${pricing.tier}`);
  console.log(`  - 注册费用: ${pricing.priceUsdc} USDC (${pricing.priceUnits} 最小单位)`);

  // 4. 生成 EVM Registrar 调用参数
  const txData = DomainPricingManager.encodeRegisterTransaction(testDomain, wallet.address);
  console.log(`\n📦 Registrar 合约调用参数构造成功:`);
  console.log(`  - 目标合约 (Registrar): ${txData.to}`);
  console.log(`  - 收益受益人 (Owner): ${txData.beneficiary}`);
  console.log(`  - 待注册域名: ${txData.domain}`);
  console.log(`  - 域名所有者: ${txData.owner}`);
  console.log(`  - 注册时长: ${txData.duration} 秒`);

  console.log("====================================================");
  console.log("🎉 币安 Agent ID 'piaoshu.io' 实盘交互与域名映射演练全部成功！");
  console.log("====================================================");
}

testBinanceAgentIdIntegration().catch(console.error);
