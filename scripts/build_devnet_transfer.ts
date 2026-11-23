/**
 * 构造一笔 devnet System Program 转账的 unsigned transaction（base64），供 Turnkey 签名。
 * 不签名、不广播、不需要私钥——只需公钥 + recentBlockhash。
 * 用：npx tsx scripts/build_devnet_transfer.ts
 */
import { Connection, PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL } from '@solana/web3.js';

const FROM = '31qjM51uaPmEux4hoWnVopqjNBYgzHugGjQRzMtSx8ZL';
const TO = 'Ec7UHjh6K3GKPQPYBYb2tEHSRKBWrtgmsW4YDwuc2EHh';
const AMOUNT_SOL = 0.01;
const RPC = 'https://api.devnet.solana.com';

async function main() {
  // 允许通过命令行传入 blockhash（离线构造），否则从 RPC 取
  let blockhash = process.argv[2] || '';
  if (!blockhash) {
    const connection = new Connection(RPC, 'confirmed');
    ({ blockhash } = await connection.getLatestBlockhash('confirmed'));
  }
  const tx = new Transaction({
    feePayer: new PublicKey(FROM),
    recentBlockhash: blockhash,
  }).add(
    SystemProgram.transfer({
      fromPubkey: new PublicKey(FROM),
      toPubkey: new PublicKey(TO),
      lamports: Math.round(AMOUNT_SOL * LAMPORTS_PER_SOL),
    }),
  );
  const base64 = tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64');
  console.log(JSON.stringify({
    type: 'TRANSACTION_TYPE_SOLANA',
    signWith: 'PLACEHOLDER_WALLET_ID', // 由调用脚本替换
    unsignedTransaction: base64,
    blockhash,
    from: FROM,
    to: TO,
    amountSol: AMOUNT_SOL,
  }));
}
main().catch((e) => { console.error(e); process.exit(1); });
