/**
 * devnet SPL 买币策略验证探针（Turnkey 钱包为真实签名者）。
 * 测试 keypair 只负责建 mint / ATA / 铸造，真正提交给 Turnkey 签名的 transferChecked
 * 以 Turnkey 钱包为 fee payer 且为 source ATA owner，与 signWith 严格一致。
 */
import { Connection, Keypair, PublicKey, Transaction, SystemProgram } from '@solana/web3.js';
import {
  createInitializeMint2Instruction, createAssociatedTokenAccountInstruction,
  createMintToInstruction, createTransferCheckedInstruction,
  getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const RPC = 'https://api.devnet.solana.com';
const BUYER = new PublicKey('31qjM51uaPmEux4hoWnVopqjNBYgzHugGjQRzMtSx8ZL');
const KEYPATH = resolve(process.cwd(), 'data', 'devnet-test-keypair.json');
const OUTPATH = resolve(process.cwd(), 'data', 'spl-swap-probe.json');

async function main() {
  const arr = JSON.parse(readFileSync(KEYPATH, 'utf8'));
  const payer = Keypair.fromSeed(Uint8Array.from(arr.slice(0, 32)));
  const connection = new Connection(RPC, 'confirmed');
  const mint = Keypair.generate();

  const buyerAta = getAssociatedTokenAddressSync(mint.publicKey, BUYER);
  const poolAta = getAssociatedTokenAddressSync(mint.publicKey, payer.publicKey);

  const setup = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey, newAccountPubkey: mint.publicKey,
      space: 82, lamports: await connection.getMinimumBalanceForRentExemption(82),
      programId: TOKEN_PROGRAM_ID,
    }),
    createInitializeMint2Instruction(mint.publicKey, 6, payer.publicKey, payer.publicKey),
    createAssociatedTokenAccountInstruction(payer.publicKey, buyerAta, BUYER, mint.publicKey),
    createAssociatedTokenAccountInstruction(payer.publicKey, poolAta, payer.publicKey, mint.publicKey),
    createMintToInstruction(mint.publicKey, buyerAta, payer.publicKey, 1_000_000),
  );
  const setupSig = await connection.sendTransaction(setup, [payer, mint]);
  await connection.confirmTransaction(setupSig, 'confirmed');

  const { blockhash } = await connection.getLatestBlockhash('confirmed');
  const swap = new Transaction({ feePayer: BUYER, recentBlockhash: blockhash }).add(
    createTransferCheckedInstruction(buyerAta, mint.publicKey, poolAta, BUYER, 500_000, 6),
  );
  const unsignedHex = swap.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('hex');

  const result = {
    mint: mint.publicKey.toBase58(),
    buyerAta: buyerAta.toBase58(),
    poolAta: poolAta.toBase58(),
    buyer: BUYER.toBase58(),
    setupSig,
    unsignedHex,
    amountRaw: 500_000,
    decimals: 6,
  };
  writeFileSync(OUTPATH, JSON.stringify(result, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ ...result, unsignedHex: unsignedHex.slice(0, 40) + '...' }, null, 2));
}
main().catch((e) => { console.error(e); process.exit(1); });
