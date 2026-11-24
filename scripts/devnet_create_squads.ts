/**
 * devnet 真实建 Squads v4 金库（用测试 keypair，全程容器内同进程）。
 * createKey + creator 都可用同一个测试 keypair（Squads 允许，只要 createKey 是一次性 seed）。
 * 角色：creator=Voter(2)+Proposer(1), 另两个测试成员=Voter(2)。阈值 2-of-3，时间锁 24h。
 */
import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import * as squads from '@sqds/multisig';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const RPC = 'https://api.devnet.solana.com';
const KEYPATH = resolve(process.cwd(), 'data', 'devnet-test-keypair.json');
const OUTPATH = resolve(process.cwd(), 'data', 'squads-devnet-result.json');
const PROGRAM_ID = new PublicKey('SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf');

async function main() {
  const arr = JSON.parse(readFileSync(KEYPATH, 'utf8'));
  const creator = Keypair.fromSeed(Uint8Array.from(arr.slice(0, 32)));
  const connection = new Connection(RPC, 'confirmed');
  const createKey = Keypair.generate();

  const [multisigPda] = squads.getMultisigPda({ createKey: createKey.publicKey, programId: PROGRAM_ID });
  const [vaultPda] = squads.getVaultPda({ multisigPda, index: 0, programId: PROGRAM_ID });

  // treasury 必须是 program config 的 treasury（官方文档 create-multisig.md）
  const [programConfigPda] = squads.getProgramConfigPda({ programId: PROGRAM_ID });
  const programConfig = await squads.accounts.ProgramConfig.fromAccountAddress(connection, programConfigPda);
  const configTreasury = programConfig.treasury;

  const members = [
    { key: creator.publicKey, permissions: { mask: 1 | 2 | 4 } }, // Proposer + Voter + Executor（全部）
    { key: Keypair.generate().publicKey, permissions: { mask: 2 } }, // Voter
    { key: Keypair.generate().publicKey, permissions: { mask: 2 } }, // Voter
  ];

  const sig = await (squads as any).rpc.multisigCreateV2({
    connection,
    treasury: configTreasury, // program config treasury（官方要求）
    createKey,
    creator,
    multisigPda,
    configAuthority: null,
    threshold: 2,
    members,
    timeLock: 86400,
    rentCollector: null,
    programId: PROGRAM_ID,
  });

  const result = {
    signature: sig,
    multisigPda: multisigPda.toBase58(),
    vaultPda: vaultPda.toBase58(),
    createKey: createKey.publicKey.toBase58(),
    threshold: 2,
    timeLock: 86400,
    members: members.map((m) => ({ key: m.key.toBase58(), permissions: m.permissions })),
    explorer: 'https://explorer.solana.com/tx/' + sig + '?cluster=devnet',
  };
  writeFileSync(OUTPATH, JSON.stringify(result, null, 2), { mode: 0o600 });
  console.log(JSON.stringify(result, null, 2));
}
main().catch((e) => { console.error(e); process.exit(1); });
