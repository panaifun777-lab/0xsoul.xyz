/**
 * Squads v4 devnet 建库 —— dry-run 构造验证（不发送、不花 SOL）
 * 仅验证 @sqds/multisig 的 multisigCreateV2 能正确构造交易、PDA 能推导。
 * 真实建库需给 creator 领 devnet SOL 后去掉 --dry-run 发送。
 */
import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import * as squads from '@sqds/multisig';
const multisigCreateV2 = (squads as any).transactions.multisigCreateV2;
const getMultisigPda = (squads as any).getMultisigPda;

const RPC = 'https://api.devnet.solana.com';
const PROGRAM_ID = new PublicKey('SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf');

async function main() {
  const connection = new Connection(RPC, 'confirmed');
  const creator = Keypair.generate();
  const createKey = Keypair.generate();
  const members = [Keypair.generate(), Keypair.generate(), Keypair.generate()].map((k, i) => ({
    key: k.publicKey,
    permissions: { mask: i === 0 ? (1 | 2) : 2 }, // 首位 Proposer+Voter，其余 Voter
  }));
  const [multisigPda] = getMultisigPda({ createKey: createKey.publicKey, programId: PROGRAM_ID });
  const { blockhash } = await connection.getLatestBlockhash('confirmed');

  const tx = multisigCreateV2({
    blockhash,
    treasury: PublicKey.default, // SOL treasury
    createKey: createKey.publicKey,
    creator: creator.publicKey,
    multisigPda,
    configAuthority: null,
    threshold: 2,
    members,
    timeLock: 86400,
    rentCollector: null,
    programId: PROGRAM_ID,
  });
  tx.sign([creator, createKey]);

  console.log(JSON.stringify({
    dryRun: true,
    multisigPda: multisigPda.toBase58(),
    creator: creator.publicKey.toBase58(),
    createKey: createKey.publicKey.toBase58(),
    members: members.map((m) => ({ key: m.key.toBase58(), permissions: m.permissions })),
    threshold: 2,
    timeLock: 86400,
    txSigned: tx.signatures.every((s) => !!s.signature),
    note: '交易已构造+签名，未广播（creator 需 devnet SOL 付租金）',
  }, null, 2));
}
main().catch((e) => { console.error(e); process.exit(1); });
