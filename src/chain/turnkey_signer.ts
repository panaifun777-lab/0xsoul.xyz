/**
 * Turnkey 真实签名执行器（Step 1 后半段 · 网关接真实签名）
 * ============================================================
 * 设计边界（对应《Agent 钱包服务设计稿》2026-11-18 第 3/5 页）：
 *  - 网关只持有 **agent 凭据**（受限 user），绝不持有 owner/root 凭据；
 *  - 网关用 agent key 提交 SIGN_TRANSACTION → activity 进入 pending；
 *  - **owner 批准发生在手机/外部**（Turnkey app 或 owner 服务），网关不代批；
 *  - 网关轮询 activity 至 completed，取回 HSM 签名，广播到链上；
 *  - 全程私钥不出 HSM，网关不碰私钥。
 *
 * 为什么用 tk CLI 而非 @turnkey/http SDK：
 *  实测 @turnkey/http v6.9.0 的 signTransaction 发出的 body 被 API 拒绝
 *  （"Invalid activity type / try updating SDK versions"），而 tk CLI v0.9.0
 *  用相同凭据与交易可成功提交（已端到端验证：提交→owner 批准→HSM 签名→链上确认）。
 *  故签名器通过 child_process 调用镜像内已验证的 tk musl 二进制。
 *
 * 开关：TURNKEY_LIVE_SIGN=1 才启用；否则上层保持 mock 执行，向后兼容。
 * 所需 env：
 *   TURNKEY_AGENT_API_PUBLIC_KEY / TURNKEY_AGENT_API_PRIVATE_KEY  — agent 的 P256 API key（不是钱包私钥）
 *   TURNKEY_ORGANIZATION_ID
 *   AGENT_WALLET_ADDRESS / AGENT_WALLET_ID
 *   SOLANA_RPC_URL（默认 devnet）
 *   TURNKEY_APPROVAL_TIMEOUT_MS（默认 120000）
 *   TURNKEY_POLL_INTERVAL_MS（默认 2000）
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';

const execFileAsync = promisify(execFile);

export interface TurnkeySignConfig {
  organizationId: string;
  apiPublicKey: string;
  apiPrivateKey: string;
  walletAddress: string;
  rpcUrl: string;
  approvalTimeoutMs: number;
  pollIntervalMs: number;
  tkBin: string;
}

export interface SignRequest {
  to: string;
  amountSol: number;
  note?: string;
}

export interface SignOutcome {
  ok: boolean;
  status: 'SUBMITTED' | 'PENDING_OWNER' | 'FAILED';
  txid?: string;
  activityId?: string;
  reason?: string;
}

export interface UnsignedSignRequest {
  unsignedHex: string;
  note?: string;
  requestId?: string;
  signWith?: string;
}

const num = (key: string, fallback: number) => {
  const v = Number(process.env[key]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
};

export function loadTurnkeySignConfig(): TurnkeySignConfig | null {
  const enabled = process.env.TURNKEY_LIVE_SIGN === '1';
  const org = process.env.TURNKEY_ORGANIZATION_ID || '';
  const pub = process.env.TURNKEY_AGENT_API_PUBLIC_KEY || '';
  const priv = process.env.TURNKEY_AGENT_API_PRIVATE_KEY || '';
  const addr = process.env.AGENT_WALLET_ADDRESS || '';
  if (!enabled || !org || !pub || !priv || !addr) return null;
  return {
    organizationId: org,
    apiPublicKey: pub,
    apiPrivateKey: priv,
    walletAddress: addr,
    rpcUrl: process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com',
    approvalTimeoutMs: num('TURNKEY_APPROVAL_TIMEOUT_MS', 120000),
    pollIntervalMs: num('TURNKEY_POLL_INTERVAL_MS', 2000),
    tkBin: process.env.TURNKEY_TK_BIN || '/usr/local/bin/tk',
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 构造 System Program 转账的 unsigned 交易（hex），不签名、不需要私钥。 */
export async function buildSystemTransfer(
  cfg: TurnkeySignConfig,
  req: SignRequest,
): Promise<{ hex: string; blockhash: string }> {
  const connection = new Connection(cfg.rpcUrl, 'confirmed');
  const { blockhash } = await connection.getLatestBlockhash('confirmed');
  const tx = new Transaction({
    feePayer: new PublicKey(cfg.walletAddress),
    recentBlockhash: blockhash,
  }).add(
    SystemProgram.transfer({
      fromPubkey: new PublicKey(cfg.walletAddress),
      toPubkey: new PublicKey(req.to),
      lamports: Math.round(req.amountSol * LAMPORTS_PER_SOL),
    }),
  );
  const raw = tx.serialize({ requireAllSignatures: false, verifySignatures: false });
  return { hex: raw.toString('hex'), blockhash };
}

/** 建立临时 tk profile（凭据从 env 写入临时文件，用完即删），返回 HOME 目录。 */
function setupTempProfile(cfg: TurnkeySignConfig): { home: string; keyFile: string } {
  const home = mkdtempSync(join(tmpdir(), '0xsoul-tk-'));
  const keyFile = join(home, 'agent-key.json');
  writeFileSync(keyFile, JSON.stringify({
    public_key: cfg.apiPublicKey,
    private_key: cfg.apiPrivateKey,
    curve: 'p256',
  }), { mode: 0o600 });
  return { home, keyFile };
}

/** 不要求 JSON 输出的 tk 调用（用于 profile create 等纯文本命令）。 */
async function tkRaw(cfg: TurnkeySignConfig, home: string, args: string[]): Promise<string> {
  const { stdout, stderr } = await execFileAsync(cfg.tkBin, args, {
    env: { ...process.env, HOME: home },
    maxBuffer: 4 * 1024 * 1024,
  });
  return (stdout || '') + (stderr || '');
}

async function tk(cfg: TurnkeySignConfig, home: string, args: string[]): Promise<any> {
  const text = await tkRaw(cfg, home, args);
  const lines = text.split('\n').filter((l) => l.trim().startsWith('{'));
  if (!lines.length) throw new Error('tk 无 JSON 输出: ' + text.slice(0, 200));
  return JSON.parse(lines[lines.length - 1]);
}

function errorFragment(e: any): string {
  const raw = e?.stderr || e?.body || e?.message
    || (e != null ? (typeof e === 'object' ? JSON.stringify(e) : String(e)) : 'unknown error');
  const text = (typeof raw === 'string' ? raw : JSON.stringify(raw)).trim();
  if (!text) return 'unknown error';
  try {
    const obj = JSON.parse(text);
    const parts: string[] = [];
    if (obj?.status) parts.push('HTTP ' + obj.status);
    const msg = obj?.message || obj?.detail || obj?.title
      || (typeof obj?.error === 'string' ? obj.error : '');
    if (msg) parts.push(String(msg));
    if (parts.length) return (parts.join(': ') + ' | ' + text).slice(0, 1500);
  } catch {}
  return text.slice(0, 1500);
}

/**
 * 第一步：构造交易 → tk 提交签名申请（agent 凭据）→ 返回 pending activity。
 * 网关不持有 owner 凭据，只提交，不代批。
 */
export async function executeTransfer(cfg: TurnkeySignConfig, req: SignRequest): Promise<SignOutcome> {
  const { home, keyFile } = setupTempProfile(cfg);
  try {
    await tkRaw(cfg, home, [
      'profile', 'create', '--profile-name', 'agent',
      '--organization-id', cfg.organizationId,
      '--api-key-file', keyFile, '--non-interactive',
    ]);
    const { hex } = await buildSystemTransfer(cfg, req);
    const inputFile = join(home, 'sign.json');
    writeFileSync(inputFile, JSON.stringify({
      type: 'TRANSACTION_TYPE_SOLANA',
      signWith: cfg.walletAddress,
      unsignedTransaction: hex,
    }));
    const res = await tk(cfg, home, [
      '--profile', 'agent', '--message-format', 'json',
      'sign', 'transaction', '--input-file', inputFile,
    ]);
    const activity = res?.data?.activity || res?.activity;
    const activityId = activity?.id || '';
    if (!activityId) {
      return { ok: false, status: 'FAILED', reason: res?.message || 'no activity id' };
    }
    return {
      ok: true,
      status: 'SUBMITTED',
      activityId,
      reason: '已提交 Turnkey，待 owner 在手机/Turnkey App 批准（activity ' + activityId + '）',
    };
  } catch (e: any) {
    return { ok: false, status: 'FAILED', reason: e?.stderr || e?.message || String(e) };
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

async function waitAndBroadcast(
  cfg: TurnkeySignConfig,
  home: string,
  activityId: string,
): Promise<SignOutcome> {
  const deadline = Date.now() + cfg.approvalTimeoutMs;
  let signedHex = '';
  while (Date.now() < deadline) {
    const res = await tk(cfg, home, [
      '--profile', 'agent', '--message-format', 'json',
      'activity', 'get', '--id', activityId,
    ]);
    const activity = res?.data?.activity || res?.activity;
    const status = activity?.status || '';
    if (activity?.result?.signTransactionResult?.signedTransaction) {
      signedHex = activity.result.signTransactionResult.signedTransaction;
      break;
    }
    if (status.includes('REJECTED') || status.includes('FAILED')) {
      return { ok: false, status: 'FAILED', activityId, reason: status };
    }
    await sleep(cfg.pollIntervalMs);
  }
  if (!signedHex) {
    return { ok: false, status: 'PENDING_OWNER', activityId, reason: 'owner 未在超时内批准' };
  }
  const connection = new Connection(cfg.rpcUrl, 'confirmed');
  const txid = await connection.sendRawTransaction(Buffer.from(signedHex, 'hex'), { skipPreflight: false });
  return { ok: true, status: 'SUBMITTED', txid, activityId };
}

export async function finalizeTransfer(cfg: TurnkeySignConfig, activityId: string): Promise<SignOutcome> {
  const { home, keyFile } = setupTempProfile(cfg);
  try {
    await tkRaw(cfg, home, [
      'profile', 'create', '--profile-name', 'agent',
      '--organization-id', cfg.organizationId,
      '--api-key-file', keyFile, '--non-interactive',
    ]);
    return await waitAndBroadcast(cfg, home, activityId);
  } catch (e: any) {
    return { ok: false, status: 'FAILED', activityId, reason: e?.stderr || e?.message || String(e) };
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

export async function executeUnsignedTransaction(
  cfg: TurnkeySignConfig,
  req: UnsignedSignRequest,
): Promise<{ ok: boolean; status: string; activityId?: string; reason?: string; txid?: string }> {
  const { home, keyFile } = setupTempProfile(cfg);
  try {
    await tkRaw(cfg, home, [
      'profile', 'create', '--profile-name', 'agent',
      '--organization-id', cfg.organizationId,
      '--api-key-file', keyFile, '--non-interactive',
    ]);
    const inputFile = join(home, 'sign.json');
    writeFileSync(inputFile, JSON.stringify({
      type: 'TRANSACTION_TYPE_SOLANA',
      signWith: req.signWith || cfg.walletAddress,
      unsignedTransaction: req.unsignedHex,
    }));
    const res = await tk(cfg, home, [
      '--profile', 'agent', '--message-format', 'json',
      'sign', 'transaction', '--input-file', inputFile,
    ]);
    const activity = res?.data?.activity || res?.activity;
    const activityId = activity?.id || '';
    if (!activityId) {
      return { ok: false, status: 'FAILED', reason: errorFragment(res) };
    }
    const trace = [req.note, req.requestId].filter(Boolean).join(' / ');
    return {
      ok: true,
      status: 'SUBMITTED',
      activityId,
      reason: '已提交 Turnkey，待 owner 在手机/Turnkey App 批准（activity ' + activityId + '）' + (trace ? ' · ' + trace : ''),
    };
  } catch (e: any) {
    return { ok: false, status: 'FAILED', reason: errorFragment(e) };
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

export async function finalizeUnsignedTransaction(
  cfg: TurnkeySignConfig,
  activityId: string,
): Promise<{ ok: boolean; status: string; txid?: string; reason?: string }> {
  const { home, keyFile } = setupTempProfile(cfg);
  try {
    await tkRaw(cfg, home, [
      'profile', 'create', '--profile-name', 'agent',
      '--organization-id', cfg.organizationId,
      '--api-key-file', keyFile, '--non-interactive',
    ]);
    const r = await waitAndBroadcast(cfg, home, activityId);
    return { ok: r.ok, status: r.status, txid: r.txid, reason: r.reason };
  } catch (e: any) {
    return { ok: false, status: 'FAILED', reason: errorFragment(e) };
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}
