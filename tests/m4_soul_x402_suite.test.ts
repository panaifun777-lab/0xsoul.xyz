import { Keypair } from '@solana/web3.js';
import axios from 'axios';
import { SolanaAgentClusterManager } from '../src/wallet/cluster';
import { GangSoulGateway } from '../src/gateway/server';
import { SoulDomainResolver } from '../src/soul/resolver';
import { X402PaymentEngine } from '../src/x402/middleware';

/**
 * Milestone 4 (M4) .soul 域名桥接与 x402 微支付自动化验证套件
 * 核心指标：
 * 1. [KPI-M4-1] .soul 域名正向与反向解析正确性
 * 2. [KPI-M4-2] Ed25519 权威网关 Attestation 签名与密码学校验
 * 3. [KPI-M4-3] SRS 链上声誉系统动态更新与 0 分惩罚黑名单自动封禁
 * 4. [KPI-M4-4] x402 协议守卫：未支付请求确定性拦截并返回 HTTP 402 + Invoice
 * 5. [KPI-M4-5] 携带支付交易签名后解锁聪明钱 Alpha 信号流
 * 6. [KPI-M4-6] 支付凭据防重放 (Replay Attack) 100% 拦截
 */

async function runM4Suite() {
  console.log('====================================================');
  console.log('🔮 启动 Milestone 4 (M4) .soul 域名桥接与 x402 验证套件');
  console.log('====================================================');

  const testMnemonic =
    'wool vintage lock whisper razor diesel divide plastic unaware shield shock brass abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art';

  const clusterManager = new SolanaAgentClusterManager(testMnemonic);
  clusterManager.warmUpWallets(5);

  const gateway = new GangSoulGateway(clusterManager);
  const TEST_PORT = 3998;
  await gateway.start(TEST_PORT);
  const baseUrl = `http://127.0.0.1:${TEST_PORT}`;
  console.log(`✅ 网关已在测试端口 ${TEST_PORT} 启动 (带 .soul 与 x402 支持)`);

  try {
    const agent0Wallet = clusterManager.getOrDeriveWallet(0);
    const agent1Wallet = clusterManager.getOrDeriveWallet(1);

    // ----------------------------------------------------
    // 测试 1: [KPI-M4-1] .soul 注册、正向解析与反向解析
    // ----------------------------------------------------
    console.log('\n[测试 1] 注册并解析 .soul DID 记录...');
    gateway.soulResolver.registerSoulDomain({
      soulDomain: 'matrix-alpha.soul',
      solanaAddress: agent0Wallet.publicKey.toBase58(),
      role: 'MOMENTUM_SNIPER',
      reputationScore: 8500,
      isBanned: false,
      metadataUri: 'ipfs://QmMatrixAlphaProfileDataHash',
      registeredAt: Date.now(),
    });

    const resolveRes = await axios.get(`${baseUrl}/v1/soul/resolve/matrix-alpha.soul`);
    if (
      resolveRes.status === 200 &&
      resolveRes.data.record.solanaAddress === agent0Wallet.publicKey.toBase58() &&
      resolveRes.data.record.role === 'MOMENTUM_SNIPER'
    ) {
      console.log('✅ [KPI-M4-1 通过] .soul 正向域名解析正确无误');
    } else {
      throw new Error('❌ 正向解析失败');
    }

    const reverseRes = await axios.get(`${baseUrl}/v1/soul/reverse/${agent0Wallet.publicKey.toBase58()}`);
    if (reverseRes.status === 200 && reverseRes.data.record.soulDomain === 'matrix-alpha.soul') {
      console.log('✅ [KPI-M4-1 通过] Solana 钱包公钥反向解析 .soul 身份绑定成功');
    } else {
      throw new Error('❌ 反向解析失败');
    }

    // ----------------------------------------------------
    // 测试 2: [KPI-M4-2] Ed25519 权威网关 Attestation 凭证
    // ----------------------------------------------------
    console.log('\n[测试 2] 申领链上凭证 Attestation 并执行密码学校验...');
    const claimRes = await axios.post(`${baseUrl}/v1/passport/claim`, {
      soulDomain: 'matrix-alpha.soul',
      solanaAddress: agent0Wallet.publicKey.toBase58(),
    });

    const attestation = claimRes.data.attestation;
    if (attestation && attestation.signature && attestation.gatewayPubkey) {
      const isValid = gateway.soulResolver.verifyAttestation(attestation);
      if (isValid) {
        console.log(`✅ [KPI-M4-2 通过] Ed25519 凭证签名离线验证通过！Nonce: ${attestation.nonce}, 过期时间: ${attestation.expiry}`);
      } else {
        throw new Error('❌ 凭证密码学校验失败！');
      }
    } else {
      throw new Error('❌ 凭证数据不完整');
    }

    // ----------------------------------------------------
    // 测试 3: [KPI-M4-3] SRS 声誉系统动态升降阶梯与黑名单拦截
    // ----------------------------------------------------
    console.log('\n[测试 3] 验证 SRS 链上声誉系统降分与自动封禁流转...');
    // 恶意行为触发扣分，直接清零至 0 分
    gateway.soulResolver.updateReputation('matrix-alpha.soul', -9000);
    const bannedRecord = gateway.soulResolver.resolve('matrix-alpha.soul');
    if (bannedRecord && bannedRecord.isBanned && bannedRecord.reputationScore === 0) {
      console.log('✅ 触发严重作弊扣分，声誉归零，系统自动标记 isBanned = true');
    }

    // 尝试在封禁状态下申领凭证，必须被拦截
    try {
      await axios.post(`${baseUrl}/v1/passport/claim`, {
        soulDomain: 'matrix-alpha.soul',
        solanaAddress: agent0Wallet.publicKey.toBase58(),
      });
      throw new Error('❌ 封禁状态的 Agent 依然成功申领了凭证！');
    } catch (err: any) {
      if (err.response && err.response.status === 403 && err.response.data.error.includes('banned')) {
        console.log(`✅ [KPI-M4-3 通过] 成功拦截黑名单 Agent 申领凭证: ${err.response.data.error}`);
      } else {
        throw err;
      }
    }

    // 恢复其良好声誉
    gateway.soulResolver.updateReputation('matrix-alpha.soul', 7000);

    // ----------------------------------------------------
    // 测试 4: [KPI-M4-4] x402 协议守卫：未支付请求拦截
    // ----------------------------------------------------
    console.log('\n[测试 4] 访问受保护的 Alpha 聪明钱情报流 (不带支付头)...');
    let invoiceNonce = '';
    try {
      await axios.get(`${baseUrl}/v1/signals/alpha`);
      throw new Error('❌ 未支付请求未被 HTTP 402 拦截！');
    } catch (err: any) {
      if (err.response && err.response.status === 402) {
        const invHeader = err.response.headers['x-payment-invoice'];
        const invoice = JSON.parse(invHeader);
        invoiceNonce = invoice.paymentNonce;
        console.log(`✅ [KPI-M4-4 通过] 确定性拦截并返回 HTTP 402 Payment Required!`);
        console.log(`   收款金库: ${invoice.recipientVault}, 门票价格: ${invoice.amountSol} SOL, Nonce: ${invoiceNonce}`);
      } else {
        throw err;
      }
    }

    // ----------------------------------------------------
    // 测试 5: [KPI-M4-5] 携带支付交易签名后解锁聪明钱 Alpha 信号
    // ----------------------------------------------------
    console.log('\n[测试 5] 模拟 Agent 钱包链上微支付转账，携带 Tx 签名重新请求...');
    const mockTxSig = `5x402PaidSig_${Date.now()}_${Math.random().toString(36).substring(5)}`;

    const paidRes = await axios.get(`${baseUrl}/v1/signals/alpha`, {
      headers: {
        'x-payment-nonce': invoiceNonce,
        'x-payment-signature': mockTxSig,
      },
    });

    if (paidRes.status === 200 && paidRes.data.authenticated && paidRes.data.signals.length > 0) {
      console.log(`✅ [KPI-M4-5 通过] x402 微支付结算成功！获得 ${paidRes.data.signals.length} 条高价值 Alpha 信号:`);
      console.log(`   Top 信号代币: $${paidRes.data.signals[0].symbol}, 置信度: ${paidRes.data.signals[0].confidenceScore}, 聪明钱净流入: ${paidRes.data.signals[0].smartMoneyInflowSol} SOL`);
      console.log(`   平台微支付资金池累计收益: ${gateway.x402Engine.totalRevenueSol} SOL`);
    } else {
      throw new Error('❌ 微支付结算后未能获取信号');
    }

    // ----------------------------------------------------
    // 测试 6: [KPI-M4-6] 签名防重放攻击 (Replay Attack 拦截率 100%)
    // ----------------------------------------------------
    console.log('\n[测试 6] 模拟恶意 Agent 尝试重放已消费的支付签名...');
    try {
      await axios.get(`${baseUrl}/v1/signals/alpha`, {
        headers: {
          'x-payment-nonce': invoiceNonce,
          'x-payment-signature': mockTxSig, // 重复使用相同签名
        },
      });
      throw new Error('❌ 重放攻击未被拦截！');
    } catch (err: any) {
      if (err.response && err.response.status === 402 && err.response.data.message.includes('Replay attack blocked')) {
        console.log(`✅ [KPI-M4-6 通过] 100% 成功防御重放攻击: ${err.response.data.message}`);
      } else {
        throw err;
      }
    }

    console.log('\n====================================================');
    console.log('🎉 Milestone 4 (M4) .soul 域名桥接与 x402 变现全部指标验证通过！');
    console.log('====================================================');
  } finally {
    await gateway.stop();
  }
}

runM4Suite().catch((err) => {
  console.error('❌ M4 测试套件执行失败:', err);
  process.exit(1);
});
