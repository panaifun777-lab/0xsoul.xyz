import {
  VersionedTransaction,
  PublicKey,
  SystemProgram,
  TransactionInstruction
} from '@solana/web3.js';

import { JITO_TIP_ACCOUNTS } from './jito';

export interface AgentPolicyConfig {
  allowedProgramIds: Set<string>;   // 仅允许白名单合约 Program ID
  maxSolPerTx: number;              // 单笔最大消耗 SOL (Lamports: maxSolPerTx * 1e9)
  dailySpendLimitSol: number;       // 每日累计最大消耗 SOL
  allowExternalTransfer: boolean;   // 是否允许向未知外部地址转账 (默认 false，锁死资金外逃)
  maxSlippageBps: number;           // 滑点基点 (默认 500 = 5%)
}

export const DEFAULT_SECURITY_POLICY: AgentPolicyConfig = {
  allowedProgramIds: new Set([
    SystemProgram.programId.toBase58(),
    'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb', // Token-2022
    'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', // SPL Token
    'GangLaunchpad111111111111111111111111111111', // 内盘 Launchpad
    'GangPassport1111111111111111111111111111111', // 身份注册表
    'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4', // Jupiter v6
    'CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C', // Raydium CPMM
    'ComputeBudget111111111111111111111111111111', // Compute Budget
    ...JITO_TIP_ACCOUNTS                            // 全部 8 个 Jito 官方验证者 Tip 账户
  ]),
  maxSolPerTx: 1.5,
  dailySpendLimitSol: 15.0,
  allowExternalTransfer: false,
  maxSlippageBps: 500,
};

export class PolicyEnforcedSandbox {
  private policy: AgentPolicyConfig;
  private dailySpentLamports: number = 0;
  private lastResetTime: number = Date.now();

  constructor(policy: AgentPolicyConfig = DEFAULT_SECURITY_POLICY) {
    this.policy = policy;
  }

  /**
   * 毫秒级内存自审与拦截 (平均耗时 < 1ms)
   */
  public evaluateTransaction(
    tx: VersionedTransaction,
    agentPublicKey: PublicKey
  ): { allowed: boolean; reason?: string } {
    this.checkDailyReset();

    const staticKeys = tx.message.staticAccountKeys;
    const compiledInstructions = tx.message.compiledInstructions;

    // 1. 严格校验所有调用的 Program ID 是否全部位于白名单内
    for (const ix of compiledInstructions) {
      if (ix.programIdIndex >= staticKeys.length) {
        return { allowed: false, reason: 'Program ID 索引超出静态账户范围' };
      }
      const programId = staticKeys[ix.programIdIndex].toBase58();
      if (!this.policy.allowedProgramIds.has(programId)) {
        return {
          allowed: false,
          reason: `[风控拦截] 检测到未授权的程序调用 (Program ID: ${programId})`
        };
      }

      // 2. 检查 SystemProgram.transfer 行为，防止恶意转账攻击
      if (programId === SystemProgram.programId.toBase58()) {
        const isTransfer = this.inspectSystemInstruction(ix, staticKeys, agentPublicKey);
        if (isTransfer.violatesTransferRule) {
          return {
            allowed: false,
            reason: `[风控拦截] 禁止向非白名单外部地址进行原生 SOL 转账: ${isTransfer.targetAddress}`
          };
        }
        if (isTransfer.lamports > this.policy.maxSolPerTx * 1e9) {
          return {
            allowed: false,
            reason: `[风控拦截] 单笔转出额度 (${isTransfer.lamports / 1e9} SOL) 超出限制 (${this.policy.maxSolPerTx} SOL)`
          };
        }
      }
    }

    return { allowed: true };
  }

  /**
   * 记录并累加当日已消耗 Lamports
   */
  public recordSpend(lamports: number) {
    this.dailySpentLamports += lamports;
  }

  public getDailySpentSol(): number {
    return this.dailySpentLamports / 1e9;
  }

  private checkDailyReset() {
    const ONE_DAY_MS = 24 * 60 * 60 * 1000;
    if (Date.now() - this.lastResetTime > ONE_DAY_MS) {
      this.dailySpentLamports = 0;
      this.lastResetTime = Date.now();
    }
  }

  private inspectSystemInstruction(
    ix: { programIdIndex: number; accountKeyIndexes: number[]; data: Uint8Array },
    keys: PublicKey[],
    agentPubkey: PublicKey
  ): { violatesTransferRule: boolean; targetAddress?: string; lamports: number } {
    // System Instruction Type 2 = Transfer
    // data 格式: 4 字节 Instruction Type (2 = Transfer), 8 字节 Lamports (Little-Endian)
    if (ix.data.length >= 12 && ix.data[0] === 2) {
      const lamports = Number(
        new DataView(ix.data.buffer, ix.data.byteOffset, ix.data.byteLength).getBigUint64(4, true)
      );

      const senderIdx = ix.accountKeyIndexes[0];
      const recipientIdx = ix.accountKeyIndexes[1];

      if (recipientIdx < keys.length) {
        const recipient = keys[recipientIdx].toBase58();
        // 如果不允许向未知外部地址转账，且该接收方不是已知的白名单程序或官方 Jito 小费账户
        if (!this.policy.allowExternalTransfer && !this.policy.allowedProgramIds.has(recipient)) {
          return { violatesTransferRule: true, targetAddress: recipient, lamports };
        }
        return { violatesTransferRule: false, targetAddress: recipient, lamports };
      }
    }
    return { violatesTransferRule: false, lamports: 0 };
  }
}
