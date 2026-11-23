/**
 * 手机确认锁 · owner Ed25519 确认密钥对生成脚本（骨架 / 可运行）
 * ============================================================
 * 用途：
 *  1) 生成一对【全新的】Ed25519 确认密钥（仅用于演练 / 首次建 key，不是真实 owner 私钥）；
 *  2) 导出与生产验签器 src/mcp/confirmation.ts::OwnerEd25519Approver 完全兼容的
 *     SPKI-DER base64 公钥，供填写环境变量 CONFIRM_OWNER_PUBKEY；
 *  3) 演示如何用确认私钥对 challenge 签名（base64），即 gang_approve 的 signature 参数；
 *  4) 自检：用生产同款 createPublicKey + crypto.verify 路径验证签名，并验证篡改会被拒绝。
 *
 * 安全边界（必读）：
 *  - 确认私钥 ≠ 钱包私钥 ≠ Turnkey agent API key。三者互不通用。
 *  - 确认私钥只应保存在 owner 手机 / 安全元件；网关 .env 只允许出现【公钥】。
 *  - 本脚本默认只打印到 stdout；只有显式 --out 才落盘（mode 0600），且落盘目录必须由 owner 保管。
 *  - 轮换 CONFIRM_OWNER_PUBKEY 会使旧公钥签发的 pending 意图全部验签失败（fail-closed，符合预期）。
 *
 * 运行：
 *   npx tsx scripts/setup_owner_confirm_key.ts                 # 生成并打印 + 自检（不写文件）
 *   npx tsx scripts/setup_owner_confirm_key.ts --out <目录>     # 额外落盘 owner_confirm.json (0600)
 *
 * 依赖：仅 node:crypto（仓库已装 tsx；无新增依赖）。
 */

import {
  generateKeyPairSync,
  createPrivateKey,
  createPublicKey,
  sign as cryptoSign,
  verify as cryptoVerify,
  type KeyObject,
} from 'node:crypto';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

/* ============================================================
 * 1) 数据结构与生成
 * ========================================================== */

export interface OwnerConfirmKeyMaterial {
  /** 填 CONFIRM_OWNER_PUBKEY：SPKI DER 的 base64（约 60 字符，以 MCowBQYDK2VwAyEA... 开头） */
  publicKeySpkiBase64: string;
  /** 仅 owner 手机侧保管：PKCS#8 DER 的 base64（约 64 字符） */
  privateKeyPkcs8Base64: string;
}

/**
 * 生成全新 Ed25519 确认密钥对。
 * 与 OwnerEd25519Approver 的兼容点：构造函数用 createPublicKey({format:'der', type:'spki'})，
 * 因此公钥必须导出为 SPKI DER；PEM 字符串不能直接用。
 */
export function generateOwnerConfirmKeyPair(): OwnerConfirmKeyMaterial {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    publicKeySpkiBase64: publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
    privateKeyPkcs8Base64: privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64'),
  };
}

/* ============================================================
 * 2) 签名 / 验签（生产同款路径）
 * ========================================================== */

function privateKeyFromBase64(pkcs8Base64: string): KeyObject {
  return createPrivateKey({ key: Buffer.from(pkcs8Base64, 'base64'), format: 'der', type: 'pkcs8' });
}

function publicKeyFromSpkiBase64(spkiBase64: string): KeyObject {
  return createPublicKey({ key: Buffer.from(spkiBase64, 'base64'), format: 'der', type: 'spki' });
}

/**
 * owner 手机侧：对 challenge = `${previewHash}|${requestId}|${expiresAt}` 签名。
 * 返回值即 gang_approve / POST /v1/confirm/approve 的 signature 参数（base64）。
 * 注意：Ed25519 用 null 作为 algorithm，且签的是 UTF-8 字节串。
 */
export function signChallenge(privateKeyPkcs8Base64: string, challenge: string): string {
  const sig = cryptoSign(null, Buffer.from(challenge, 'utf8'), privateKeyFromBase64(privateKeyPkcs8Base64));
  return sig.toString('base64');
}

/**
 * 自检：与 OwnerEd25519Approver.verify() 逐字等价的验签实现。
 */
export function verifyWithApproverFormat(publicKeySpkiBase64: string, challenge: string, signatureB64: string): boolean {
  try {
    return cryptoVerify(
      null as any,
      Buffer.from(challenge, 'utf8'),
      publicKeyFromSpkiBase64(publicKeySpkiBase64),
      Buffer.from(signatureB64, 'base64'),
    );
  } catch {
    return false;
  }
}

/* ============================================================
 * 3) CLI
 * ========================================================== */

function main() {
  const args = process.argv.slice(2);
  let outDir = '';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--out' && args[i + 1]) {
      outDir = resolve(args[++i]);
    }
  }

  const mat = generateOwnerConfirmKeyPair();

  // 自检：正常签名应通过，篡改 challenge 应被拒（对齐 confirmation.ts 的 fail-closed 语义）
  const demoChallenge = 'deadbeef...|req_demo_1|1799999999999';
  const demoSig = signChallenge(mat.privateKeyPkcs8Base64, demoChallenge);
  const ok = verifyWithApproverFormat(mat.publicKeySpkiBase64, demoChallenge, demoSig);
  const tamperRejected = !verifyWithApproverFormat(mat.publicKeySpkiBase64, demoChallenge + 'x', demoSig);

  const lines: string[] = [];
  lines.push('=== 手机确认锁 owner 密钥（全新生成，仅用于演练 / 首次建 key）===');
  lines.push('');
  lines.push('# 1) 把这一行填进网关 .env（网关侧【只】存公钥）：');
  lines.push(`CONFIRM_OWNER_PUBKEY=${mat.publicKeySpkiBase64}`);
  lines.push('');
  lines.push('# 2) 把下面这个私钥安全交付到 owner 手机（绝不进网关、绝不进 git）：');
  lines.push(`privateKeyPkcs8Base64=${mat.privateKeyPkcs8Base64}`);
  lines.push('');
  lines.push('# 3) 手机侧签名示例（challenge 原样取自 gang_transfer_sol 返回值）：');
  lines.push(`const sig = crypto.sign(null, Buffer.from(challenge, 'utf8'),`);
  lines.push(`  crypto.createPrivateKey({ key: Buffer.from(privateKeyPkcs8Base64, 'base64'), format: 'der', type: 'pkcs8' })`);
  lines.push(`).toString('base64'); // -> gang_approve 的 signature`);
  lines.push('');
  lines.push(`[自检] 正常签名验签通过=${ok}；篡改 challenge 被拒=${tamperRejected}`);
  lines.push('[提示] buildConfirmation() 只在服务构造时读取 CONFIRM_OWNER_PUBKEY，改完必须重启网关。');
  lines.push('[警告] 私钥一旦打印即视为已暴露；若用于真实资金，请用硬件/手机端生成并永不外导。');

  if (outDir) {
    mkdirSync(outDir, { recursive: true, mode: 0o700 });
    const outFile = join(outDir, 'owner_confirm.json');
    writeFileSync(
      outFile,
      JSON.stringify(
        {
          warning: 'OWNER CONFIRMATION KEY - privateKeyPkcs8Base64 must NEVER be placed on the gateway host',
          ...mat,
          createdAt: new Date().toISOString(),
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
    lines.push(`[落盘] ${outFile} (mode 0600)`);
  }

  // 自检失败时不静默： fail-closed 思路一致，直接抛错。
  if (!ok || !tamperRejected) {
    throw new Error('自检失败：签名/验签路径与 OwnerEd25519Approver 不兼容，禁止使用本密钥');
  }
  process.stdout.write(lines.join('\n') + '\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
