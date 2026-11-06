import * as bip39 from 'bip39';
import { derivePath } from 'ed25519-hd-key';
import { Keypair, PublicKey } from '@solana/web3.js';
import nacl from 'tweetnacl';

/**
 * 依据 BIP44 标准推导 Solana Ed25519 密钥对
 * 兼容 Phantom, Solflare, Backpack 等主流钱包路径: m/44'/501'/${index}'/0'
 */
export function deriveSolanaKeypairFromMnemonic(mnemonic: string, accountIndex: number): Keypair {
  const seed = bip39.mnemonicToSeedSync(mnemonic);
  const path = `m/44'/501'/${accountIndex}'/0'`;
  const derivedSeed = derivePath(path, seed.toString('hex')).key;
  const keypair = nacl.sign.keyPair.fromSeed(derivedSeed);
  return Keypair.fromSecretKey(keypair.secretKey);
}

/**
 * 批量并发派生子钱包集群
 */
export function batchDeriveWallets(
  mnemonic: string,
  startIndex: number = 0,
  count: number = 10
): Array<{ index: number; keypair: Keypair; publicKey: PublicKey }> {
  const wallets = [];
  for (let i = 0; i < count; i++) {
    const idx = startIndex + i;
    const kp = deriveSolanaKeypairFromMnemonic(mnemonic, idx);
    wallets.push({
      index: idx,
      keypair: kp,
      publicKey: kp.publicKey
    });
  }
  return wallets;
}
