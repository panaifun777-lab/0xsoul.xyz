/**
 * AFC `.soul` 双链 DID 桥接适配器 (Arc L1 → Solana)
 *
 * ## 架构
 *
 * ```
 *   Arc L1 (EVM, USDC 结算)              Solana
 *   ───────────────────────              ──────────────────────
 *   ArcNameRegistry  (ERC-721)           AgentPassport PDA
 *   tokenId = keccak256("name.soul")     seeds = ["agent_passport", pubkey]
 *   ownerOf(tokenId) → EVM 地址          soul_domain: "name.soul"
 *                                        solana_address: <base58>
 *            │                                     ▲
 *            │ Resolver.addr(tokenId, 501)         │
 *            └──────── 只读 eth_call ──────────────┤
 *                                                  │
 *              ┌──── 网关 Ed25519 Attestation ────┘
 *              │  读 Arc 链 → 校验归属 → 签发凭证
 *              └→ Solana 合约 verify 后注册 Passport
 * ```
 *
 * ## 设计要点
 *
 * 1. **权威所有权保留在 Arc L1**：`.soul` 域名是 Arc 链上的 ERC-721，用 USDC 注册，
 *    不存在"迁移"问题；Solana 侧只是继承该身份。
 * 2. **Solana 地址写入 Arc 解析器**：通过 `Resolver.setAddr(tokenId, 501, pubkey)`（SLIP-44
 *   coinType 501 = SOL），由域名持有者在 Arc 链上签名完成。
 * 3. **网关只读鉴权**：本适配器仅做 `eth_call` 只读查询，**永不持有私钥**，
 *    符合"零密钥泄漏"红线。
 * 4. **结果缓存**：链上读取的归属关系带 TTL 缓存，降低 RPC 压力。
 */

import { SoulDomainResolver, SoulDidRecord } from './resolver';
import { keccak_256 } from '@noble/hashes/sha3';

/** SLIP-44 coin type：501 = Solana */
export const SLIP44_SOLANA = 501;
/** SLIP-44 coin type：60 = ETH / Arc */
export const SLIP44_EVM = 60;

/** Arc L1 网络配置 */
export interface AfcBridgeConfig {
  /** 链 ID（testnet 5042002 / mainnet 5042） */
  chainId: number;
  /** Arc L1 JSON-RPC 端点 */
  rpcUrl: string;
  /** ArcNameRegistry 合约地址（ERC-721 所有权唯一事实源） */
  registryAddress: string;
  /** ArcNameResolver 合约地址（多链地址记录） */
  resolverAddress: string;
  /** 解析结果缓存 TTL（毫秒） */
  cacheTtlMs: number;
}

/** 从环境变量解析 Arc 桥接配置 */
export function getAfcBridgeConfig(): AfcBridgeConfig {
  return {
    chainId: Number(process.env.AFC_CHAIN_ID || 5042002),
    rpcUrl: process.env.AFC_RPC_URL || 'https://rpc.testnet.arc.io',
    registryAddress: process.env.AFC_REGISTRY_ADDRESS || '0x79f1DF663a4b543cEF6bB09e7A47C050eC0A7398',
    resolverAddress: process.env.AFC_RESOLVER_ADDRESS || '0xF1A286D1374969d24601C46D117DBA4Bc59b35cD',
    cacheTtlMs: Number(process.env.AFC_CACHE_TTL_MS || 60_000),
  };
}

/** Arc 链上读取到的 `.soul` 身份快照 */
export interface AfcSoulRecord {
  /** 完整域名，如 "alpha.soul" */
  fullName: string;
  /** keccak256(fullName) 作为 ERC-721 tokenId（十进制字符串） */
  tokenId: string;
  /** 域名持有者的 EVM 地址（Arc 链） */
  evmOwner: string;
  /** 绑定到该域名的 Solana 地址（若未绑定则为 null） */
  solanaAddress: string | null;
  /** 主域名 / 反向解析名（若有） */
  primaryName: string | null;
  /** 域名是否已铸造且在有效期内 */
  exists: boolean;
  /** 读取时间戳 */
  fetchedAt: number;
}

/* ------------------------------------------------------------------ */
/* keccak256 工具（AFC Registry 的 tokenId 规则）                        */
/* ------------------------------------------------------------------ */

/**
 * 计算 AFC 域名的 tokenId。
 *
 * 规则来自 `ArcNameRegistry.sol`：
 * `tokenId = uint256(keccak256(bytes(fullName)))`，fullName 必须全小写。
 *
 * 这里用纯 JS 实现 keccak256，避免为只读桥接引入额外依赖。
 */
export function computeAfcTokenId(fullName: string): string {
  const normalized = fullName.trim().toLowerCase();
  const hash = keccak_256(Buffer.from(normalized, 'utf8'));
  return BigInt('0x' + Buffer.from(hash).toString('hex')).toString();
}


/* ------------------------------------------------------------------ */
/* Arc L1 只读 RPC 客户端                                              */
/* ------------------------------------------------------------------ */

/** 函数选择器常量（从 ABI 签名计算） */
const SELECTOR_OWNER_OF = '0x6352211e'; // ownerOf(uint256)
const SELECTOR_ADDR = '0x724474cd'; // keccak256('addr(uint256,uint256)')[0:4]
const SELECTOR_NAME_OF = '0x051a2664'; // keccak256('nameOf(uint256)')[0:4]

/**
 * AFC `.soul` 双链桥接服务。
 *
 * 仅执行 `eth_call` 只读查询，不签名、不广播、不持有私钥。
 */
export class AfcSoulBridge {
  private config: AfcBridgeConfig;
  private cache: Map<string, { record: AfcSoulRecord; expiresAt: number }> = new Map();
  private soulResolver: SoulDomainResolver;

  constructor(soulResolver: SoulDomainResolver, config?: AfcBridgeConfig) {
    this.soulResolver = soulResolver;
    this.config = config || getAfcBridgeConfig();
  }

  public getConfig(): Readonly<AfcBridgeConfig> {
    return this.config;
  }

  /** 发起 eth_call 只读请求 */
  private async ethCall(to: string, data: string): Promise<string> {
    const body = {
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_call',
      params: [{ to, data }, 'latest'],
    };

    const res = await fetch(this.config.rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error(`AFC RPC HTTP ${res.status}: ${await res.text()}`);
    }

    const payload = (await res.json()) as { result?: string; error?: { message: string } };
    if (payload.error) {
      throw new Error(`AFC RPC error: ${payload.error.message}`);
    }
    return payload.result || '0x';
  }

  /**
   * 解析 `.soul` 域名在 Arc L1 上的真实归属。
   *
   * @param fullName 完整域名，如 "alpha.soul"
   * @param useCache 是否使用缓存（默认 true）
   */
  public async resolveOnArc(fullName: string, useCache = true): Promise<AfcSoulRecord> {
    const normalized = fullName.trim().toLowerCase();
    if (!normalized.endsWith('.soul')) {
      throw new Error(`Not a .soul domain: ${fullName}`);
    }

    const cached = this.cache.get(normalized);
    if (useCache && cached && cached.expiresAt > Date.now()) {
      return cached.record;
    }

    const tokenId = computeAfcTokenId(normalized);
    const tokenIdHex = BigInt(tokenId).toString(16).padStart(64, '0');

    let evmOwner = '';
    let solanaAddress: string | null = null;
    let exists = false;

    try {
      // ownerOf(uint256) —— 不存在时合约 revert，RPC 返回 error
      const ownerRaw = await this.ethCall(this.config.registryAddress, SELECTOR_OWNER_OF + tokenIdHex);
      if (ownerRaw && ownerRaw !== '0x' && ownerRaw.length >= 66) {
        evmOwner = '0x' + ownerRaw.slice(-40);
        exists = evmOwner !== '0x0000000000000000000000000000000000000000';
      }
    } catch {
      exists = false;
    }

    if (exists) {
      try {
        // addr(uint256,uint256) with coinType = 501 (Solana)
        const args = tokenIdHex + SLIP44_SOLANA.toString(16).padStart(64, '0');
        const addrRaw = await this.ethCall(this.config.resolverAddress, SELECTOR_ADDR + args);
        const bytes = decodeAbiBytes(addrRaw);
        if (bytes.length === 32) {
          // Solana 公钥为 32 字节 ed25519
          solanaAddress = base58Encode(bytes);
        }
      } catch {
        solanaAddress = null;
      }
    }

    const record: AfcSoulRecord = {
      fullName: normalized,
      tokenId,
      evmOwner,
      solanaAddress,
      primaryName: normalized,
      exists,
      fetchedAt: Date.now(),
    };

    this.cache.set(normalized, { record, expiresAt: Date.now() + this.config.cacheTtlMs });
    return record;
  }

  /**
   * 跨链鉴权：验证 `.soul`（Arc 链）→ Solana 地址的绑定关系是否成立。
   *
   * 校验通过后可为其签发 `GatewayAttestation`，用于在 Solana 合约注册 AgentPassport。
   */
  public async verifyCrossChainBinding(
    fullName: string,
    solanaAddress: string,
  ): Promise<{ ok: boolean; reason?: string; record: AfcSoulRecord }> {
    const record = await this.resolveOnArc(fullName);

    if (!record.exists) {
      return { ok: false, reason: `Domain ${fullName} is not registered on Arc L1`, record };
    }
    if (!record.solanaAddress) {
      return {
        ok: false,
        reason: `Domain ${fullName} has no Solana address bound. Call Resolver.setAddr(tokenId, 501, pubkey) on Arc L1 first.`,
        record,
      };
    }
    if (record.solanaAddress !== solanaAddress) {
      return {
        ok: false,
        reason: `Solana address mismatch: chain has ${record.solanaAddress}, request claims ${solanaAddress}`,
        record,
      };
    }
    return { ok: true, record };
  }

  /**
   * 为通过跨链校验的 `.soul` 身份签发网关凭证，并同步到本地 DID 注册表。
   *
   * 这是 Solana 侧 `AgentPassport` 注册的凭据来源。
   */
  public async attestCrossChain(
    fullName: string,
    solanaAddress: string,
    role: SoulDidRecord['role'] = 'QUANT_MAKER',
  ): Promise<{ attestation: ReturnType<SoulDomainResolver['generateAttestation']>; record: AfcSoulRecord }> {
    const check = await this.verifyCrossChainBinding(fullName, solanaAddress);
    if (!check.ok) {
      throw new Error(`Cross-chain attestation denied: ${check.reason}`);
    }

    // 同步（或刷新）本地注册表记录，使 Solana 侧验签可用
    const existing = this.soulResolver.resolve(fullName);
    if (!existing) {
      this.soulResolver.registerSoulDomain({
        soulDomain: fullName,
        solanaAddress,
        role,
        reputationScore: 1000,
        isBanned: false,
        metadataUri: `arc://${this.config.chainId}/${check.record.tokenId}`,
        registeredAt: Date.now(),
      });
    } else if (existing.solanaAddress !== solanaAddress) {
      existing.solanaAddress = solanaAddress;
      this.soulResolver.registerSoulDomain(existing);
    }

    const attestation = this.soulResolver.generateAttestation(fullName, solanaAddress);
    return { attestation, record: check.record };
  }

  /** 清理过期缓存 */
  public purgeCache(): number {
    const now = Date.now();
    let removed = 0;
    for (const [k, v] of this.cache.entries()) {
      if (v.expiresAt <= now) {
        this.cache.delete(k);
        removed++;
      }
    }
    return removed;
  }
}

/* ------------------------------------------------------------------ */
/* ABI 工具                                                            */
/* ------------------------------------------------------------------ */

/** 解码 ABI 编码的 `bytes` 返回值 */
function decodeAbiBytes(hex: string): Buffer {
  const raw = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (raw.length < 128) return Buffer.alloc(0);

  const offset = Number(BigInt('0x' + raw.slice(0, 64)));
  if (!Number.isFinite(offset) || raw.length < (offset + 32) * 2) return Buffer.alloc(0);

  const length = Number(BigInt('0x' + raw.slice(offset * 2, offset * 2 + 64)));
  if (length <= 0) return Buffer.alloc(0);

  const dataStart = (offset + 32) * 2;
  const dataEnd = dataStart + length * 2;
  if (raw.length < dataEnd) return Buffer.alloc(0);

  return Buffer.from(raw.slice(dataStart, dataEnd), 'hex');
}

/** base58 编码（Solana 公钥格式） */
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function base58Encode(buffer: Buffer): string {
  let num = BigInt('0x' + (buffer.length ? buffer.toString('hex') : '0'));
  let out = '';
  while (num > 0n) {
    const rem = Number(num % 58n);
    out = BASE58_ALPHABET[rem] + out;
    num /= 58n;
  }
  for (const byte of buffer) {
    if (byte === 0) out = '1' + out;
    else break;
  }
  return out || '1';
}
