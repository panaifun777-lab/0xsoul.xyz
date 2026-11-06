import {
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction
} from '@solana/web3.js';
import axios from 'axios';

/**
 * Jito 官方主网与测试网验证者小费接收地址池
 */
export const JITO_TIP_ACCOUNTS: string[] = [
  '96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5',
  'HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe',
  'Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY',
  'ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49',
  'DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh',
  'ADuUkR4vqLUMWXxW9gh6D6L8pWHLHzDvf6vnTm2VuGhL',
  'DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL',
  '3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT'
];

export interface JitoBundleResult {
  bundleId: string;
  status: 'submitted' | 'simulated' | 'failed';
  error?: string;
}

export class JitoBundleManager {
  private blockEngineUrl: string;

  constructor(blockEngineUrl: string = 'https://mainnet.block-engine.jito.wtf/api/v1/bundles') {
    this.blockEngineUrl = blockEngineUrl;
  }

  /**
   * 随机挑选一个 Jito 小费接收地址 (防单点负载)
   */
  public getRandomTipAccount(): PublicKey {
    const randomIndex = Math.floor(Math.random() * JITO_TIP_ACCOUNTS.length);
    return new PublicKey(JITO_TIP_ACCOUNTS[randomIndex]);
  }

  /**
   * 构造 Jito Tip 交易指令
   */
  public createTipInstruction(payer: PublicKey, lamports: number = 100_000): TransactionInstruction {
    const tipAccount = this.getRandomTipAccount();
    return SystemProgram.transfer({
      fromPubkey: payer,
      toPubkey: tipAccount,
      lamports
    });
  }

  /**
   * 组装带有 Jito 小费的完整 Bundle 交易列表
   * 保证 Bundle 内最多 5 笔交易，最后一笔或者在同一笔内携带小费
   */
  public buildBundleWithTip(
    userTxs: VersionedTransaction[],
    tipPayer: Keypair,
    recentBlockhash: string,
    tipLamports: number = 100_000
  ): VersionedTransaction[] {
    if (userTxs.length > 4) {
      throw new Error(`Jito Bundle 限制最多 4 笔业务交易 + 1 笔 Tip 交易 (当前: ${userTxs.length})`);
    }

    const tipIx = this.createTipInstruction(tipPayer.publicKey, tipLamports);
    const messageV0 = new TransactionMessage({
      payerKey: tipPayer.publicKey,
      recentBlockhash,
      instructions: [tipIx]
    }).compileToV0Message();

    const tipTx = new VersionedTransaction(messageV0);
    tipTx.sign([tipPayer]);

    return [...userTxs, tipTx];
  }

  /**
   * 提交 Bundle 到 Jito Block Engine
   */
  public async sendBundle(bundleTxs: VersionedTransaction[]): Promise<JitoBundleResult> {
    const encodedTxs = bundleTxs.map(tx => Buffer.from(tx.serialize()).toString('base64'));

    const payload = {
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'sendBundle',
      params: [encodedTxs]
    };

    try {
      const response = await axios.post(this.blockEngineUrl, payload, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 5000
      });

      if (response.data.error) {
        return {
          bundleId: '',
          status: 'failed',
          error: JSON.stringify(response.data.error)
        };
      }

      return {
        bundleId: response.data.result || `bundle_${Date.now()}`,
        status: 'submitted'
      };
    } catch (err: any) {
      return {
        bundleId: '',
        status: 'failed',
        error: err.response?.data?.error || err.message
      };
    }
  }
}
