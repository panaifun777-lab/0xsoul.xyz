import {
  Keypair,
  PublicKey,
  VersionedTransaction,
  SystemProgram
} from '@solana/web3.js';
import { deriveSolanaKeypairFromMnemonic, batchDeriveWallets } from './derive';
import { PolicyEnforcedSandbox, DEFAULT_SECURITY_POLICY, AgentPolicyConfig } from './policy';
import { JitoBundleManager } from './jito';

export interface ClusterAgentInfo {
  index: number;
  publicKey: PublicKey;
  role: string;
  passportPda: PublicKey;
}

export class SolanaAgentClusterManager {
  private masterMnemonic: string;
  private registryProgramId: PublicKey;
  private sandbox: PolicyEnforcedSandbox;
  private jitoManager: JitoBundleManager;
  private keypairs: Map<number, Keypair> = new Map();
  private passportPdas: Map<number, PublicKey> = new Map();

  constructor(
    masterMnemonic: string,
    registryProgramIdStr: string = 'GangPassport1111111111111111111111111111111',
    policyConfig: AgentPolicyConfig = DEFAULT_SECURITY_POLICY,
    jitoBlockEngineUrl?: string
  ) {
    this.masterMnemonic = masterMnemonic;
    this.registryProgramId = new PublicKey(registryProgramIdStr);
    this.sandbox = new PolicyEnforcedSandbox(policyConfig);
    this.jitoManager = new JitoBundleManager(jitoBlockEngineUrl);
  }

  /**
   * 按需获取或动态派生子钱包
   */
  public getOrDeriveWallet(accountIndex: number): Keypair {
    if (this.keypairs.has(accountIndex)) {
      return this.keypairs.get(accountIndex)!;
    }
    const kp = deriveSolanaKeypairFromMnemonic(this.masterMnemonic, accountIndex);
    this.keypairs.set(accountIndex, kp);

    // 派生其专属 .soul / passport PDA
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from('agent_passport'), kp.publicKey.toBuffer()],
      this.registryProgramId
    );
    this.passportPdas.set(accountIndex, pda);

    return kp;
  }

  /**
   * 获取指定子钱包的 AgentPassport PDA
   */
  public getPassportPda(accountIndex: number): PublicKey {
    if (!this.passportPdas.has(accountIndex)) {
      this.getOrDeriveWallet(accountIndex);
    }
    return this.passportPdas.get(accountIndex)!;
  }

  /**
   * 获取指定子钱包的公钥
   */
  public getPublicKey(accountIndex: number): PublicKey {
    return this.getOrDeriveWallet(accountIndex).publicKey;
  }

  /**
   * 预热加载 N 个子钱包 (用于 Slot 内高并发批量抢购)
   */
  public warmUpWallets(count: number = 10): ClusterAgentInfo[] {
    const list = batchDeriveWallets(this.masterMnemonic, 0, count);
    const infos: ClusterAgentInfo[] = [];

    for (const item of list) {
      this.keypairs.set(item.index, item.keypair);
      const [pda] = PublicKey.findProgramAddressSync(
        [Buffer.from('agent_passport'), item.publicKey.toBuffer()],
        this.registryProgramId
      );
      this.passportPdas.set(item.index, pda);

      infos.push({
        index: item.index,
        publicKey: item.publicKey,
        role: `SubAgent-${item.index}`,
        passportPda: pda
      });
    }

    return infos;
  }

  /**
   * 极速策略自审与自动签名 (< 15ms)
   */
  public async validateAndSignTx(
    agentIndex: number,
    unsignedTx: VersionedTransaction
  ): Promise<VersionedTransaction> {
    const kp = this.getOrDeriveWallet(agentIndex);

    // 1. 内存级硬编码风控沙盒自审
    const evalResult = this.sandbox.evaluateTransaction(unsignedTx, kp.publicKey);
    if (!evalResult.allowed) {
      throw new Error(`[Security Sandbox Violation] 交易被风控沙盒拦截: ${evalResult.reason}`);
    }

    // 2. 毫秒级内存 Ed25519 签名
    unsignedTx.sign([kp]);
    return unsignedTx;
  }

  /**
   * 组装多 Agent 并发交易与 Jito Tip 捆绑包
   */
  public buildConcurrentJitoBundle(
    agentIndexes: number[],
    unsignedTxs: VersionedTransaction[],
    recentBlockhash: string,
    tipLamports: number = 100_000
  ): Promise<VersionedTransaction[]> {
    if (agentIndexes.length !== unsignedTxs.length) {
      throw new Error('Agent 索引列表与交易列表数量必须一一对应');
    }

    const signedTxs: VersionedTransaction[] = [];
    for (let i = 0; i < agentIndexes.length; i++) {
      const idx = agentIndexes[i];
      const tx = unsignedTxs[i];
      const kp = this.getOrDeriveWallet(idx);

      const check = this.sandbox.evaluateTransaction(tx, kp.publicKey);
      if (!check.allowed) {
        throw new Error(`Agent [${idx}] 交易未通过安全风控: ${check.reason}`);
      }
      tx.sign([kp]);
      signedTxs.push(tx);
    }

    // 选用第一个 Agent 支付 Jito Tip
    const tipPayer = this.getOrDeriveWallet(agentIndexes[0]);
    const bundleWithTip = this.jitoManager.buildBundleWithTip(
      signedTxs,
      tipPayer,
      recentBlockhash,
      tipLamports
    );

    return Promise.resolve(bundleWithTip);
  }

  public getJitoManager(): JitoBundleManager {
    return this.jitoManager;
  }

  public getSandbox(): PolicyEnforcedSandbox {
    return this.sandbox;
  }
}
