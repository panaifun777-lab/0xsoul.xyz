/**
 * Step 1 · Turnkey 交易钱包开户脚本（骨架 / SKELETON）
 * ============================================================
 * 用途：在 Turnkey HSM/Enclave 内创建「每只 agent 一只」的 devnet 交易钱包，
 *       生成策略 allowlist 配置，并把地址/公钥写入一份本地清单供网关接入。
 *
 * 重要边界（对应《Agent 钱包服务设计稿》2026-11-18 第 4 页）：
 *  - 钱包由「用户在 0xsoul 里创建并注资」，agent 永不自建、永不持有私钥；
 *  - key 在 HSM/Enclave 内生成、不导出；本脚本绝不会打印或保存私钥；
 *  - 网关只能通过 SIGN_TRANSACTION 请求签名；此脚本只做「开户 + 策略配置」。
 *
 * 当前状态：骨架。可运行部分（配置校验、地址推导、计划输出、清单落盘）用已装的
 *           @solana/web3.js 实现；真正的 Turnkey API 调用隔离在 TODO 适配器里，
 *           等提供 Turnkey 组织/API key 并安装 SDK 后按 TODO 填入即可直接跑。
 *
 * 运行：npx tsx scripts/setup_turnkey_wallet.ts [--execute]
 *   不带 --execute = dry-run（只打印计划，不调用任何外部 API、不产生费用）
 *   带   --execute = 真正开户（需先满足下方「执行前置」）
 *
 * 执行前置（用户提供）：
 *   TURNKEY_API_PUBLIC_KEY, TURNKEY_API_PRIVATE_KEY  — API key pair（不是钱包私钥）
 *   TURNKEY_ORGANIZATION_ID                          — 组织 ID
 *   SOLANA_NETWORK=devnet                            — 默认 devnet
 *   （可选）TURNKEY_WALLET_NAME                       — 钱包标签，默认 agent-0
 * 依赖（执行前安装）：npm i @turnkey/http @turnkey/api-key-stamper
 */

import { PublicKey, LAMPORTS_PER_SOL, clusterApiUrl } from '@solana/web3.js';
import { writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

/* ============================================================
 * 1) 配置与校验（已实现，可运行）
 * ========================================================== */
export interface TurnkeySetupConfig {
  organizationId: string;
  walletName: string;
  network: 'devnet' | 'mainnet-beta';
  rpcUrl: string;
  // 程序 allowlist（设计稿第 4 页：Jupiter swap / System / ComputeBudget / SPL / Token-2022 / ATA）
  allowedProgramIds: string[];
  // mint allowlist（试点：先空，待 P0-2 拍板后填真实 mint）
  allowedMints: string[];
  maxSolPerTx: number;
  dailySpendLimitSol: number;
  maxSlippageBps: number;
}

const DEFAULT_ALLOWED_PROGRAMS = [
  '11111111111111111111111111111111', // System Program
  'ComputeBudget111111111111111111111111111111',
  'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4', // Jupiter v6
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', // SPL Token
  'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb', // Token-2022
  'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL', // Associated Token Account
];

export function loadConfig(): TurnkeySetupConfig {
  const network = ((process.env.SOLANA_NETWORK || 'devnet') as TurnkeySetupConfig['network']);
  return {
    organizationId: process.env.TURNKEY_ORGANIZATION_ID || '',
    walletName: process.env.TURNKEY_WALLET_NAME || 'agent-0',
    network,
    rpcUrl: process.env.SOLANA_RPC_URL || (network === 'mainnet-beta'
      ? 'https://api.mainnet-beta.solana.com'
      : clusterApiUrl('devnet')),
    allowedProgramIds: splitEnv('TURNKEY_ALLOWED_PROGRAMS', DEFAULT_ALLOWED_PROGRAMS),
    allowedMints: splitEnv('TURNKEY_ALLOWED_MINTS', []),
    maxSolPerTx: Number(process.env.MAX_SOL_PER_TX || 1.5),
    dailySpendLimitSol: Number(process.env.DAILY_SPEND_LIMIT_SOL || 15),
    maxSlippageBps: Number(process.env.MAX_SLIPPAGE_BPS || 500),
  };
}

function splitEnv(key: string, fallback: string[]): string[] {
  const raw = process.env[key];
  if (!raw) return [...fallback];
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

export function validateConfig(cfg: TurnkeySetupConfig): string[] {
  const errors: string[] = [];
  if (!cfg.organizationId) errors.push('缺少 TURNKEY_ORGANIZATION_ID');
  if (!process.env.TURNKEY_API_PUBLIC_KEY) errors.push('缺少 TURNKEY_API_PUBLIC_KEY');
  if (!process.env.TURNKEY_API_PRIVATE_KEY) errors.push('缺少 TURNKEY_API_PRIVATE_KEY');
  for (const p of cfg.allowedProgramIds) {
    try { new PublicKey(p); } catch { errors.push(`非法 Program ID: ${p}`); }
  }
  for (const m of cfg.allowedMints) {
    try { new PublicKey(m); } catch { errors.push(`非法 Mint 地址: ${m}`); }
  }
  if (!(cfg.maxSolPerTx > 0 && cfg.maxSolPerTx <= 1.5)) errors.push('maxSolPerTx 必须在 (0, 1.5] 之间（设计稿沙盒硬顶）');
  if (!(cfg.dailySpendLimitSol > cfg.maxSolPerTx)) errors.push('dailySpendLimitSol 必须大于 maxSolPerTx');
  return errors;
}

/* ============================================================
 * 2) Turnkey SDK 适配器（TODO：提供账号 + 安装 SDK 后填入）
 * ============================================================
 * 以下两个函数的签名与返回结构已定义好，网关/调用方按此契约对接即可。
 * 实现时请使用官方 SDK：
 *   npm i @turnkey/http @turnkey/api-key-stamper
 *   - 客户端：new Turnkey({ baseUrl, apiPrivateKey, apiPublicKey }) + ApiKeyStamper
 *   - 建钱包：activities.createWallet / createWalletActivity（以安装版本的 API 为准）
 *   - 签名策略：通过 policy / user 授权配置，切勿导出私钥
 */

export interface CreatedWallet {
  walletId: string;
  address: string;        // Solana 地址（base58）
  publicKey: string;      // 用于验签/识别的公钥
  organizationId: string;
  network: string;
}

/** TODO(adapter): 调用 Turnkey 创建一个 HSM 内钱包。绝不要返回私钥。 */
export async function createTurnkeyWallet(_cfg: TurnkeySetupConfig): Promise<CreatedWallet> {
  throw new Error(
    '[TODO adapter] createTurnkeyWallet：安装 @turnkey/http + @turnkey/api-key-stamper 后，' +
    '用 API key stamper 初始化 Turnkey 客户端并调用 createWallet activity；' +
    '返回 { walletId, address, publicKey, organizationId, network }。禁止导出私钥。',
  );
}

/** TODO(adapter): 为该钱包写入/绑定签名策略（程序/mint allowlist、金额与滑点上限）。 */
export async function applyTurnkeyPolicy(
  _cfg: TurnkeySetupConfig,
  _wallet: CreatedWallet,
): Promise<{ policyId: string }> {
  throw new Error(
    '[TODO adapter] applyTurnkeyPolicy：用 Turnkey policy API 绑定 allowlist 与限额；' +
    '返回策略 ID。网关签名时应只走 SIGN_TRANSACTION 且命中此策略。',
  );
}

/* ============================================================
 * 3) 计划输出与清单落盘（已实现，可运行）
 * ========================================================== */
export function buildPlan(cfg: TurnkeySetupConfig) {
  return {
    protocol: 'Turnkey HSM agent wallet (per-agent)',
    network: cfg.network,
    walletName: cfg.walletName,
    organizationId: cfg.organizationId ? `${cfg.organizationId.slice(0, 8)}…（已配置）` : '（未提供）',
    policy: {
      allowedProgramIds: cfg.allowedProgramIds,
      allowedMints: cfg.allowedMints.length ? cfg.allowedMints : ['（空，待 P0-2 拍板）'],
      maxSolPerTx: cfg.maxSolPerTx,
      dailySpendLimitSol: cfg.dailySpendLimitSol,
      maxSlippageBps: cfg.maxSlippageBps,
    },
    safety: [
      '私钥在 HSM/Enclave 内生成，不导出、不落库、不进日志',
      '网关仅可 SIGN_TRANSACTION；无批准令牌不得签名',
      '注资额即该 agent 钱包最大可亏额（页面须明示）',
    ],
    prerequisite: '需提供 TURNKEY_* 账号并安装 @turnkey/http + @turnkey/api-key-stamper',
  };
}

function writeReceipt(payload: any): string {
  const path = resolve(process.cwd(), 'data', `turnkey-wallet-${Date.now()}.json`);
  writeFileSync(path, JSON.stringify(payload, null, 2), 'utf-8');
  return path;
}

async function main() {
  const execute = process.argv.includes('--execute');
  const cfg = loadConfig();
  console.log('========================================================');
  console.log(`Turnkey 交易钱包开户（${execute ? 'EXECUTE' : 'DRY RUN'}）`);
  console.log('========================================================');

  const errors = validateConfig(cfg);
  if (!execute) {
    console.log('计划：', JSON.stringify(buildPlan(cfg), null, 2));
    if (errors.length) console.log('\n⚠ 执行前置未满足：\n - ' + errors.join('\n - '));
    console.log('\n（dry-run 未调用任何外部 API；加 --execute 且补齐前置后真正开户）');
    return;
  }
  if (errors.length) {
    console.error('执行前置未满足，拒绝开户：\n - ' + errors.join('\n - '));
    process.exit(1);
  }

  const wallet = await createTurnkeyWallet(cfg);
  const policy = await applyTurnkeyPolicy(cfg, wallet);
  const receipt = writeReceipt({ createdAt: Date.now(), wallet, policy, config: buildPlan(cfg) });
  console.log('✅ 钱包已创建：', JSON.stringify(wallet, null, 2));
  console.log('✅ 策略已绑定：', policy.policyId);
  console.log('📄 开户回执：', receipt);
  console.log('下一步：把 wallet.address 提供给网关/页面注资，并按设计稿第 4 页完成注资与连接测试。');
}

import { pathToFileURL } from 'node:url';
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e?.message || e); process.exit(1); });
}
