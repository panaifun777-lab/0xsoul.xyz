/**
 * 联合曲线初始化脚本（init_curve 指令调用）
 *
 * ## 为什么必须执行这一步
 *
 * 合约里所有手续费转账都会校验 `bonding_curve.fee_receiver` 是否等于传入的收款账户。
 * 如果代币创建时没有登记 `fee_receiver`，那么：
 * - 买入/卖出的手续费虽被扣除，但校验会失败，交易直接回滚；
 * - 或者（旧曲线）允许任意账户，手续费可能被打到非预期地址。
 *
 * 因此**每一个新代币在开盘前都必须调用本脚本登记协议收款地址**。
 *
 * ## 用法
 *
 * ```bash
 * # Devnet（需先执行 deploy.sh 完成部署）
 * npx tsx scripts/init_curve.ts --cluster devnet --mint <代币Mint地址>
 *
 * # 批量初始化（从文件读取 mint 列表）
 * npx tsx scripts/init_curve.ts --cluster devnet --file mints.txt
 * ```
 *
 * ## 前置条件
 *
 * - 已部署 gang_launchpad 合约
 * - 创建者钱包持有有效 AgentPassport
 * - 环境变量 GANG_PROTOCOL_FEE_RECEIVER_SOLANA 已设置
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  Connection,
  Keypair,
  PublicKey,
  TransactionInstruction,
  Transaction,
  sendAndConfirmTransaction,
  clusterApiUrl,
} from '@solana/web3.js';
import { loadEnv } from '../src/config/env';

loadEnv();

/* ------------------------------------------------------------------ */
/* 参数解析                                                            */
/* ------------------------------------------------------------------ */

interface CliOptions {
  cluster: 'devnet' | 'mainnet-beta' | 'localnet';
  mint?: string;
  file?: string;
  wallet?: string;
  programId: string;
  feeReceiver?: string;
  targetSol: number;
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    cluster: 'devnet',
    programId: process.env.GANG_PROGRAM_ID || 'GangLaunchpad111111111111111111111111111111',
    feeReceiver: process.env.GANG_PROTOCOL_FEE_RECEIVER_SOLANA,
    targetSol: Number(process.env.GRADUATION_TARGET_SOL || 50),
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--cluster':
        opts.cluster = (argv[++i] as CliOptions['cluster']) || 'devnet';
        break;
      case '--mint':
        opts.mint = argv[++i];
        break;
      case '--file':
        opts.file = argv[++i];
        break;
      case '--wallet':
        opts.wallet = argv[++i];
        break;
      case '--program-id':
        opts.programId = argv[++i];
        break;
      case '--fee-receiver':
        opts.feeReceiver = argv[++i];
        break;
      case '--target-sol':
        opts.targetSol = Number(argv[++i]);
        break;
      default:
        if (arg.startsWith('--')) {
          throw new Error(`未知参数: ${arg}`);
        }
    }
  }
  return opts;
}

/* ------------------------------------------------------------------ */
/* 指令构造                                                            */
/* ------------------------------------------------------------------ */

/** 指令标签 6 = InitCurve（与 Rust lib.rs 分发保持一致） */
const INSTRUCTION_TAG_INIT_CURVE = 6;

/** Borsh 序列化 u64 */
function encodeU64(value: number): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(BigInt(Math.floor(value)));
  return buf;
}

/** 计算 BondingCurveState PDA */
function deriveCurvePda(mint: PublicKey, programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('bonding_curve'), mint.toBuffer()],
    programId,
  );
}

/** 计算 AgentPassport PDA */
function derivePassportPda(creator: PublicKey, programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('agent_passport'), creator.toBuffer()],
    programId,
  );
}

/**
 * 构造 init_curve 指令。
 *
 * 账户顺序必须与 `programs/gang_launchpad/src/instructions/init_curve.rs` 完全一致：
 *   0. [signer, writable]  creator
 *   1. []                  agent_passport
 *   2. []                  mint
 *   3. [writable]          bonding_curve PDA
 *   4. []                  fee_receiver
 *   5. []                  system_program
 */
function buildInitCurveInstruction(
  creator: PublicKey,
  mint: PublicKey,
  feeReceiver: PublicKey,
  programId: PublicKey,
  targetSol: number,
): TransactionInstruction {
  const [curvePda] = deriveCurvePda(mint, programId);
  const [passportPda] = derivePassportPda(creator, programId);
  const systemProgram = new PublicKey('11111111111111111111111111111111');

  // 数据 = [tag(1)] + [target_sol_graduation(u64)]
  const data = Buffer.concat([
    Buffer.from([INSTRUCTION_TAG_INIT_CURVE]),
    encodeU64(targetSol * 1_000_000_000),
  ]);

  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: creator, isSigner: true, isWritable: true },
      { pubkey: passportPda, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: curvePda, isSigner: false, isWritable: true },
      { pubkey: feeReceiver, isSigner: false, isWritable: false },
      { pubkey: systemProgram, isSigner: false, isWritable: false },
    ],
    data,
  });
}

/* ------------------------------------------------------------------ */
/* 主流程                                                              */
/* ------------------------------------------------------------------ */

async function loadKeypair(walletPath?: string): Promise<Keypair> {
  const candidates = walletPath
    ? [walletPath]
    : [
        process.env.ANCHOR_WALLET,
        path.join(process.env.HOME || process.env.USERPROFILE || '', '.config', 'solana', 'id.json'),
      ].filter(Boolean) as string[];

  for (const p of candidates) {
    if (p && fs.existsSync(p)) {
      const raw = JSON.parse(fs.readFileSync(p, 'utf8')) as number[];
      return Keypair.fromSecretKey(Uint8Array.from(raw));
    }
  }
  throw new Error(
    '未找到钱包文件。请指定 --wallet 路径，或设置 ANCHOR_WALLET 环境变量。',
  );
}

function resolveRpcUrl(cluster: CliOptions['cluster']): string {
  if (cluster === 'localnet') return 'http://127.0.0.1:8899';
  if (cluster === 'mainnet-beta') {
    return process.env.SOLANA_MAINNET_RPC || clusterApiUrl('mainnet-beta');
  }
  return process.env.SOLANA_DEVNET_RPC || clusterApiUrl('devnet');
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  console.log('============================================================');
  console.log('  GANG.SOUL 联合曲线初始化');
  console.log('============================================================');

  if (!opts.feeReceiver) {
    console.error('❌ 缺少协议收款地址。');
    console.error('   请设置环境变量 GANG_PROTOCOL_FEE_RECEIVER_SOLANA，或传入 --fee-receiver <地址>');
    process.exit(1);
  }

  const feeReceiver = new PublicKey(opts.feeReceiver);
  if (feeReceiver.equals(PublicKey.default)) {
    console.error('❌ 收款地址不能是默认地址（全零），否则手续费将被销毁。');
    process.exit(1);
  }

  const programId = new PublicKey(opts.programId);
  const rpcUrl = resolveRpcUrl(opts.cluster);
  const connection = new Connection(rpcUrl, 'confirmed');
  const creator = await loadKeypair(opts.wallet);

  console.log(`  集群:       ${opts.cluster} (${rpcUrl})`);
  console.log(`  程序 ID:    ${programId.toBase58()}`);
  console.log(`  创建者:     ${creator.publicKey.toBase58()}`);
  console.log(`  收款地址:   ${feeReceiver.toBase58()}`);
  console.log(`  毕业目标:   ${opts.targetSol} SOL`);
  console.log('------------------------------------------------------------');

  // 收集待初始化的 mint 列表
  const mints: string[] = [];
  if (opts.mint) mints.push(opts.mint);
  if (opts.file) {
    const content = fs.readFileSync(opts.file, 'utf8');
    content
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'))
      .forEach((l) => mints.push(l));
  }

  if (mints.length === 0) {
    console.error('❌ 未提供代币 Mint。请用 --mint <地址> 或 --file <文件> 指定。');
    process.exit(1);
  }

  console.log(`待初始化代币数量: ${mints.length}`);
  console.log('------------------------------------------------------------');

  let success = 0;
  let skipped = 0;
  let failed = 0;

  for (const mintStr of mints) {
    try {
      const mint = new PublicKey(mintStr);
      const [curvePda] = deriveCurvePda(mint, programId);

      // 已初始化则跳过，避免重复消耗手续费
      const existing = await connection.getAccountInfo(curvePda);
      if (existing) {
        console.log(`⏭️  跳过 ${mintStr.slice(0, 8)}... 曲线已存在 (${curvePda.toBase58().slice(0, 8)}...)`);
        skipped++;
        continue;
      }

      const ix = buildInitCurveInstruction(
        creator.publicKey,
        mint,
        feeReceiver,
        programId,
        opts.targetSol,
      );
      const tx = new Transaction().add(ix);
      // 不需要额外签名者：创建者写数据，系统程序创建账户由 invoke_signed 完成
      const sig = await sendAndConfirmTransaction(connection, tx, [creator], {
        commitment: 'confirmed',
        maxRetries: 3,
      });

      console.log(`✅ ${mintStr.slice(0, 8)}... 初始化成功 | Tx: ${sig.slice(0, 20)}...`);
      success++;
    } catch (err) {
      console.error(`❌ ${mintStr.slice(0, 8)}... 初始化失败: ${(err as Error).message}`);
      failed++;
    }
  }

  console.log('============================================================');
  console.log(`  成功: ${success}  跳过: ${skipped}  失败: ${failed}`);
  console.log('============================================================');

  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('初始化脚本异常终止:', err);
  process.exit(1);
});
