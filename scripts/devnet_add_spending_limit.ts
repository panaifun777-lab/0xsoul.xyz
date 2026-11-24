/**
 * devnet：给已建成的 Squads 金库加「支出限额」配置提案。
 * 金库 multisigPda=HD3Aj9...（见 data/squads-devnet-result.json），2-of-3。
 * 动作：AddSpendingLimit —— vault0 的 SOL，每天最多 0.5 SOL，只能转给 Turnkey 交易钱包。
 * 走 configTransactionCreate 提案（自治 multisig，configAuthority=multisig 自己）。
 * 提案创建后需 2 票通过 + 时间锁(24h)到期才能执行——本脚本只创建提案。
 */
import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import * as squads from '@sqds/multisig';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const RPC = 'https://api.devnet.solana.com';
const KEYPATH = resolve(process.cwd(), 'data', 'devnet-test-keypair.json');
const SQUADS_RESULT = resolve(process.cwd(), 'data', 'squads-devnet-result.json');
const OUTPATH = resolve(process.cwd(), 'data', 'squads-spending-proposal.json');
const PROGRAM_ID = new PublicKey('SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf');
const DEST_WALLET = new PublicKey('31qjM51uaPmEux4hoWnVopqjNBYgzHugGjQRzMtSx8ZL'); // Turnkey 交易钱包（唯一合法目标）

async function main() {
  const arr = JSON.parse(readFileSync(KEYPATH, 'utf8'));
  const creator = Keypair.fromSeed(Uint8Array.from(arr.slice(0, 32)));
  const sq = JSON.parse(readFileSync(SQUADS_RESULT, 'utf8'));
  const multisigPda = new PublicKey(sq.multisigPda);
  const connection = new Connection(RPC, 'confirmed');

  // 读当前 transaction index（提案索引用）
  const ms = await squads.accounts.Multisig.fromAccountAddress(connection, multisigPda);
  const transactionIndex = BigInt(ms.transactionIndex.toString()) + 1n;

  const spendCreateKey = Keypair.generate();
  const action = {
    __kind: 'AddSpendingLimit',
    createKey: spendCreateKey.publicKey,
    vaultIndex: 0,
    mint: PublicKey.default, // SOL
    amount: BigInt(Math.round(0.5 * LAMPORTS_PER_SOL)), // 0.5 SOL/天
    period: squads.generated.Period.Day,
    members: [creator.publicKey],
    destinations: [DEST_WALLET],
  };

  const sig = await (squads as any).rpc.configTransactionCreate({
    connection,
    feePayer: creator,
    multisigPda,
    transactionIndex,
    creator: creator.publicKey,
    actions: [action],
    memo: 'Step1 devnet: 金库→交易钱包 0.5 SOL/天 支出限额',
    programId: PROGRAM_ID,
  });

  const [proposalPda] = squads.getTransactionPda({ multisigPda, index: transactionIndex, programId: PROGRAM_ID });
  const result = {
    signature: sig,
    proposalPda: proposalPda.toBase58(),
    transactionIndex: transactionIndex.toString(),
    action: {
      vaultIndex: 0, mint: 'SOL', amountSolPerDay: 0.5,
      destinations: [DEST_WALLET.toBase58()], members: [creator.publicKey.toBase58()],
    },
    note: '提案已创建；需 2-of-3 投票通过 + 24h 时间锁到期后执行',
    explorer: 'https://explorer.solana.com/tx/' + sig + '?cluster=devnet',
  };
  writeFileSync(OUTPATH, JSON.stringify(result, null, 2), { mode: 0o600 });
  console.log(JSON.stringify(result, null, 2));
}
main().catch((e) => { console.error(e); process.exit(1); });
