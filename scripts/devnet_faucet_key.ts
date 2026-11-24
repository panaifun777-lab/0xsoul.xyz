/**
 * 生成/读取一个固定的 devnet 测试 keypair（用于领 faucet SOL、建 Squads 金库、广播演练）。
 * 私钥只存 VPS 本地 /app/data/devnet-test-keypair.json (0600)，不进 git、不进代码。
 * 运行：npx tsx scripts/devnet_faucet_key.ts [new]
 */
import { Keypair } from '@solana/web3.js';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const KEYPATH = resolve(process.cwd(), 'data', 'devnet-test-keypair.json');

function loadOrCreate(forceNew: boolean): Keypair {
  if (!forceNew && existsSync(KEYPATH)) {
    const arr = JSON.parse(readFileSync(KEYPATH, 'utf8'));
    // 64 字节 secretKey 的前 32 字节即 seed；fromSeed 可重建完全相同的 keypair
    return Keypair.fromSeed(Uint8Array.from(arr.slice(0, 32)));
  }
  const k = Keypair.generate();
  writeFileSync(KEYPATH, JSON.stringify(Array.from(k.secretKey)), { mode: 0o600 });
  return k;
}

const k = loadOrCreate(process.argv[2] === 'new');
console.log(JSON.stringify({ address: k.publicKey.toBase58(), keypairPath: KEYPATH }));
