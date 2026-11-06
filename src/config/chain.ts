import { clusterApiUrl, PublicKey } from '@solana/web3.js';

export type SolanaClusterEnv = 'devnet' | 'mainnet-beta' | 'testnet' | 'localnet';

export interface ChainConfig {
  network: SolanaClusterEnv;
  rpcEndpoints: string[];
  wsEndpoints: string[];
  jitoBlockEngineUrl: string;
  jitoTipAccounts: string[];
  /** Jito Bundle 默认 Tip 金额（SOL） */
  jitoTipSol: number;
  programId: string;
  passportProgramId: string;
  defaultCommitment: 'processed' | 'confirmed' | 'finalized';
  maxRetries: number;
  rpcTimeoutMs: number;
}

export const DEVNET_CONFIG: ChainConfig = {
  network: 'devnet',
  rpcEndpoints: Array.from(new Set([
    process.env.SOLANA_DEVNET_RPC || '',
    clusterApiUrl('devnet'),
    'https://api.devnet.solana.com',
    'https://rpc.ankr.com/solana_devnet',
  ].filter(Boolean))),
  wsEndpoints: Array.from(new Set([
    process.env.SOLANA_DEVNET_WS || '',
    'wss://api.devnet.solana.com',
  ].filter(Boolean))),
  jitoBlockEngineUrl: 'https://devnet.block-engine.jito.wtf',
  jitoTipAccounts: [
    'DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh',
    'ADuUkR4vqLUMWXxW9gh6D6L8pWaz9AQNc2YvtBkndbMm',
  ],
  jitoTipSol: Number(process.env.JITO_TIP_SOL || 0.001),
  programId: 'GangLaunchpad111111111111111111111111111111',
  passportProgramId: 'GangPassport1111111111111111111111111111111',
  defaultCommitment: 'confirmed',
  maxRetries: 3,
  rpcTimeoutMs: 10000,
};

export const MAINNET_CONFIG: ChainConfig = {
  network: 'mainnet-beta',
  rpcEndpoints: Array.from(new Set([
    process.env.SOLANA_MAINNET_RPC || '',
    'https://api.mainnet-beta.solana.com',
    'https://solana-mainnet.g.alchemy.com/v2/demo',
    'https://rpc.ankr.com/solana',
  ].filter(Boolean))),
  wsEndpoints: Array.from(new Set([
    process.env.SOLANA_MAINNET_WS || '',
    'wss://api.mainnet-beta.solana.com',
  ].filter(Boolean))),
  jitoBlockEngineUrl: 'https://mainnet.block-engine.jito.wtf',
  jitoTipAccounts: [
    '96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5',
    'HFqU5x63VTxvQssQnVTycT2ccFgReUJmqK6Y54w9NReC',
    'Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY',
    'ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49',
    'DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh',
    'ADuUkR4vqLUMWXxW9gh6D6L8pWaz9AQNc2YvtBkndbMm',
    'DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL',
    '3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT',
  ],
  jitoTipSol: Number(process.env.JITO_TIP_SOL || 0.001),
  programId: 'GangLaunchpad111111111111111111111111111111',
  passportProgramId: 'GangPassport1111111111111111111111111111111',
  defaultCommitment: 'confirmed',
  maxRetries: 5,
  rpcTimeoutMs: 8000,
};

export function getChainConfig(network?: SolanaClusterEnv): ChainConfig {
  const target = network || (process.env.SOLANA_NETWORK as SolanaClusterEnv) || 'devnet';
  if (target === 'mainnet-beta') {
    return MAINNET_CONFIG;
  }
  return DEVNET_CONFIG;
}
