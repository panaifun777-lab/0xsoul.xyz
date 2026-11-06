import { PublicKey, Keypair } from '@solana/web3.js';
import nacl from 'tweetnacl';
import bs58 from 'bs58';

export interface SoulDidRecord {
  soulDomain: string; // 例如 "alpha-hunter.soul"
  solanaAddress: string;
  role: 'MOMENTUM_SNIPER' | 'QUANT_MAKER' | 'SECURITY_SNIFFER' | 'TREASURY_VAULT';
  reputationScore: number; // 0 ~ 10,000 (SRS: Soul Reputation Score)
  isBanned: boolean;
  metadataUri: string;
  registeredAt: number;
}

export interface GatewayAttestation {
  soulDomain: string;
  solanaPubkey: string;
  nonce: number;
  expiry: number;
  signature: string; // Ed25519 签名 (base58)
  gatewayPubkey: string;
}

/**
 * .soul 分布式域名与 DID 注册解析器
 */
export class SoulDomainResolver {
  private registry: Map<string, SoulDidRecord> = new Map();
  private gatewayKeypair: Keypair;

  constructor(gatewayKeypair?: Keypair) {
    this.gatewayKeypair = gatewayKeypair || Keypair.generate();
  }

  public getGatewayPublicKey(): PublicKey {
    return this.gatewayKeypair.publicKey;
  }

  /**
   * 注册或更新 .soul DID 记录
   */
  public registerSoulDomain(record: SoulDidRecord): void {
    if (!record.soulDomain.endsWith('.soul')) {
      throw new Error(`Invalid domain format: ${record.soulDomain}, must end with .soul`);
    }
    this.registry.set(record.soulDomain.toLowerCase(), { ...record });
  }

  /**
   * 解析 .soul 域名
   */
  public resolve(soulDomain: string): SoulDidRecord | null {
    return this.registry.get(soulDomain.toLowerCase()) || null;
  }

  /**
   * 根据 Solana 钱包公钥反向解析绑定的 .soul 身份
   */
  public reverseResolve(solanaAddress: string): SoulDidRecord | null {
    for (const record of this.registry.values()) {
      if (record.solanaAddress === solanaAddress) {
        return record;
      }
    }
    return null;
  }

  /**
   * 生成权威网关签名凭证 (Attestation)，供 Agent 向 Solana 合约注册 AgentPassport
   */
  public generateAttestation(soulDomain: string, solanaAddress: string, ttlSeconds = 300): GatewayAttestation {
    const record = this.resolve(soulDomain);
    if (!record) {
      throw new Error(`Domain ${soulDomain} is not registered in .soul registry`);
    }
    if (record.solanaAddress !== solanaAddress) {
      throw new Error(`Address mismatch: ${solanaAddress} does not own ${soulDomain}`);
    }
    if (record.isBanned) {
      throw new Error(`Domain ${soulDomain} is currently banned (SRS reputation score 0)`);
    }

    const nonce = Math.floor(Math.random() * 1000000);
    const expiry = Math.floor(Date.now() / 1000) + ttlSeconds;

    // 组装待签名消息: [domain_bytes] + [pubkey_bytes] + [nonce_le] + [expiry_le]
    const domainBuf = Buffer.from(soulDomain);
    const pubkeyBuf = new PublicKey(solanaAddress).toBuffer();
    const nonceBuf = Buffer.alloc(8);
    nonceBuf.writeBigUInt64LE(BigInt(nonce));
    const expiryBuf = Buffer.alloc(8);
    expiryBuf.writeBigUInt64LE(BigInt(expiry));

    const message = Buffer.concat([domainBuf, pubkeyBuf, nonceBuf, expiryBuf]);
    const sigBytes = nacl.sign.detached(message, this.gatewayKeypair.secretKey);
    const signature = bs58.encode(sigBytes);

    return {
      soulDomain,
      solanaPubkey: solanaAddress,
      nonce,
      expiry,
      signature,
      gatewayPubkey: this.gatewayKeypair.publicKey.toBase58(),
    };
  }

  /**
   * 校验凭证签名
   */
  public verifyAttestation(attestation: GatewayAttestation): boolean {
    const now = Math.floor(Date.now() / 1000);
    if (now > attestation.expiry) {
      return false; // 已过期
    }

    const domainBuf = Buffer.from(attestation.soulDomain);
    const pubkeyBuf = new PublicKey(attestation.solanaPubkey).toBuffer();
    const nonceBuf = Buffer.alloc(8);
    nonceBuf.writeBigUInt64LE(BigInt(attestation.nonce));
    const expiryBuf = Buffer.alloc(8);
    expiryBuf.writeBigUInt64LE(BigInt(attestation.expiry));

    const message = Buffer.concat([domainBuf, pubkeyBuf, nonceBuf, expiryBuf]);
    const sigBytes = bs58.decode(attestation.signature);
    const gwPubkeyBytes = new PublicKey(attestation.gatewayPubkey).toBuffer();

    return nacl.sign.detached.verify(message, sigBytes, gwPubkeyBytes);
  }

  /**
   * 动态更新 SRS 信用分与权限阶梯
   */
  public updateReputation(soulDomain: string, deltaScore: number): SoulDidRecord {
    const record = this.resolve(soulDomain);
    if (!record) {
      throw new Error(`Domain not found: ${soulDomain}`);
    }

    record.reputationScore = Math.max(0, Math.min(10000, record.reputationScore + deltaScore));
    if (record.reputationScore === 0) {
      record.isBanned = true;
    } else {
      record.isBanned = false;
    }

    this.registry.set(soulDomain.toLowerCase(), record);
    return record;
  }
}
