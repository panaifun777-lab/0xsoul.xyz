/**
 * Thought Hash 买方 Attestation（支付即证明的闭环凭证）
 *
 * ## 解决的问题
 *
 * x402 付费后，买方拿到的是「信号 + 结算回执」。但回执里的字段都是买方自己也能
 * 拼出来的字符串，无法证明「这条 thoughtHash 确实由网关针对这笔付款签发」。
 * Attestation 用一个**网关承诺哈希**把以下字段不可抵赖地绑在一起：
 *
 *   thoughtHash | paymentNonce | txSignature | payer | recipientVault
 *   | amountSol | amountToken | tokenSymbol | settledAt | SALT
 *
 * 买方只需用公开的 SALT 重算同一段规范化字符串的 sha256，比对 attestationHash
 * 即可独立验证：网关确实为该笔付款背书了这条 thoughtHash。
 *
 * ## 安全说明（v1）
 *
 * 这里用「公开盐 + sha256」做确定性承诺，可防篡改、可独立复算，但**不是**
 * 网关私钥签名。若需抗伪造（第三方无法伪造任意网关 attestation），v2 应改用
 * 网关密钥对（ed25519）对规范化串做 `sign()`。本模块仅负责承诺生成与校验。
 */

import { createHash } from 'crypto';
import type { SettlementReceipt } from './middleware';

/** 公开盐：作为命名空间防止跨场景哈希碰撞，非机密值 */
export const DEFAULT_ATTESTATION_SALT = '0xsoul.public.attestation.salt.v1';

export interface PaymentAttestation {
  thoughtHash: string;
  paymentNonce: string;
  txSignature: string;
  payer: string;
  recipientVault: string;
  amountSol: number;
  amountToken?: number;
  tokenSymbol?: string;
  settledAt: number;
  /** 网关对上述事实的承诺哈希 */
  attestationHash: string;
}

/** 把回执字段规范化为一段稳定字符串（字段顺序固定） */
function canonicalize(
  receipt: Pick<
    SettlementReceipt,
    | 'thoughtHash'
    | 'paymentNonce'
    | 'txSignature'
    | 'payer'
    | 'amountSol'
    | 'amountToken'
    | 'tokenSymbol'
    | 'settledAt'
  >,
  recipientVault: string,
): string {
  return [
    receipt.thoughtHash || '',
    receipt.paymentNonce,
    receipt.txSignature,
    receipt.payer,
    recipientVault,
    String(receipt.amountSol),
    String(receipt.amountToken ?? ''),
    String(receipt.tokenSymbol ?? ''),
    String(receipt.settledAt),
  ].join('|');
}

/** 生成针对一笔结算回执的买方 attestation */
export function buildAttestation(
  receipt: SettlementReceipt,
  recipientVault: string,
  salt: string = DEFAULT_ATTESTATION_SALT,
): PaymentAttestation {
  const canonical = canonicalize(receipt, recipientVault);
  const attestationHash =
    '0x' + createHash('sha256').update(canonical + '|' + salt).digest('hex');
  return {
    thoughtHash: receipt.thoughtHash || '',
    paymentNonce: receipt.paymentNonce,
    txSignature: receipt.txSignature,
    payer: receipt.payer,
    recipientVault,
    amountSol: receipt.amountSol,
    amountToken: receipt.amountToken,
    tokenSymbol: receipt.tokenSymbol,
    settledAt: receipt.settledAt,
    attestationHash,
  };
}

/** 独立校验 attestation（买方侧可调用，无需信任网关） */
export function verifyAttestation(
  att: PaymentAttestation,
  salt: string = DEFAULT_ATTESTATION_SALT,
): boolean {
  const canonical = canonicalize(
    {
      thoughtHash: att.thoughtHash,
      paymentNonce: att.paymentNonce,
      txSignature: att.txSignature,
      payer: att.payer,
      amountSol: att.amountSol,
      amountToken: att.amountToken,
      tokenSymbol: att.tokenSymbol,
      settledAt: att.settledAt,
    },
    att.recipientVault,
  );
  const expected =
    '0x' + createHash('sha256').update(canonical + '|' + salt).digest('hex');
  return expected === att.attestationHash;
}
