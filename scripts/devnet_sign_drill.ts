/**
 * devnet 广播演练：测试 keypair 构造 System 转账 → Turnkey 提交 → (外部 owner 批准) → 广播。
 * 步骤 1（本脚本）：用测试 keypair 构造 unsigned tx，输出 hex + blockhash，供 Turnkey 提交。
 * 关键：blockhash 新鲜度 —— 拿 blockhash 后必须在 ~60s 内完成签名+广播。
 * 运行（容器内）：npx tsx scripts/devnet_sign_drill.ts
 */
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const RPC = 'https://api.devnet.solana.com';
const KEYPATH = resolve(process.cwd(), 'data', 'devnet-test-keypair.json');
const DEST = 'Ec7UHjh6K3GKPQPYBYb2tEHSRKBWrtgmsW4YDwuc2EHh';

async function main() {
  const arr = JSON.parse(readFileSync(KEYPATH, 'utf8'));
  const from = Keypair.fromSeed(Uint8Array.from(arr.slice(0, 32)));
  const connection = new Connection(RPC, 'confirmed');
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
  const tx = new Transaction({ feePayer: from.publicKey, recentBlockhash: blockhash }).add(
    SystemProgram.transfer({ fromPubkey: from.publicKey, toPubkey: new PublicKey(DEST), lamports: Math.round(0.01 * LAMPORTS_PER_SOL) }),
  );
  // 测试 keypair 自己签（这里是普通 devnet 转账演练，不走 Turnkey）
  tx.sign(from);
  const raw = tx.serialize();
  const sig = await connection.sendRawTransaction(raw, { skipPreflight: false });
  const confirmation = await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
  console.log(JSON.stringify({
    txid: sig,
    from: from.publicKey.toBase58(),
    to: DEST,
    amountSol: 0.01,
    confirmed: confirmation.value.err === null,
    err: confirmation.value.err,
  }, null, 2));
}
main().catch((e) => { console.error(e); process.exit(1); });
