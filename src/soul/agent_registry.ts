/**
 * Agent ID 链上身份注册表（`<name>.soul` + 自动分配钱包）
 *
 * ## 产品目标
 *
 * 对标 Binance 的 `agent.ai`：用户为自己的 AI 智能体申请一个**全球唯一的链上身份**，
 * 形式为 `<agentname>.soul`，并**自动绑定一个专属钱包地址**。
 *
 * ## 两种注册模式
 *
 * | 模式 | 钱包来源 | 适用阶段 |
 * | :--- | :--- | :--- |
 * | `PLATFORM_AUTODERIVE` | 平台 HD 钱包集群派生（BIP-44） | **当前默认**（Arc 链未启动） |
 * | `ARC_EVM_BINDING` | 用户在 Arc L1 注册域名并绑定自有 Solana 公钥 | Arc 链上线后 |
 *
 * ## 设计要点
 *
 * 1. **一个 Agent 一个钱包**：BIP-44 路径 `m/44'/501'/<index>'/0'` 派生，确定性可复现。
 * 2. **一个钱包一个 Passport**：Solana PDA `["agent_passport", pubkey]`，杜绝女巫身份。
 * 3. **域名唯一**：全局大小写不敏感，注册即锁定。
 * 4. **链上锚定**：`passportPda` 可直接用于 Solana 链上 `register_passport` 指令。
 * 5. **持久化**：落地 `data/agents.json`，进程重启不丢身份。
 */

import fs from 'fs';
import path from 'path';
import { Keypair, PublicKey } from '@solana/web3.js';
import { deriveSolanaKeypairFromMnemonic } from '../wallet/derive';
import { SoulDomainResolver, SoulDidRecord } from './resolver';

/** Agent 身份记录 */
export interface AgentIdentity {
  /** 完整 .soul 域名，如 "mybot.soul" */
  soulDomain: string;
  /** 自动分配的 Solana 钱包地址（base58） */
  solanaAddress: string;
  /** 可选的 Arc L1（EVM）绑定地址 */
  evmAddress?: string;
  /** HD 派生索引（可用于复现钱包） */
  agentIndex: number;
  /** Solana 链上 Passport PDA */
  passportPda: string;
  /** 角色类型 */
  role: SoulDidRecord['role'];
  /** SRS 声誉分 0~10000 */
  reputationScore: number;
  /** 注册时间戳 */
  registeredAt: number;
  /** 状态 */
  status: 'ACTIVE' | 'REVOKED';
  /** 元数据 URI */
  metadataUri: string;
  /** 注册模式 */
  registeredVia: 'PLATFORM_AUTODERIVE' | 'ARC_EVM_BINDING';
}

export interface RegisterAgentParams {
  /** Agent 名称（不含 .soul 后缀），3~20 字符，仅小写字母/数字/连字符 */
  name: string;
  /** 角色，默认 QUANT_MAKER */
  role?: SoulDidRecord['role'];
  /** 注册模式，默认 PLATFORM_AUTODERIVE */
  mode?: 'PLATFORM_AUTODERIVE' | 'ARC_EVM_BINDING';
  /** ARC_EVM_BINDING 模式下用户提供的 Solana 公钥 */
  solanaAddress?: string;
  /** ARC_EVM_BINDING 模式下绑定的 EVM 地址 */
  evmAddress?: string;
}

/** 名称校验规则 */
const NAME_PATTERN = /^[a-z0-9]([a-z0-9-]{1,18})[a-z0-9]$/;

/** 平台自动分配钱包的 HD 索引起始值（避开 0~9 的内部做市集群） */
const AGENT_INDEX_BASE = 1000;

/**
 * Agent ID 注册表。
 *
 * 负责：名称校验、钱包自动派生、域名唯一性、Passport PDA 计算、持久化。
 */
export class AgentIdentityRegistry {
  private records: Map<string, AgentIdentity> = new Map();
  private bySolanaAddress: Map<string, string> = new Map();
  private nextIndex: number = AGENT_INDEX_BASE;
  private masterMnemonic: string;
  private registryProgramId: PublicKey;
  private soulResolver: SoulDomainResolver;
  private storagePath: string;

  constructor(
    masterMnemonic: string,
    soulResolver: SoulDomainResolver,
    options?: {
      registryProgramId?: string;
      storagePath?: string;
    },
  ) {
    this.masterMnemonic = masterMnemonic;
    this.soulResolver = soulResolver;
    this.registryProgramId = new PublicKey(
      options?.registryProgramId || process.env.GANG_PASSPORT_PROGRAM_ID || 'GangPassport1111111111111111111111111111111',
    );
    this.storagePath = options?.storagePath || path.join(process.cwd(), 'data', 'agents.json');
    this.load();
  }

  /* ------------------------------ 持久化 ------------------------------ */

  private load(): void {
    try {
      if (!fs.existsSync(this.storagePath)) return;
      const raw = fs.readFileSync(this.storagePath, 'utf8');
      const parsed = JSON.parse(raw) as { agents: AgentIdentity[]; nextIndex?: number };
      for (const rec of parsed.agents || []) {
        this.records.set(rec.soulDomain, rec);
        this.bySolanaAddress.set(rec.solanaAddress, rec.soulDomain);
        if (rec.agentIndex >= this.nextIndex) {
          this.nextIndex = rec.agentIndex + 1;
        }
      }
      if (parsed.nextIndex && parsed.nextIndex > this.nextIndex) {
        this.nextIndex = parsed.nextIndex;
      }
    } catch (err) {
      console.warn('[AgentRegistry] 加载历史身份失败，将以空注册表启动:', (err as Error).message);
    }
  }

  private persist(): void {
    try {
      const dir = path.dirname(this.storagePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        this.storagePath,
        JSON.stringify(
          {
            agents: Array.from(this.records.values()),
            nextIndex: this.nextIndex,
          },
          null,
          2,
        ),
        'utf8',
      );
    } catch (err) {
      console.warn('[AgentRegistry] 持久化失败:', (err as Error).message);
    }
  }

  /* ------------------------------ 核心方法 ------------------------------ */

  /** 校验并规范化 Agent 名称 */
  public normalizeName(name: string): string {
    const cleaned = (name || '').trim().toLowerCase().replace(/\.soul$/, '');
    if (!NAME_PATTERN.test(cleaned)) {
      throw new Error(
        `Invalid agent name "${name}": must be 3-20 chars, lowercase letters/digits/hyphen, not starting or ending with hyphen`,
      );
    }
    const reserved = ['system', 'admin', 'official', 'gang', 'root', 'treasury', 'arc', 'sol'];
    if (reserved.includes(cleaned)) {
      throw new Error(`Agent name "${cleaned}" is reserved by the protocol`);
    }
    return cleaned;
  }

  /** 计算 Passport PDA */
  public computePassportPda(solanaAddress: string): string {
    const owner = new PublicKey(solanaAddress);
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from('agent_passport'), owner.toBuffer()],
      this.registryProgramId,
    );
    return pda.toBase58();
  }

  /**
   * 注册一个新的 Agent 链上身份。
   *
   * - `PLATFORM_AUTODERIVE`（默认）：平台按 BIP-44 自动派生一个全新 Solana 钱包，
   *   用户无需准备任何东西即可拿到 `<name>.soul` + 钱包地址。
   * - `ARC_EVM_BINDING`：用户已在 Arc L1 注册域名并绑定自有 Solana 公钥，
   *   此处仅登记身份（钱包私钥由用户自持）。
   */
  public register(params: RegisterAgentParams): AgentIdentity {
    const label = this.normalizeName(params.name);
    const soulDomain = `${label}.soul`;

    if (this.records.has(soulDomain)) {
      throw new Error(`Domain ${soulDomain} is already registered`);
    }

    const mode = params.mode || 'PLATFORM_AUTODERIVE';
    const role = params.role || 'QUANT_MAKER';

    let solanaAddress: string;
    let agentIndex: number;

    if (mode === 'ARC_EVM_BINDING') {
      // 用户自持钱包：校验公钥合法性
      if (!params.solanaAddress) {
        throw new Error('ARC_EVM_BINDING mode requires solanaAddress');
      }
      try {
        new PublicKey(params.solanaAddress);
      } catch {
        throw new Error(`Invalid Solana address: ${params.solanaAddress}`);
      }
      if (this.bySolanaAddress.has(params.solanaAddress)) {
        throw new Error(
          `Solana address ${params.solanaAddress} is already bound to ${this.bySolanaAddress.get(params.solanaAddress)}`,
        );
      }
      solanaAddress = params.solanaAddress;
      agentIndex = -1; // 用户自持，平台不派生
    } else {
      // 平台自动派生专用钱包
      agentIndex = this.nextIndex++;
      const kp = deriveSolanaKeypairFromMnemonic(this.masterMnemonic, agentIndex);
      solanaAddress = kp.publicKey.toBase58();
    }

    const passportPda = this.computePassportPda(solanaAddress);

    const identity: AgentIdentity = {
      soulDomain,
      solanaAddress,
      evmAddress: params.evmAddress,
      agentIndex,
      passportPda,
      role,
      reputationScore: 1000,
      registeredAt: Date.now(),
      status: 'ACTIVE',
      metadataUri: `https://0xsoul.xyz/agent/${label}.json`,
      registeredVia: mode,
    };

    this.records.set(soulDomain, identity);
    this.bySolanaAddress.set(solanaAddress, soulDomain);

    // 同步到 DID 注册表，使网关鉴权链路立即可用
    this.soulResolver.registerSoulDomain({
      soulDomain,
      solanaAddress,
      role,
      reputationScore: 1000,
      isBanned: false,
      metadataUri: identity.metadataUri,
      registeredAt: identity.registeredAt,
    });

    this.persist();
    return identity;
  }

  /** 按域名查询 */
  public resolve(soulDomain: string): AgentIdentity | null {
    const key = soulDomain.toLowerCase().endsWith('.soul') ? soulDomain.toLowerCase() : `${soulDomain.toLowerCase()}.soul`;
    return this.records.get(key) || null;
  }

  /** 按 Solana 地址反查 */
  public reverseResolve(solanaAddress: string): AgentIdentity | null {
    const domain = this.bySolanaAddress.get(solanaAddress);
    return domain ? this.records.get(domain) || null : null;
  }

  /** 列出全部身份 */
  public list(options?: { status?: AgentIdentity['status']; limit?: number }): AgentIdentity[] {
    let all = Array.from(this.records.values());
    if (options?.status) all = all.filter((r) => r.status === options.status);
    all.sort((a, b) => b.registeredAt - a.registeredAt);
    return options?.limit ? all.slice(0, options.limit) : all;
  }

  /** 撤销身份（不删除记录，置为 REVOKED，保留审计轨迹） */
  public revoke(soulDomain: string): AgentIdentity {
    const rec = this.resolve(soulDomain);
    if (!rec) throw new Error(`Agent identity not found: ${soulDomain}`);
    rec.status = 'REVOKED';
    this.persist();
    return rec;
  }

  /** 统计信息 */
  public stats(): { total: number; active: number; revoked: number; nextIndex: number } {
    const all = Array.from(this.records.values());
    return {
      total: all.length,
      active: all.filter((r) => r.status === 'ACTIVE').length,
      revoked: all.filter((r) => r.status === 'REVOKED').length,
      nextIndex: this.nextIndex,
    };
  }
}
