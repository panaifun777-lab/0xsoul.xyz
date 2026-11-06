/**
 * Solana Devnet 部署流水线与 Squads v4 多签 Treasury 治理端到端自动化测试套件
 */
import * as fs from 'fs';
import * as path from 'path';
import { SolanaDeployPipeline, DEFAULT_DEPLOY_PLAN } from '../scripts/deploy_devnet';
import { SquadsV4TreasuryManager, SQUADS_V4_PROGRAM_ID } from '../scripts/init_squads_treasury';

async function runSolanaDeploymentAndSquadsSuite() {
  console.log('====================================================');
  console.log('🏛️ 启动 Solana Devnet 部署流水线与 Squads v4 治理测试');
  console.log('====================================================');

  // ----------------------------------------------------
  // 测试 1: 验证 Anchor.toml 生产配置与集群 Program ID
  // ----------------------------------------------------
  console.log('\n[测试 1] 校验 Anchor.toml 配置文件与程序声明...');
  if (!fs.existsSync('Anchor.toml')) {
    throw new Error('❌ Anchor.toml 缺失');
  }
  const anchorContent = fs.readFileSync('Anchor.toml', 'utf-8');
  if (!anchorContent.includes('gang_launchpad = "GangLaunchpad111111111111111111111111111111"')) {
    throw new Error('❌ Anchor.toml 中 gang_launchpad ID 声明不正确');
  }
  if (!anchorContent.includes('cluster = "devnet"')) {
    throw new Error('❌ Anchor.toml 默认 provider cluster 未设置为 devnet');
  }
  console.log('✅ [测试 1 通过] Anchor.toml 生产配置文件语法与声明校验通过');

  // ----------------------------------------------------
  // 测试 2: SolanaDeployPipeline Preflight 检查与 PDA 推导
  // ----------------------------------------------------
  console.log('\n[测试 2] 运行 SolanaDeployPipeline 预检与系统 PDA 计算...');
  const pipeline = new SolanaDeployPipeline();
  const mockDeployer = 'DeployerSolanaWalletKeypair11111111111111111111';
  const preflightRes = await pipeline.runPreflightCheck(mockDeployer);

  console.log(`   - BPF 镜像有效性: ${preflightRes.artifactValid}`);
  console.log(`   - 部署者账户余额: ${preflightRes.balanceSol} SOL`);
  console.log(`   - GlobalConfig PDA: ${preflightRes.pdas.globalConfigPda} (Bump: ${preflightRes.pdas.configBump})`);
  console.log(`   - TreasuryVault PDA: ${preflightRes.pdas.treasuryVaultPda} (Bump: ${preflightRes.pdas.vaultBump})`);

  if (!preflightRes.ready) {
    throw new Error('❌ Preflight 检查未通过');
  }
  if (!preflightRes.pdas.globalConfigPda || !preflightRes.pdas.treasuryVaultPda) {
    throw new Error('❌ 核心 PDA 推导失败');
  }
  console.log('✅ [测试 2 通过] 部署预检与核心 PDA 自动化推导完整无误');

  // ----------------------------------------------------
  // 测试 3: Squads v4 多签 Treasury 初始化与升级权限交接规划
  // ----------------------------------------------------
  console.log('\n[测试 3] 验证 Squads v4 3-of-5 门限多签金库与权限转移...');
  const squadsManager = new SquadsV4TreasuryManager();
  const { multisigPda, bump: mBump } = squadsManager.deriveMultisigPda();
  const { vaultPda, bump: vBump } = squadsManager.deriveVaultPda(1);

  console.log(`   - Squads v4 Program ID: ${SQUADS_V4_PROGRAM_ID.toBase58()}`);
  console.log(`   - Multisig PDA: ${multisigPda} (Bump: ${mBump})`);
  console.log(`   - 核心 Treasury Vault PDA: ${vaultPda} (Bump: ${vBump})`);

  const plan = squadsManager.generateUpgradeAuthorityTransferPlan(DEFAULT_DEPLOY_PLAN.programId);
  console.log(`   - 治理门限策略: ${plan.threshold}`);
  console.log(`   - 升级时间锁: ${plan.timelock}`);
  console.log(`   - 理事席位数: ${plan.members.length}`);
  console.log(`   - CLI 移交指令: ${plan.cliCommand}`);

  if (plan.members.length !== 5) {
    throw new Error(`❌ 预期 5 名理事席位，实际得到: ${plan.members.length}`);
  }
  if (!plan.cliCommand.includes(vaultPda)) {
    throw new Error('❌ 移交指令的目标新权限不是 Squads Vault PDA');
  }
  console.log('✅ [测试 3 通过] Squads v4 多签 Treasury 治理架构与权限交接方案验证通过');

  // ----------------------------------------------------
  // 测试 4: 校验 12_PRODUCTION_DEPLOYMENT_AND_SQUADS_V4_GOVERNANCE.md 文档
  // ----------------------------------------------------
  console.log('\n[测试 4] 校验生产部署与 Squads v4 治理说明文档完整性...');
  const docPath = 'docs/12_PRODUCTION_DEPLOYMENT_AND_SQUADS_V4_GOVERNANCE.md';
  if (!fs.existsSync(docPath)) {
    throw new Error(`❌ 缺少治理文档: ${docPath}`);
  }
  const docContent = fs.readFileSync(docPath, 'utf-8');
  const requiredKeywords = [
    'Squads v4 Multisig Governance',
    '3-of-5',
    '85 SOL',
    'Raydium',
    'target/deploy/gang_launchpad.so',
    'set-upgrade-authority',
  ];
  for (const kw of requiredKeywords) {
    if (!docContent.includes(kw)) {
      throw new Error(`❌ 治理文档缺少关键主题: ${kw}`);
    }
  }
  console.log('✅ [测试 4 通过] 生产部署与 Squads v4 治理指南技术细节详实完备');

  console.log('\n====================================================');
  console.log('🎉 Solana Devnet 部署流水线与 Squads v4 治理测试全部圆满通过！');
  console.log('====================================================');
}

runSolanaDeploymentAndSquadsSuite().catch((err) => {
  console.error('❌ 测试执行失败:', err);
  process.exit(1);
});
