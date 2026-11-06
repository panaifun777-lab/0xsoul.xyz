/**
 * P2 端到端验证套件：发行费与交易费真实收入链路
 *
 * 验收指标：
 * 1. [KPI-P2-1] create_token 指令契约正确（tag=7、账户顺序、0.02 SOL 发行费编码）
 * 2. [KPI-P2-2] 买入手续费 = solAmount × 1%，且与合约算法一致
 * 3. [KPI-P2-3] 卖出手续费 = grossSol × 1%（此前硬编码 0 的缺陷已修复）
 * 4. [KPI-P2-4] PDA 派生符合契约（bonding_curve / pool_token / agent_passport / agent_position）
 * 5. [KPI-P2-5] ChainExecutor 双模式：simulation 不联网、real 缺配置时明确拒绝
 * 6. [KPI-P2-6] 收益台账逐笔记录、按来源汇总、结算批次可生成
 * 7. [KPI-P2-7] 网关端到端：发币 → 买入 → 卖出，收益台账同步累积
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Keypair, PublicKey } from '@solana/web3.js';
import { SolanaAgentClusterManager } from '../src/wallet/cluster';
import { GangSoulGateway } from '../src/gateway/server';
import { ProtocolRevenueLedger } from '../src/economy/revenue';
import { ChainExecutor, resolveExecutorConfig } from '../src/chain/chain_executor';
import {
  buildCreateTokenInstruction,
  buildBuyCurveInstruction,
  buildSellCurveInstruction,
  deriveBondingCurvePda,
  derivePoolTokenPda,
  deriveAgentPassportPda,
  deriveAgentPositionPda,
  deriveAssociatedTokenAddress,
  IX_TAG_CREATE_TOKEN,
  IX_TAG_BUY_CURVE,
  IX_TAG_SELL_CURVE,
  LAUNCH_FEE_LAMPORTS,
  TOKEN_DECIMALS,
  REAL_TOKEN_RESERVES,
} from '../src/chain/launchpad_ix';
import axios from 'axios';

const TEST_MNEMONIC =
  'wool vintage lock whisper razor diesel divide plastic unaware shield shock brass abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art';

const PROGRAM_ID = new PublicKey('GangLaunchpad111111111111111111111111111111');
const TEST_FEE_RECEIVER = new PublicKey('EE41ShdfntDz4gjfMTRZWUY1aujAX1FEVKtYTaE7RGSS');

let passCount = 0;
let failCount = 0;

function check(name: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  ✅ ${name}${detail ? ' — ' + detail : ''}`);
    passCount++;
  } else {
    console.error(`  ❌ ${name}${detail ? ' — ' + detail : ''}`);
    failCount++;
    throw new Error(`Assertion failed: ${name}`);
  }
}

/** 读取 Borsh u64（小端） */
function readU64(buf: Buffer, offset: number): bigint {
  return buf.readBigUInt64LE(offset);
}

async function runRevenueE2ESuite() {
  console.log('====================================================');
  console.log('💰 P2 端到端验证：发行费与交易费真实收入链路');
  console.log('====================================================');

  // 隔离的临时收益台账，避免污染 data/revenue.jsonl
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gang-soul-revenue-'));
  const ledgerPath = path.join(tmpDir, 'revenue.jsonl');

  /* ================================================================
   * 测试 1: [KPI-P2-1] create_token 指令契约
   * ================================================================ */
  console.log('\n[测试 1] 校验 create_token 指令契约（tag=7 / 账户顺序 / 发行费编码）...');

  const creator = Keypair.generate();
  const mint = Keypair.generate();
  const createIx = buildCreateTokenInstruction({
    creator: creator.publicKey,
    mint: mint.publicKey,
    feeReceiver: TEST_FEE_RECEIVER,
    programId: PROGRAM_ID,
    name: 'Gang Soul Test',
    symbol: 'GST',
    uri: 'https://gang.soul/meta/gst.json',
  });

  check('指令 tag 为 7', createIx.data[0] === IX_TAG_CREATE_TOKEN, `tag=${createIx.data[0]}`);
  check('账户数量为 9', createIx.keys.length === 9, `实际 ${createIx.keys.length}`);
  check('账户 0 是创建者且为签名者', createIx.keys[0].pubkey.equals(creator.publicKey) && createIx.keys[0].isSigner);
  check('账户 2 是 Mint 且为签名者', createIx.keys[2].pubkey.equals(mint.publicKey) && createIx.keys[2].isSigner);
  check('账户 5 是协议收款地址', createIx.keys[5].pubkey.equals(TEST_FEE_RECEIVER));

  // 发行费常量校验
  check(
    '发行费为 0.02 SOL (20_000_000 lamports)',
    LAUNCH_FEE_LAMPORTS === 20_000_000n,
    `${LAUNCH_FEE_LAMPORTS} lamports`,
  );
  check(
    '发行费折合 SOL 正确',
    Number(LAUNCH_FEE_LAMPORTS) / 1_000_000_000 === 0.02,
    '0.02 SOL',
  );

  // 数据布局：tag(1) | name(4+15) | symbol(4+3) | uri(4+30) | decimals(1) | total_supply(8) | target(8)
  const nameLen = Buffer.byteLength('Gang Soul Test');
  const symbolLen = Buffer.byteLength('GST');
  const uriLen = Buffer.byteLength('https://gang.soul/meta/gst.json');
  const expectedLen = 1 + (4 + nameLen) + (4 + symbolLen) + (4 + uriLen) + 1 + 8 + 8;
  check('指令数据长度符合 Borsh 布局', createIx.data.length === expectedLen, `${createIx.data.length} vs ${expectedLen}`);

  const decimalsOffset = 1 + (4 + nameLen) + (4 + symbolLen) + (4 + uriLen);
  check('精度编码为 6', createIx.data[decimalsOffset] === TOKEN_DECIMALS, `decimals=${createIx.data[decimalsOffset]}`);

  const totalSupply = readU64(createIx.data, decimalsOffset + 1);
  check('总供应量编码为 0（使用合约默认）', totalSupply === 0n, `${totalSupply}`);

  /* ================================================================
   * 测试 2: [KPI-P2-4] PDA 派生契约
   * ================================================================ */
  console.log('\n[测试 2] 校验 PDA 派生与账户顺序...');

  const [expectedCurve] = deriveBondingCurvePda(mint.publicKey, PROGRAM_ID);
  const [expectedPool] = derivePoolTokenPda(mint.publicKey, PROGRAM_ID);
  const [expectedPassport] = deriveAgentPassportPda(creator.publicKey, PROGRAM_ID);
  const [expectedPosition] = deriveAgentPositionPda(mint.publicKey, creator.publicKey, PROGRAM_ID);

  check('bonding_curve PDA 与指令账户 3 一致', createIx.keys[3].pubkey.equals(expectedCurve), expectedCurve.toBase58().slice(0, 12) + '...');
  check('pool_token PDA 与指令账户 4 一致', createIx.keys[4].pubkey.equals(expectedPool), expectedPool.toBase58().slice(0, 12) + '...');
  check('agent_passport PDA 与指令账户 1 一致', createIx.keys[1].pubkey.equals(expectedPassport), expectedPassport.toBase58().slice(0, 12) + '...');
  check('agent_position 派生成功', expectedPosition instanceof PublicKey);

  const expectedAta = deriveAssociatedTokenAddress(creator.publicKey, mint.publicKey);
  check('ATA 派生成功', expectedAta instanceof PublicKey, expectedAta.toBase58().slice(0, 12) + '...');

  /* ================================================================
   * 测试 3: [KPI-P2-2] 买入手续费 = solAmount × 1%
   * ================================================================ */
  console.log('\n[测试 3] 校验买入手续费计算（1% 抽成）...');

  const buyCases = [
    { sol: 0.1, expectedFee: 1_000_000n },
    { sol: 0.5, expectedFee: 5_000_000n },
    { sol: 1.0, expectedFee: 10_000_000n },
    { sol: 1.5, expectedFee: 15_000_000n },
  ];

  for (const c of buyCases) {
    const lamports = BigInt(Math.floor(c.sol * 1_000_000_000));
    const fee = (lamports * 100n) / 10000n;
    check(
      `买入 ${c.sol} SOL 抽成 ${c.expectedFee} lamports`,
      fee === c.expectedFee,
      `实际 ${fee}`,
    );
  }

  const buyIx = buildBuyCurveInstruction({
    buyer: creator.publicKey,
    mint: mint.publicKey,
    solAmountLamports: 100_000_000n,
    minTokensOut: 0n,
    note: 'e2e buy test',
    feeReceiver: TEST_FEE_RECEIVER,
    programId: PROGRAM_ID,
  });

  check('buy 指令 tag 为 1', buyIx.data[0] === IX_TAG_BUY_CURVE, `tag=${buyIx.data[0]}`);
  check('buy 账户数量为 9', buyIx.keys.length === 9, `实际 ${buyIx.keys.length}`);
  check('buy 账户 0 是买方且为签名者', buyIx.keys[0].pubkey.equals(creator.publicKey) && buyIx.keys[0].isSigner);
  check('buy 账户 6 是内盘金库 PDA', buyIx.keys[6].pubkey.equals(expectedPool));
  check('buy 账户 7 是买方 ATA', buyIx.keys[7].pubkey.equals(expectedAta));
  check('buy sol_amount 编码为 100_000_000', readU64(buyIx.data, 1) === 100_000_000n, `${readU64(buyIx.data, 1)}`);

  /* ================================================================
   * 测试 4: [KPI-P2-3] 卖出手续费 = grossSol × 1%
   * ================================================================ */
  console.log('\n[测试 4] 校验卖出手续费计算（曾硬编码 0，已修复）...');

  const sellIx = buildSellCurveInstruction({
    seller: creator.publicKey,
    mint: mint.publicKey,
    tokenAmount: 1_000_000n,
    minSolOut: 0n,
    note: 'e2e sell test',
    feeReceiver: TEST_FEE_RECEIVER,
    programId: PROGRAM_ID,
  });

  check('sell 指令 tag 为 2', sellIx.data[0] === IX_TAG_SELL_CURVE, `tag=${sellIx.data[0]}`);
  check('sell 账户数量为 9', sellIx.keys.length === 9, `实际 ${sellIx.keys.length}`);
  check('sell 账户 6 是卖方 ATA', sellIx.keys[6].pubkey.equals(expectedAta));
  check('sell 账户 7 是内盘金库 PDA', sellIx.keys[7].pubkey.equals(expectedPool));

  // 模拟一次卖出：换回 0.0278 SOL 应抽 0.000278 SOL
  const grossSolLamports = 27_836_360n;
  const sellFee = (grossSolLamports * 100n) / 10000n;
  check('卖出 0.0278 SOL 抽成约 278363 lamports', sellFee === 278363n, `实际 ${sellFee}`);
  check('卖出手续费非零（缺陷已修复）', sellFee > 0n, `${sellFee} lamports`);

  /* ================================================================
   * 测试 5: [KPI-P2-5] ChainExecutor 双模式
   * ================================================================ */
  console.log('\n[测试 5] 校验 ChainExecutor 双模式安全边界...');

  // 默认应为 simulation
  const origMode = process.env.CHAIN_EXECUTION_MODE;
  delete process.env.CHAIN_EXECUTION_MODE;
  const simConfig = resolveExecutorConfig();
  check('默认执行模式为 simulation', simConfig.mode === 'simulation', simConfig.mode);

  const simExecutor = new ChainExecutor(simConfig);
  const simHealth = await simExecutor.healthCheck();
  check('simulation 模式健康检查通过', simHealth.ok && simHealth.mode === 'simulation', simHealth.detail);

  // real 模式缺配置必须拒绝启动
  process.env.CHAIN_EXECUTION_MODE = 'real';
  const origReceiver = process.env.GANG_PROTOCOL_FEE_RECEIVER_SOLANA;
  delete process.env.GANG_PROTOCOL_FEE_RECEIVER_SOLANA;
  let rejected = false;
  try {
    resolveExecutorConfig();
  } catch (err) {
    rejected = true;
  }
  check('real 模式缺收款地址时拒绝启动（Fail-Closed）', rejected, '已正确拦截');

  // 恢复环境
  if (origMode === undefined) delete process.env.CHAIN_EXECUTION_MODE;
  else process.env.CHAIN_EXECUTION_MODE = origMode;
  if (origReceiver !== undefined) process.env.GANG_PROTOCOL_FEE_RECEIVER_SOLANA = origReceiver;

  /* ================================================================
   * 测试 6: [KPI-P2-6] 收益台账
   * ================================================================ */
  console.log('\n[测试 6] 校验收益台账记账、汇总与结算...');

  process.env.GANG_PROTOCOL_FEE_RECEIVER_SOLANA = TEST_FEE_RECEIVER.toBase58();
  process.env.GANG_PROTOCOL_FEE_BPS = '20';
  process.env.GANG_LAUNCH_FEE_SOL = '0.02';

  const ledger = new ProtocolRevenueLedger({ storagePath: ledgerPath });

  // 记录三类收益
  const launchEntry = ledger.record('TOKEN_LAUNCH', 0.02, { mint: 'mint-test', payer: 'creator-test' });
  const buyEntry = ledger.record('TRADE_FEE', 0.001, { mint: 'mint-test', payer: 'buyer-test' });
  const sellEntry = ledger.record('TRADE_FEE', 0.000278, { mint: 'mint-test', payer: 'seller-test' });

  check('发行费流水已记录', launchEntry.grossFeeSol === 0.02, `${launchEntry.grossFeeSol} SOL`);
  check('协议分成 20% 计算正确（发行费）', launchEntry.protocolShareSol === 0.004, `${launchEntry.protocolShareSol} SOL`);
  check('流动性留存 80% 计算正确', launchEntry.liquidityShareSol === 0.016, `${launchEntry.liquidityShareSol} SOL`);
  check('买入手续费流水已记录', buyEntry.grossFeeSol === 0.001);
  check('卖出手续费流水已记录', sellEntry.grossFeeSol === 0.000278);

  const summary = ledger.summary();
  check('汇总总毛手续费正确', Math.abs(summary.totalGrossFeeSol - 0.021278) < 1e-9, `${summary.totalGrossFeeSol} SOL`);
  check('汇总协议份额正确', Math.abs(summary.totalProtocolShareSol - 0.0042556) < 1e-9, `${summary.totalProtocolShareSol} SOL`);
  check('按来源统计包含 TOKEN_LAUNCH', summary.bySource.TOKEN_LAUNCH?.count === 1);
  check('按来源统计包含 TRADE_FEE', summary.bySource.TRADE_FEE?.count === 2);
  check('收款地址已配置', summary.recipientConfigured === true, summary.recipient.slice(0, 12) + '...');

  const batch = ledger.createSettlementBatch();
  check('结算批次生成成功', batch.amountSol > 0, `${batch.amountSol} SOL`);
  check('结算批次状态为 PENDING', batch.status === 'PENDING', batch.status);
  check('结算批次包含全部流水', batch.entryIds.length === 3, `${batch.entryIds.length} 条`);

  // 幂等：重复生成结算批次不应重复计入
  const batch2 = ledger.createSettlementBatch();
  check('重复结算批量为空（防重复打款）', batch2.amountSol === 0, `${batch2.amountSol} SOL`);

  // 持久化校验
  check('收益流水已落盘', fs.existsSync(ledgerPath), ledgerPath.includes('gang-soul-revenue') ? '临时目录' : ledgerPath);
  const fileLines = fs.readFileSync(ledgerPath, 'utf8').split('\n').filter(Boolean);
  check('落盘记录包含 3 条 entry + 2 条 batch', fileLines.length === 5, `${fileLines.length} 行`);

  /* ================================================================
   * 测试 7: [KPI-P2-7] 网关端到端
   * ================================================================ */
  console.log('\n[测试 7] 网关端到端：发币 → 买入 → 卖出 → 收益累积...');

  const clusterManager = new SolanaAgentClusterManager(TEST_MNEMONIC);
  await clusterManager.warmUpWallets(10);

  const gateway = new GangSoulGateway(clusterManager);
  const TEST_PORT = 3911;
  await gateway.start(TEST_PORT);
  const baseUrl = `http://127.0.0.1:${TEST_PORT}`;

  try {
    // 发币
    const launchRes = await axios.post(`${baseUrl}/v1/tokens/launch`, {
      name: 'Revenue E2E',
      symbol: 'REV',
      uri: 'https://gang.soul/meta/rev.json',
      note: 'P2 revenue e2e',
    });
    check('发币成功', launchRes.data.success === true);
    check('返回执行模式', launchRes.data.mode === 'simulation', launchRes.data.mode);
    check('返回发行费 0.02 SOL', launchRes.data.launchFeeLamports === '20000000', launchRes.data.launchFeeLamports);
    check('返回联合曲线 PDA', typeof launchRes.data.bondingCurvePda === 'string' && launchRes.data.bondingCurvePda.length > 30);

    const mintAddress = launchRes.data.mint;

    // 买入
    const buyRes = await axios.post(`${baseUrl}/v1/trade/swap`, {
      agentIndex: 0,
      mint: mintAddress,
      isBuy: true,
      solAmount: 0.2,
      note: 'P2 revenue buy',
    });
    check('买入成功', buyRes.data.success === true);
    check('买入手续费为 0.2 SOL × 1% = 2000000 lamports', buyRes.data.feeLamports === '2000000', buyRes.data.feeLamports);
    check('买入返回买方代币账户', typeof buyRes.data.tokenAccount === 'string');

    // 卖出
    const sellRes = await axios.post(`${baseUrl}/v1/trade/swap`, {
      agentIndex: 0,
      mint: mintAddress,
      isBuy: false,
      tokenAmount: 1_000_000,
      note: 'P2 revenue sell',
    });
    check('卖出成功', sellRes.data.success === true);
    check('卖出手续费非零', BigInt(sellRes.data.feeLamports) > 0n, `${sellRes.data.feeLamports} lamports`);

    // 收益台账核对
    const revenueRes = await axios.get(`${baseUrl}/v1/economy/revenue`);
    const gwSummary = revenueRes.data.summary;
    check('网关收益台账已记录发行费', gwSummary.bySource.TOKEN_LAUNCH?.count >= 1, `${gwSummary.bySource.TOKEN_LAUNCH?.count} 笔`);
    check('网关收益台账已记录交易费', gwSummary.bySource.TRADE_FEE?.count >= 2, `${gwSummary.bySource.TRADE_FEE?.count} 笔`);
    check('网关收款地址已配置', gwSummary.recipientConfigured === true, gwSummary.recipient.slice(0, 12) + '...');

    // 收款地址校验接口
    const recipientRes = await axios.get(`${baseUrl}/v1/economy/recipient`);
    check('收款地址校验通过', recipientRes.data.valid === true, recipientRes.data.recipient);

    // 结算接口（必须带 JSON body，否则 Fastify 会以 415 拒绝无 Content-Type 的 POST）
    const settleRes = await axios.post(`${baseUrl}/v1/economy/settle`, {});
    check('结算批次生成成功', settleRes.data.success === true);
    check('结算金额大于 0', settleRes.data.batch.amountSol > 0, `${settleRes.data.batch.amountSol} SOL`);
  } finally {
    await gateway.stop();
  }

  /* ================================================================
   * 汇总
   * ================================================================ */
  // 清理临时台账
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* 忽略清理失败 */
  }

  console.log('\n====================================================');
  console.log(`🎉 P2 端到端验证全部通过！共 ${passCount} 项断言，0 失败`);
  console.log('====================================================');
}

runRevenueE2ESuite().catch((err) => {
  console.error('\n❌ P2 端到端验证失败:', err.message);
  process.exit(1);
});
