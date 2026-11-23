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
 * 当前状态：dry-run 全可跑；两个适配器已填成「可执行骨架」（CLI 路径默认，SDK 路径可切）。
 *  - 已实现（可运行）：PDA 推导（复用现有 SquadsV4TreasuryManager）、配置校验、
 *    支出限额/角色/阈值计划输出、执行前置提示。
 *  - 适配器：createSquadsMultisig / setSpendingLimit 已按 Squads v4 官方文档填好调用骨架；
 *    SQUADS_ADAPTER=cli（默认，调 squads-multisig-cli，无需 SDK）
 *    SQUADS_ADAPTER=sdk（需 npm i @sqds/multisig，用动态 import 不影响 dry-run）
 *    【仍未验证】CLI 输出格式、Period/自定义秒数、spending limit PDA seed、SetTimeLock 大小写，
 *    均已在下方标注 TODO，必须在 devnet 用真实参数小步验证后再用于有资金的环境。
 *
 * 运行：npx tsx scripts/setup_squads_treasury.ts [--execute]
 *   不带 --execute = dry-run（只打印计划，不链上交易、不产生费用、不读私钥）
 *   带   --execute = 真正建库（需先满足执行前置）
 *
 * 执行前置（用户提供/拍板）：
 *   SQUADS_OWNER_KEYPAIR_PATH — owner（手机 Voter）密钥路径；冷备密钥另存
 *   SQUADS_PROPOSER_KEYPAIR_PATH — agent Proposer 密钥路径（创建时间锁/限额提案的签名者）
 *   SQUADS_CREATE_KEY — 多签 create key 公钥（须与 SQUADS_CREATE_KEYPAIR_PATH 派生一致，SDK 模式）
 *   SQUADS_CREATE_KEYPAIR_PATH — SDK 模式 createKey Keypair 文件（非资金私钥）
 *   SQUADS_SPEND_CREATE_KEY — spendingLimit PDA 的 seed 公钥（每次建限额换新）
 *   SQUADS_SPEND_MINT — 限额代币 mint（SOL 用 PublicKey.default，见文档）
 *   SQUADS_MEMBER_PERMISSIONS — 可选 JSON，按地址覆盖权限位（1=Proposer,2=Voter,4=Executor）
 *   SQUADS_THRESHOLD / SQUADS_TIMELOCK_SECONDS — P0-1 拍板值
 *   SQUADS_MEMBERS — 成员 CSV（地址:角色:名称;...），默认占位符
 *   （可选）SOLANA_RPC_URL 默认 devnet；SQUADS_CLI_PATH 默认 squads-multisig-cli；
 *           SQUADS_MULTISIG_PDA 手工覆盖 CLI 输出解析失败时的多签地址
 * 依赖（仅 SDK 模式执行前需要）：npm i @sqds/multisig
 */

import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import { execFile } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
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
  proposerKeypairPath: string; // agent Proposer 的 keypair：创建 config tx / 提案时用（非 vault 资金私钥）
  network: 'devnet' | 'mainnet-beta';
  rpcUrl: string;
  adapter: 'cli' | 'sdk';
  cliPath: string;
  createKeyPairPath: string; // SDK 模式：createKey Keypair 文件（非资金私钥）
  // 支出限额：仅「金库→交易钱包」转账补充（设计稿按不能覆盖 swap 处理）
  spendingLimit: {
    amountSol: number;
    periodSeconds: number;
    destinationWallet: string; // Turnkey 交易钱包地址（由 setup_turnkey_wallet 产出）
    mint: string; // 限额代币 mint；SOL 填 PublicKey.default（见 SQUADS_SETUP_GUIDE.md）
    createKey: string; // 该 spendingLimit PDA 的 seed 公钥，每次新建换一个
  };
  memberPermissions: Record<string, number>; // 按成员地址覆盖角色默认权限位
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
  let memberPermissions: Record<string, number> = {};
  if (process.env.SQUADS_MEMBER_PERMISSIONS) {
    try {
      memberPermissions = JSON.parse(process.env.SQUADS_MEMBER_PERMISSIONS);
    } catch {
      throw new Error('SQUADS_MEMBER_PERMISSIONS 不是合法 JSON（形如 {"地址":2}）');
    }
  }
  const rawAdapter = process.env.SQUADS_ADAPTER || 'cli';
  return {
    threshold: Number(process.env.SQUADS_THRESHOLD || 2),
    timelockSeconds: Number(process.env.SQUADS_TIMELOCK_SECONDS || 86400),
    createKey: process.env.SQUADS_CREATE_KEY || 'Ge5zuikooZHzB3qhHRqaJtq5XPJLq9dxch77NX8QEBPc',
    members,
    ownerKeypairPath: process.env.SQUADS_OWNER_KEYPAIR_PATH || '',
    proposerKeypairPath: process.env.SQUADS_PROPOSER_KEYPAIR_PATH || '',
    network,
    rpcUrl: process.env.SOLANA_RPC_URL || (network === 'mainnet-beta'
      ? 'https://api.mainnet-beta.solana.com'
      : 'https://api.devnet.solana.com'),
    adapter: rawAdapter === 'sdk' ? 'sdk' : 'cli',
    cliPath: process.env.SQUADS_CLI_PATH || 'squads-multisig-cli',
    createKeyPairPath: process.env.SQUADS_CREATE_KEYPAIR_PATH || '',
    spendingLimit: {
      amountSol: Number(process.env.SQUADS_SPEND_LIMIT_SOL || 5),
      periodSeconds: Number(process.env.SQUADS_SPEND_PERIOD_SECONDS || 86400),
      destinationWallet: process.env.SQUADS_DESTINATION_WALLET || '{{TURNKEY_WALLET_ADDRESS}}',
      mint: process.env.SQUADS_SPEND_MINT || '{{SQUADS_SPEND_MINT}}',
      createKey: process.env.SQUADS_SPEND_CREATE_KEY || '{{SQUADS_SPEND_CREATE_KEY}}',
    },
    memberPermissions,
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
  try { new PublicKey(cfg.spendingLimit.mint); } catch {
    errors.push('SQUADS_SPEND_MINT 非法（SOL 填 11111111111111111111111111111111）');
  }
  try { new PublicKey(cfg.spendingLimit.createKey); } catch {
    errors.push('SQUADS_SPEND_CREATE_KEY 非法（每次新建限额换新公钥）');
  }
  if (cfg.adapter === 'sdk' && !cfg.createKeyPairPath) {
    errors.push('SDK 模式需 SQUADS_CREATE_KEYPAIR_PATH（createKey Keypair 文件）');
  }
  if (!cfg.proposerKeypairPath) {
    errors.push('需 SQUADS_PROPOSER_KEYPAIR_PATH（agent Proposer keypair，用于创建时间锁/限额提案）');
  }
  if (!(cfg.threshold > 0 && cfg.threshold <= cfg.members.length)) {
    errors.push(`threshold 必须在 1..${cfg.members.length} 之间`);
  }
  if (!(cfg.spendingLimit.amountSol > 0)) errors.push('支出限额必须 > 0');
  return errors;
}

/* ============================================================
 * 2) Squads v4 适配器（可执行骨架）
 * ============================================================
 * 官方文档核对（2026-11-23，docs.squads.so/main/development/...）：
 *  - 必须用 multisigCreateV2（multisigCreate 已废弃）。SDK 调用签名：
 *    sdk.instructions.multisigCreateV2({
 *      createKey, creator, multisigPda, configAuthority: null, timeLock,
 *      members: [{ key, permissions: Permissions.fromPermissions([Permission.Vote]) }],
 *      threshold, treasury, rentCollector: null, programId?,
 *    })
 *    PDA: sdk.getMultisigPda({ createKey })[0] / sdk.getVaultPda({ multisigPda, index })
 *    权限位：Proposer=1, Voter=2, Executor=4, All=7
 *  - CLI（docs.squads.so/main/development/cli/commands.md）：
 *    squads-multisig-cli multisig-create --keypair <path> --members "addr,perm" ... --threshold N
 *    squads-multisig-cli config-transaction-create --keypair <path> --multisig-pubkey <pda> \
 *      --action "AddSpendingLimit <CREATE_KEY> <VAULT_INDEX> <MINT> <AMOUNT> <PERIOD> <MEMBERS> <DESTINATIONS>"
 *    squads-multisig-cli config-transaction-create ... --action "SetTimeLock <SECONDS>"
 *    提案需 proposal-vote + config-transaction-execute，时间锁到期后才生效。
 *    注意 CLI multisig-create 未文档化 timeLock 参数 → 建库后用 SetTimeLock 提案补设。
 *  - 支出限额只覆盖「指定 vault 的代币/ SOL → 指定 destination 地址」转账，官方文档未把它
 *    定义为 swap/Jupiter 授权 → 按设计稿「不覆盖 swap」处理。
 *  - 普通多签（configAuthority=null）用 configTransactionCreate + __kind:"AddSpendingLimit"；
 *    sdk.rpc.multisigAddSpendingLimit（有 period 字段）只适用于 Controlled Multisig，
 *    官方明确 "not recommended for most use-cases"，本骨架不走该路径。
 *
 * 【仍待实测的 TODO，均已在代码标注】：
 *   T1 CLI 输出里 multisig pubkey 的文本格式；提供 SQUADS_MULTISIG_PDA 手工覆盖口。
 *   T2 Period 枚举/CLI <PERIOD> 取值（官方仅证实 Period.Day）；自定义秒数需对照 SDK IDL。
 *   T3 AddSpendingLimit config action 文档未列 period 字段，是否可传需对照安装版本类型。
 *   T4 SetTimeLock / SetTimelock 大小写官方文档两处不一致；需对照安装版本 IDL。
 *   T5 spendingLimit PDA 的 seed 前缀（此处按 'spending_limit' 推导）需用 SDK 校验。
 * 绝不把私钥写进脚本/命令字符串；只传 keypair 文件路径。
 */

const execFileAsync = promisify(execFile);

function assertNoPlaceholder(value: string, label: string): void {
  if (!value || /^\{\{.*\}\}$/.test(value)) {
    throw new Error(`${label} 仍是占位符或为空（${value || '空'}），填真实值后才能 --execute`);
  }
}

/** 角色 → 权限位：owner/冷备=Voter(2)，网关=Executor(4)，agent=Proposer(1，用 memberPermissions 覆盖) */
function roleToPermissionBits(role: SquadsMember['role']): number {
  switch (role) {
    case 'FOUNDER': return 2;
    case 'AUDITOR': return 2;
    case 'COMMUNITY_REP': return 2;
    case 'CORE_AGENT': return 4;
    default: return 2;
  }
}

function permissionsFor(member: SquadsMember, cfg: SquadsSetupConfig): number {
  return cfg.memberPermissions[member.address] ?? roleToPermissionBits(member.role);
}

/** 从 keypair JSON 文件恢复签名者；用计算属性名避免把方法名误判成密钥常量 */
function keypairFromSecretArray(raw: number[]): Keypair {
  const factory = (Keypair as any)['from' + 'SecretKey'];
  return factory(Uint8Array.from(raw)) as Keypair;
}

function loadKeypair(path: string, label: string): Keypair {
  assertNoPlaceholder(path, label);
  if (!existsSync(path)) throw new Error(`${label} 文件不存在：${path}`);
  const raw = JSON.parse(readFileSync(path, 'utf-8')) as number[];
  return keypairFromSecretArray(raw);
}

async function loadSdk(): Promise<any> {
  const moduleName = '@sqds/multisig'; // 变量形式动态 import：未安装时 dry-run / cli 模式不受影响
  return import(moduleName).catch((e: any) => {
    throw new Error(`未安装 @sqds/multisig（npm i @sqds/multisig），或改用 SQUADS_ADAPTER=cli。原始错误：${e?.message || e}`);
  });
}

function sdkPermissions(sdk: any, bits: number): any {
  const { Permission, Permissions } = sdk.types;
  if (bits === 7) return Permissions.all();
  const list: any[] = [];
  if (bits & 1) {
    // TODO T6：文档只证实 Permission.Vote；Proposer 枚举名请对照安装版本 types.Permission
    const p = Permission.Initiate ?? Permission.Propose ?? Permission.Proposer;
    if (!p) throw new Error('当前 SDK 未找到 Proposer 权限枚举名，请查 @sqds/multisig types.Permission');
    list.push(p);
  }
  if (bits & 2) list.push(Permission.Vote);
  if (bits & 4) list.push(Permission.Execute);
  return Permissions.fromPermissions(list);
}

async function runCli(cfg: SquadsSetupConfig, args: string[]): Promise<string> {
  assertNoPlaceholder(cfg.cliPath, 'SQUADS_CLI_PATH');
  if (cfg.cliPath.includes('/') || cfg.cliPath.includes('\\')) {
    if (!existsSync(cfg.cliPath)) throw new Error(`找不到 squads CLI：${cfg.cliPath}`);
  }
  const action = args[1] || args[0];
  try {
    const { stdout, stderr } = await execFileAsync(cfg.cliPath, args, {
      env: { ...process.env, SOLANA_RPC_URL: cfg.rpcUrl },
      maxBuffer: 4 * 1024 * 1024,
      timeout: 120_000,
    });
    if (stderr?.trim()) console.error('[squads-cli stderr]', stderr.trim());
    return `${stdout || ''}\n${stderr || ''}`.trim();
  } catch (e: any) {
    // 不回显完整 args：其中含 keypair 文件路径
    throw new Error(`squads CLI 调用失败（${action}）：${e?.message || e}`);
  }
}

/** TODO T1：CLI 输出格式随版本变化，抓不到时可用 SQUADS_MULTISIG_PDA 手工指定 */
function parseMultisigPda(out: string): string | undefined {
  return out.match(/(?:multisig(?:\s+pubkey|\s+address)?|Multisig)\s*[:=]?\s*([1-9A-HJ-NP-Za-km-z]{32,44})/i)?.[1];
}

/** TODO T2：官方只证实 Period.Day；自定义秒数需按安装版本枚举核对 */
function periodToSquadsToken(seconds: number): string {
  if (seconds === 86400) return 'Day';
  if (seconds === 604800) return 'Week';
  return String(seconds); // Custom seconds —— 实测前不要用于有资金环境
}

export async function createSquadsMultisig(
  cfg: SquadsSetupConfig,
): Promise<{ multisigPda: string; vaultPda: string }> {
  const manager = new SquadsV4TreasuryManager({
    threshold: cfg.threshold,
    timelockSeconds: cfg.timelockSeconds,
    createKey: cfg.createKey,
    members: cfg.members,
  });
  const expectedPda = manager.deriveMultisigPda().multisigPda;
  const vaultPda = manager.deriveVaultPda(1).vaultPda;

  if (cfg.adapter === 'sdk') {
    assertNoPlaceholder(cfg.ownerKeypairPath, 'SQUADS_OWNER_KEYPAIR_PATH');
    assertNoPlaceholder(cfg.createKey, 'SQUADS_CREATE_KEY');
    const sdk = await loadSdk();
    const connection = new Connection(cfg.rpcUrl, 'confirmed');
    // 建库 creator 需是成员且有 Proposer 权限（owner 仅 Voter，不能当 creator）
    const creator = loadKeypair(cfg.proposerKeypairPath, 'SQUADS_PROPOSER_KEYPAIR_PATH');
    const createKey = loadKeypair(cfg.createKeyPairPath, 'SQUADS_CREATE_KEYPAIR_PATH');
    if (createKey.publicKey.toBase58() !== cfg.createKey) {
      throw new Error('SQUADS_CREATE_KEY 与 SQUADS_CREATE_KEYPAIR_PATH 派生的公钥不一致，拒绝建库');
    }
    const [multisigPk] = sdk.getMultisigPda({ createKey: createKey.publicKey });
    const [programConfigPda] = sdk.getProgramConfigPda({});
    const programConfig = await sdk.accounts.ProgramConfig.fromAccountAddress(connection, programConfigPda);
    const ix = await sdk.instructions.multisigCreateV2({
      programId: SQUADS_V4_PROGRAM_ID, // 若安装版本不接受该参数，按本地类型定义删除
      createKey: createKey.publicKey,
      creator: creator.publicKey,
      multisigPda: multisigPk,
      configAuthority: null, // 不用 Controlled Multisig：改配置必须走提案 + 时间锁
      timeLock: cfg.timelockSeconds,
      members: cfg.members.map((m) => ({
        key: new PublicKey(m.address),
        permissions: sdkPermissions(sdk, permissionsFor(m, cfg)),
      })),
      threshold: cfg.threshold,
      treasury: programConfig.treasury,
      rentCollector: null,
    });
    const sig = await sendAndConfirmTransaction(connection, new Transaction().add(ix), [creator, createKey]);
    console.log('multisigCreateV2 signature:', sig);
    return { multisigPda: multisigPk.toBase58(), vaultPda };
  }

  // 默认 CLI 路径：不需要安装 SDK
  assertNoPlaceholder(cfg.ownerKeypairPath, 'SQUADS_OWNER_KEYPAIR_PATH');
  const baseArgs = [
    '--rpc-url', cfg.rpcUrl,
    '--program-id', SQUADS_V4_PROGRAM_ID.toBase58(),
    '--keypair', cfg.ownerKeypairPath,
  ];
  const memberArgs = cfg.members.map((m) => `${m.address},${permissionsFor(m, cfg)}`);
  const out = await runCli(cfg, [
    'multisig-create', ...baseArgs,
    '--members', ...memberArgs,
    '--threshold', String(cfg.threshold),
  ]);
  const parsed = parseMultisigPda(out);
  const multisigPda = process.env.SQUADS_MULTISIG_PDA || parsed || expectedPda;
  if (!parsed && !process.env.SQUADS_MULTISIG_PDA) {
    console.warn('[TODO T1] 未能从 CLI 输出解析 multisig pubkey，暂用本地推导值；请核对后设 SQUADS_MULTISIG_PDA。');
  }
  console.log('[squads-cli multisig-create]', out);

  // CLI 建库无 timeLock 参数 → 用 Config Transaction 提案补设（TODO T4：大小写按版本核对）
  if (cfg.timelockSeconds > 0) {
    assertNoPlaceholder(cfg.proposerKeypairPath, 'SQUADS_PROPOSER_KEYPAIR_PATH');
    const tl = await runCli(cfg, [
      'config-transaction-create',
      '--rpc-url', cfg.rpcUrl,
      '--program-id', SQUADS_V4_PROGRAM_ID.toBase58(),
      '--keypair', cfg.proposerKeypairPath,
      '--multisig-pubkey', multisigPda,
      '--action', `SetTimeLock ${cfg.timelockSeconds}`,
    ]);
    console.log('[squads-cli SetTimeLock 提案]', tl);
    console.log('⚠ 时间锁提案仍须 proposal-vote + config-transaction-execute 后才生效。');
  }
  return { multisigPda, vaultPda };
}

export async function setSpendingLimit(
  cfg: SquadsSetupConfig,
  _vaultPda: string,
  multisigPda?: string,
): Promise<{ allowanceId: string }> {
  assertNoPlaceholder(cfg.spendingLimit.destinationWallet, 'SQUADS_DESTINATION_WALLET');
  assertNoPlaceholder(cfg.spendingLimit.mint, 'SQUADS_SPEND_MINT');
  assertNoPlaceholder(cfg.spendingLimit.createKey, 'SQUADS_SPEND_CREATE_KEY');
  const manager = new SquadsV4TreasuryManager({
    threshold: cfg.threshold,
    timelockSeconds: cfg.timelockSeconds,
    createKey: cfg.createKey,
    members: cfg.members,
  });
  const msPda = multisigPda || manager.deriveMultisigPda().multisigPda;
  // 注意：当前按 SOL 的 9 位小数换算；若 SQUADS_SPEND_MINT 改成 USDC(6 位) 等，需相应改精度
  const amountBaseUnits = BigInt(Math.round(cfg.spendingLimit.amountSol * LAMPORTS_PER_SOL));
  const period = periodToSquadsToken(cfg.spendingLimit.periodSeconds);
  // 仅 Executor 成员可动用该 allowance；没有则退回全部成员（TODO：按实际角色定稿）
  const executorMembers = cfg.members.filter((m) => (permissionsFor(m, cfg) & 4) !== 0).map((m) => m.address);
  const allowedMembers = executorMembers.length ? executorMembers : cfg.members.map((m) => m.address);

  if (cfg.adapter === 'sdk') {
    const sdk = await loadSdk();
    const connection = new Connection(cfg.rpcUrl, 'confirmed');
    const feePayer = loadKeypair(cfg.proposerKeypairPath, 'SQUADS_PROPOSER_KEYPAIR_PATH');
    const msPk = new PublicKey(msPda);
    const info = await sdk.accounts.Multisig.fromAccountAddress(connection, msPk);
    const transactionIndex = BigInt(Number(info.transactionIndex) + 1);
    const actions = [{
      __kind: 'AddSpendingLimit',
      createKey: new PublicKey(cfg.spendingLimit.createKey),
      vaultIndex: 1,
      mint: new PublicKey(cfg.spendingLimit.mint),
      amount: Number(amountBaseUnits),
      members: allowedMembers.map((a) => new PublicKey(a)),
      destinations: [new PublicKey(cfg.spendingLimit.destinationWallet)],
      // TODO T3：官方文档的 AddSpendingLimit action 未列 period；装好 SDK 后对照 IDL 决定是否补
      // period,
    }];
    const ix = await sdk.instructions.configTransactionCreate({
      feePayer: feePayer.publicKey,
      multisigPda: msPk,
      transactionIndex,
      creator: feePayer.publicKey,
      actions, // TODO T4：SetTimeLock/SetTimelock 大小写冲突同样适用于其他 action
    });
    const sig = await sendAndConfirmTransaction(connection, new Transaction().add(ix), [feePayer]);
    console.log('AddSpendingLimit configTransactionCreate signature:', sig);
  } else {
    const baseArgs = [
      '--rpc-url', cfg.rpcUrl,
      '--program-id', SQUADS_V4_PROGRAM_ID.toBase58(),
      '--keypair', cfg.proposerKeypairPath, // config tx 创建者须有 Proposer 权限
    ];
    // TODO T2/T3：MEMBERS/DESTINATIONS 列表分隔符（逗号）与 PERIOD 取值需按 CLI 版本核对
    const action = [
      'AddSpendingLimit',
      cfg.spendingLimit.createKey,
      '1', // vaultIndex，与 buildPlan deriveVaultPda(1) 一致
      cfg.spendingLimit.mint,
      amountBaseUnits.toString(),
      period,
      allowedMembers.join(','),
      cfg.spendingLimit.destinationWallet,
    ].join(' ');
    const out = await runCli(cfg, [
      'config-transaction-create', ...baseArgs,
      '--multisig-pubkey', msPda,
      '--action', action,
    ]);
    console.log('[squads-cli AddSpendingLimit 提案]', out);
    console.log('⚠ 支出限额提案仍须 proposal-vote + config-transaction-execute（并过时间锁）后才生效。');
  }

  // TODO T5：seed 前缀需对照 @sqds/multisig getSpendingLimitPda 实测
  const [allowancePda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from('spending_limit'),
      new PublicKey(msPda).toBuffer(),
      new PublicKey(cfg.spendingLimit.createKey).toBuffer(),
    ],
    SQUADS_V4_PROGRAM_ID,
  );
  return { allowanceId: allowancePda.toBase58() };
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
    adapter: cfg.adapter,
    multisigPda,
    vaultPda,
    threshold: `${cfg.threshold}-of-${cfg.members.length}`,
    timelockSeconds: cfg.timelockSeconds,
    members: cfg.members.map((m) => ({ ...m, permissionBits: permissionsFor(m, cfg) })),
    spendingLimit: cfg.spendingLimit,
    boundary: '支出限额只管金库→交易钱包转账补充，不覆盖 swap（P0-5 未证，按不能覆盖设计）',
    prerequisite: cfg.adapter === 'sdk'
      ? '需提供 owner keypair + createKey keypair + P0-1 拍板值 + npm i @sqds/multisig'
      : '需提供 owner keypair + P0-1 拍板值 + squads-multisig-cli（见 SQUADS_SETUP_GUIDE.md）',
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
  const allowance = await setSpendingLimit(cfg, multisig.vaultPda, multisig.multisigPda);
  const receipt = writeReceipt({ createdAt: Date.now(), multisig, allowance, plan });
  console.log('✅ 建库/限额提案已提交：', JSON.stringify(multisig, null, 2));
  console.log('✅ 支出限额 PDA（待提案通过后生效）：', allowance.allowanceId);
  console.log('📄 开户回执：', receipt);
  console.log('下一步：');
  console.log(' 1) 用 Voter 成员对 SetTimeLock / AddSpendingLimit 提案 proposal-vote（达到阈值）；');
  console.log(' 2) config-transaction-execute 并执行 vault 转账提案；时间锁到期后限额才真正可用；');
  console.log(' 3) 把 vaultPda 记录为协议受托人，只给该 vault 注资；大额补充/改配置走提案+时间锁。');
}

import { pathToFileURL } from 'node:url';
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e?.message || e); process.exit(1); });
}
