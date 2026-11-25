import { strict as assert } from 'assert';
import {
  ComputeBudgetProgram,
  Keypair,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import {
  DEFAULT_ALLOWED_PROGRAM_IDS,
  WSOL_MINT,
  buildJupiterSwap,
  isJupiterSwapEnabled,
  validateSwapTransaction,
  type JupiterSwapQuote,
} from '../src/price/jupiter_swap';

async function runTests() {
  console.log('=== Running Jupiter swap build/validate tests ===');

  const savedEnabled = process.env.JUPITER_SWAP_ENABLED;
  const savedNetwork = process.env.SOLANA_NETWORK;
  try {
    process.env.JUPITER_SWAP_ENABLED = '1';
    process.env.SOLANA_NETWORK = 'devnet';
    delete process.env.JUPITER_SWAP_ALLOW_DEVNET;
    assert.equal(isJupiterSwapEnabled(), false, 'devnet must stay disabled by default');
    process.env.JUPITER_SWAP_ALLOW_DEVNET = '1';
    assert.equal(isJupiterSwapEnabled(), true, 'devnet needs explicit opt-in');
    process.env.SOLANA_NETWORK = 'mainnet-beta';
    delete process.env.JUPITER_SWAP_ALLOW_DEVNET;
    assert.equal(isJupiterSwapEnabled(), true, 'mainnet allowed by swap flag');
    process.env.JUPITER_SWAP_ENABLED = '0';
    assert.equal(isJupiterSwapEnabled(), false, 'swap flag is required');
  } finally {
    if (savedEnabled === undefined) delete process.env.JUPITER_SWAP_ENABLED;
    else process.env.JUPITER_SWAP_ENABLED = savedEnabled;
    if (savedNetwork === undefined) delete process.env.SOLANA_NETWORK;
    else process.env.SOLANA_NETWORK = savedNetwork;
  }

  const payer = Keypair.generate().publicKey;
  const mint = Keypair.generate().publicKey;
  const message = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: Keypair.generate().publicKey.toBase58(),
    instructions: [
      ComputeBudgetProgram.setComputeUnitLimit({ units: 200000 }),
      SystemProgram.transfer({ fromPubkey: payer, toPubkey: mint, lamports: 1 }),
    ],
  }).compileToV0Message();
  const unsignedHex = Buffer.from(new VersionedTransaction(message).serialize()).toString('hex');
  const quote: JupiterSwapQuote = {
    inputMint: WSOL_MINT,
    outputMint: mint.toBase58(),
    inAmount: '1000000000',
    outAmount: '1000000',
    slippageBps: 50,
    minOut: '995000',
  };

  assert.deepEqual(
    validateSwapTransaction(unsignedHex, mint.toBase58(), quote, DEFAULT_ALLOWED_PROGRAM_IDS),
    { ok: true },
  );
  assert.equal(
    validateSwapTransaction(unsignedHex, Keypair.generate().publicKey.toBase58(), quote, DEFAULT_ALLOWED_PROGRAM_IDS).ok,
    false,
    'mint mismatch must fail',
  );
  assert.equal(
    validateSwapTransaction(unsignedHex, mint.toBase58(), { ...quote, minOut: '999999' }, DEFAULT_ALLOWED_PROGRAM_IDS).ok,
    false,
    'minOut mismatch must fail',
  );
  assert.equal(
    validateSwapTransaction(unsignedHex, mint.toBase58(), { ...quote, slippageBps: 501 }, DEFAULT_ALLOWED_PROGRAM_IDS).ok,
    false,
    'slippage above 500bps must fail',
  );
  assert.equal(
    validateSwapTransaction(unsignedHex, mint.toBase58(), quote, []).ok,
    false,
    'empty program allowlist must fail',
  );
  assert.equal(validateSwapTransaction('zz', mint.toBase58(), quote, DEFAULT_ALLOWED_PROGRAM_IDS).ok, false);

  process.env.JUPITER_SWAP_ENABLED = '0';
  assert.equal(
    await buildJupiterSwap({ isBuy: true, solAmount: 0.1, mint: mint.toBase58(), slippagePct: 1 }),
    null,
    'disabled module must return null without any network call',
  );

  console.log('=== Jupiter swap tests passed ===');
}

runTests().catch((e) => {
  console.error(e);
  process.exit(1);
});
