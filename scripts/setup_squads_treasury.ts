/**
 * Step 1 · Squads v4 金库开户脚本（骨架 / SKELETON）
 * ============================================================
 * 用途：在 devnet 创建 Squads v4 多签金库，作为「未投入资金」的受托层；
 *       按支出限额（转账 allowance）向 Turnkey 交易钱包定额补充；
 *       大额补充与改配置走提案/投票/时间锁。
 *
 * 设计稿边界（2026-11-18 第 4 页）：
 *  - 支出限额目前只有审计口径支持「转账 allowance」，能否覆盖 swap 未证明（P0-5）；
 *    本脚本按「不能覆盖」设计：金库只做「金库→交易钱包」的转账补充，swap 一律走交易钱包。
 *  - 角色：owner 手机 = Voter，agent = 仅 Proposer，网关 = 仅 Executor，冷备密钥仅投票。
 *  - 阈值与时间锁：建库时按 P0-1 复核结果定稿，本脚本只给默认值与占位符，不预设为已验证。
 *
 * 当前状态：骨架。
 *  - 已实现（可运行）：PDA 推导（复用现有 SquadsV4TreasuryManager）、配置校验、
 *    支出限额/角色/阈值计划输出、执行前置提示。
 *  - TODO 适配器：真正调用 Squads SDK 创建 multisig + 设置 spending limit 的部分隔离在下方函数，
 *    等提供 owner 密钥/阈值并安装 @sqds/multisig 后填入即可跑。
 *
 * 运行：npx tsx scripts/setup_squads_treasury.ts [--execute]
 *   不带 --execute = dry-run（只打印计划，不链上交易、不产生费用）
 *   带   --execute = 真正建库（需先满足执行前置）
 *
 * 执行前置（用户提供/拍板）：
 *   SQUADS_OWNER_KEYPAIR_PATH — owner（手机 Voter）密钥路径；冷备密钥另存
 *   SQUADS_THRESHOLD / SQUADS_TIMELOCK_SECONDS — P0-1 拍板值
 *   SQUADS_MEMBERS — 成员地址 CSV（含角色），默认占位符
 *   （可选）SOLANA_RPC_URL，默认 devnet
 * 依赖（执行前安装）：npm i @sqds/multisig
 */

import { PublicKey } from '@solana/web3.js';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  SquadsV4TreasuryManager,
  SQUADS_V4_PROGRAM_ID,
  type SquadsV4Config,
  type SquadsMember,
} from './init_squads_treasury';

/* ============================================================
 * 1) 配置与校验（已实现，可运行）
 * ========================================================== */
export interface SquadsSetupConfig {
  threshold: number;
  timelockSeconds: number;
  createKey: string;
  members: SquadsMember[];
  ownerKeypairPath: string;
  network: 'devnet' | 'mainnet-beta';
  rpcUrl: string;
  // 支出限额：仅「金库→交易钱包」转账补充（设计稿按不能覆盖 swap 处理）
  spendingLimit: {
    amountSol: number;
    periodSeconds: number;
    destinationWallet: string; // Turnkey 交易钱包地址（由 setup_turnkey_wallet 产出）
  };
}

const PLACEHOLDER_MEMBERS: SquadsMember[] = [
  { address: '{{SQUADS_VOTER_PHONE}}', role: 'FOUNDER', name: 'owner-phone (Voter)' },
  { address: '{{SQUADS_BACKUP_KEY}}', role: 'AUDITOR', name: 'cold-backup (Voter)' },
  { address: '{{SQUADS_EXECUTOR}}', role: 'CORE_AGENT', name: 'gateway (Executor)' },
];

export function loadConfig(): SquadsSetupConfig {
  const network = ((process.env.SQUADS_NETWORK || 'devnet') as SquadsSetupConfig['network']);
  let members = PLACEHOLDER_MEMBERS;
  if (process.env.SQUADS_MEMBERS) {
    members = process.env.SQUADS_MEMBERS.split(';').map((entry, i) => {
      const [address, role, name] = entry.split(':').map((s) => s.trim());
      return {
        address,
        role: (role as SquadsMember['role']) || 'CORE_AGENT',
        name: name || `member-${i}`,
      };
    });
  }
  return {
    threshold: Number(process.env.SQUADS_THRESHOLD || 2),
    timelockSeconds: Number(process.env.SQUADS_TIMELOCK_SECONDS || 86400),
    createKey: process.env.SQUADS_CREATE_KEY || 'Ge5zuikooZHzB3qhHRqaJtq5XPJLq9dxch77NX8QEBPc',
    members,
    ownerKeypairPath: process.env.SQUADS_OWNER_KEYPAIR_PATH || '',
    network,
    rpcUrl: process.env.SOLANA_RPC_URL || (network === 'mainnet-beta'
      ? 'https://api.mainnet-beta.solana.com'
      : 'https://api.devnet.solana.com'),
    spendingLimit: {
      amountSol: Number(process.env.SQUADS_SPEND_LIMIT_SOL || 5),
      periodSeconds: Number(process.env.SQUADS_SPEND_PERIOD_SECONDS || 86400),
      destinationWallet: process.env.SQUADS_DESTINATION_WALLET || '{{TURNKEY_WALLET_ADDRESS}}',
    },
  };
}

export function validateConfig(cfg: SquadsSetupConfig): string[] {
  const errors: string[] = [];
  for (const m of cfg.members) {
    try { new PublicKey(m.address); } catch { errors.push(`非法成员地址(${m.name}): ${m.address}`); }
  }
  try { new PublicKey(cfg.createKey); } catch { errors.push('非法 SQUADS_CREATE_KEY'); }
  try { new PublicKey(cfg.spendingLimit.destinationWallet); } catch {
    errors.push('SQUADS_DESTINATION_WALLET 未填真实 Turnkey 交易钱包地址');
  }
  if (!(cfg.threshold > 0 && cfg.threshold <= cfg.members.length)) {
    errors.push(`threshold 必须在 1..${cfg.members.length} 之间`);
  }
  if (!(cfg.spendingLimit.amountSol > 0)) errors.push('支出限额必须 > 0');
  return errors;
}

/* ============================================================
 * 2) Squads SDK 适配器（TODO：提供账号 + 安装 SDK 后填入）
 * ============================================================
 * 安装：npm i @sqds/multisig
 * 典型流程（以安装版本 API 为准）：
 *   const multisig = await multisigSdk.create({ connection, createKey, ... });
 *   设置 spending limit：向交易钱包的转账 allowance（单一目标地址、固定周期、定额）
 *   大额补充/改配置：走 createProposal → vote → execute + timelock
 * 绝不要把 owner 私钥写进脚本或日志；用 keypair 文件路径在运行时读取。
 */
export async function createSquadsMultisig(_cfg: SquadsSetupConfig): Promise<{ multisigPda: string; vaultPda: string }> {
  throw new Error(
    '[TODO adapter] createSquadsMultisig：安装 @sqds/multisig 后用 owner keypair 创建 multisig' +
    '（threshold/timelock/members 来自配置），返回 { multisigPda, vaultPda }。',
  );
}

export async function setSpendingLimit(
  _cfg: SquadsSetupConfig,
  _vaultPda: string,
): Promise<{ allowanceId: string }> {
  throw new Error(
    '[TODO adapter] setSpendingLimit：用 Squads spending-limit 指令设置「金库→交易钱包」转账 allowance' +
    '（定额、周期、单一目标地址）。按设计稿不覆盖 swap；返回 allowanceId。',
  );
}

/* ============================================================
 * 3) 计划输出与清单落盘（已实现，可运行）
 * ========================================================== */
export function buildPlan(cfg: SquadsSetupConfig) {
  const cfgForManager: SquadsV4Config = {
    threshold: cfg.threshold,
    timelockSeconds: cfg.timelockSeconds,
    createKey: cfg.createKey,
    members: cfg.members,
  };
  const manager = new SquadsV4TreasuryManager(cfgForManager);
  const { multisigPda } = manager.deriveMultisigPda();
  const { vaultPda } = manager.deriveVaultPda(1);
  return {
    protocol: 'Squads v4 multisig treasury',
    programId: SQUADS_V4_PROGRAM_ID.toBase58(),
    network: cfg.network,
    multisigPda,
    vaultPda,
    threshold: `${cfg.threshold}-of-${cfg.members.length}`,
    timelockSeconds: cfg.timelockSeconds,
    members: cfg.members,
    spendingLimit: cfg.spendingLimit,
    boundary: '支出限额只管金库→交易钱包转账补充，不覆盖 swap（P0-5 未证，按不能覆盖设计）',
    prerequisite: '需提供 owner keypair + P0-1 拍板阈值/时间锁 + 安装 @sqds/multisig',
  };
}

function writeReceipt(payload: any): string {
  const path = resolve(process.cwd(), 'data', `squads-treasury-${Date.now()}.json`);
  writeFileSync(path, JSON.stringify(payload, null, 2), 'utf-8');
  return path;
}

async function main() {
  const execute = process.argv.includes('--execute');
  const cfg = loadConfig();
  console.log('========================================================');
  console.log(`Squads v4 金库开户（${execute ? 'EXECUTE' : 'DRY RUN'}）`);
  console.log('========================================================');

  const errors = validateConfig(cfg);
  const plan = buildPlan(cfg);
  console.log('计划：', JSON.stringify(plan, null, 2));
  if (!execute) {
    if (errors.length) console.log('\n⚠ 执行前置未满足：\n - ' + errors.join('\n - '));
    console.log('\n（dry-run 未发链上交易；加 --execute 且补齐前置后真正建库）');
    return;
  }
  if (errors.length) {
    console.error('执行前置未满足，拒绝建库：\n - ' + errors.join('\n - '));
    process.exit(1);
  }
  if (!cfg.ownerKeypairPath || !existsSync(cfg.ownerKeypairPath)) {
    console.error('缺少 owner keypair 文件（SQUADS_OWNER_KEYPAIR_PATH），拒绝建库。');
    process.exit(1);
  }

  const multisig = await createSquadsMultisig(cfg);
  const allowance = await setSpendingLimit(cfg, multisig.vaultPda);
  const receipt = writeReceipt({ createdAt: Date.now(), multisig, allowance, plan });
  console.log('✅ 金库已创建：', JSON.stringify(multisig, null, 2));
  console.log('✅ 支出限额已设置：', allowance.allowanceId);
  console.log('📄 开户回执：', receipt);
  console.log('下一步：把 vaultPda 记录为协议受托人；大额补充/改配置走提案+时间锁。');
}

import { pathToFileURL } from 'node:url';
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e?.message || e); process.exit(1); });
}
