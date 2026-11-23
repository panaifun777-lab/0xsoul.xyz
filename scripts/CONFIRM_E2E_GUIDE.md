# 手机批准端到端（E2E）操作指南

> 范围：真实 SOL 转账 `gang_transfer_sol` 从「生成确认密钥」到「链上广播」的完整链路。
> 现状为骨架说明；本指南**不含任何真实密钥**，所有密钥/地址用 `{{...}}` 占位。
> 关联源码：`src/mcp/confirmation.ts`、`src/config/confirm.ts`、`src/mcp/server.ts`、`src/chain/turnkey_signer.ts`、`src/gateway/server.ts`。

---

## 0. 先读懂：两道批准，缺一不可，互不替代

| 阶段 | 谁批准 | 凭据 | 在哪验 | 通过后发生什么 |
|---|---|---|---|---|
| ① 应用确认锁 | owner（手机）用 **Ed25519 确认私钥** 对 challenge 签名 | `CONFIRM_OWNER_PUBKEY`（只存公钥） | `ConfirmationService.approve()` → `OwnerEd25519Approver.verify()` | executor 调 `executeTransfer()`，用 **agent 凭据** 向 Turnkey 提交签名申请，activity 进入 pending |
| ② Turnkey owner 投票 | owner 在 Turnkey（root profile / Turnkey App）批准 activity | owner 的 Turnkey 用户凭据（**网关永不持有**） | Turnkey HSM 策略 | HSM 出签名 → `finalizeTransfer()` 轮询取签名 → `sendRawTransaction()` 广播 |

**关键区分（务必牢记）：**
- 确认私钥 ≠ 钱包私钥 ≠ Turnkey agent API key。三者不通。
- 第一道批准通过 **不会** 让 Turnkey 自动放行；第二道批准 **也不会** 绕过应用确认锁。
- `challenge = ${previewHash}|${requestId}|${expiresAt}`，其中 `previewHash = sha256(JSON.stringify(canonical preview))`（字段：agentIndex / estimatedPriceSol / isBuy / mint / note / slippagePct / solAmount / tokenAmount）。预览任一字段被改 → 哈希变 → 验签失败 → REJECTED。
- fail-closed：未配 `CONFIRM_OWNER_PUBKEY` → 所有需确认交易直接拒绝；超时（沉默）＝拒绝；STRONG 档缺 secondFactor → 拒绝；Turnkey activity 被拒/超时 → 不广播。

---

## 1. 前置 env

```bash
# 应用确认锁（网关侧只放公钥，来源见步骤 2）
CONFIRM_OWNER_PUBKEY={{CONFIRM_OWNER_PUBKEY_B64}}   # SPKI DER base64

# Turnkey 真实签名
TURNKEY_LIVE_SIGN=1
TURNKEY_ORGANIZATION_ID={{TURNKEY_ORGANIZATION_ID}}
TURNKEY_AGENT_API_PUBLIC_KEY={{TURNKEY_AGENT_API_PUBLIC_KEY}}
TURNKEY_AGENT_API_PRIVATE_KEY={{TURNKEY_AGENT_API_PRIVATE_KEY}}
AGENT_WALLET_ADDRESS={{AGENT_WALLET_ADDRESS}}
AGENT_WALLET_ID={{AGENT_WALLET_ID}}
SOLANA_RPC_URL=https://api.devnet.solana.com
TURNKEY_TK_BIN=/usr/local/bin/tk        # 可选，默认此值
TURNKEY_APPROVAL_TIMEOUT_MS=120000      # 可选
```

注意事项：
- `buildConfirmation()` 在**服务构造时**读取 `CONFIRM_OWNER_PUBKEY`，改完必须**重启网关**才生效。
- `gang_transfer_sol` 当 `TURNKEY_LIVE_SIGN != 1` 或 agent key 未配时返回 `LIVE_SIGN_DISABLED`，不会伪造成交。
- devnet（`SOLANA_NETWORK=devnet`）会把免确认线归零；`transfer` 默认在 `CONFIRM_FORCED_STRONG` 中 → **tier = STRONG → `gang_approve` 必须带 `secondFactor`**。演练若想跳过二次复核，可临时设 `CONFIRM_FORCED_STRONG=sell,graduate,config`（仅演练，生产不建议）。

下文用 `{{GATEWAY_BASE_URL}}` 表示网关地址（默认 `http://127.0.0.1:3000`）。

---

## 2. 生成 owner 确认密钥对并配 env

```bash
npx tsx scripts/setup_owner_confirm_key.ts                  # 打印公钥 + 私钥(base64) + 自检
npx tsx scripts/setup_owner_confirm_key.ts --out <安全目录>  # 额外落盘 owner_confirm.json (0600)
```

- 把输出中 `CONFIRM_OWNER_PUBKEY=...`（SPKI-DER base64，约 60 字符）填入网关 `.env`。
- 私钥 `privateKeyPkcs8Base64` 只交付 owner 手机，**绝不进网关 .env、绝不进 git**。
- 脚本内置自检：签名验签通过 + 篡改 challenge 被拒；任一失败即抛错（与生产 fail-closed 一致）。

---

## 3. 调 `gang_transfer_sol` 拿 challenge

走托管 MCP HTTP JSON-RPC 端点 `POST /v1/mcp`：

```bash
curl -s {{GATEWAY_BASE_URL}}/v1/mcp -H 'content-type: application/json' -d '{
  "jsonrpc":"2.0","id":1,"method":"tools/call",
  "params":{"name":"gang_transfer_sol","arguments":{
    "to":"{{SOLANA_TEST_TO}}","amountSol":0.01,"note":"confirm e2e demo"
  }}
}'
```

响应（注意 `tools/call` 把工具结果包在 `result.content[0].text` 的 **JSON 字符串**里，需二次 parse）：

```json
{
  "status":"PENDING_CONFIRMATION",
  "requestId":"{{REQUEST_ID}}",
  "tier":"STRONG",
  "previewHash":"{{PREVIEW_HASH}}",
  "challenge":"{{PREVIEW_HASH}}|{{REQUEST_ID}}|{{EXPIRES_AT}}",
  "expiresAt":{{EXPIRES_AT}},
  "to":"{{SOLANA_TEST_TO}}","amountSol":0.01,
  "instruction":"真实 SOL 转账：用手机确认私钥对 challenge 签名并调用 gang_approve..."
}
```

也可走 stdio MCP 客户端直接 `tools/call`，字段相同。若返回 `LIVE_SIGN_DISABLED` 请回到步骤 1 检查 env。

---

## 4. 用确认私钥对 challenge 签名

手机侧用步骤 2 的 `privateKeyPkcs8Base64`，对**步骤 3 原样返回的 challenge 字符串**签名：

```bash
node -e '
const c = require("crypto");
const pk = c.createPrivateKey({
  key: Buffer.from("{{PRIVATE_KEY_PKCS8_B64}}", "base64"),
  format: "der", type: "pkcs8",
});
const challenge = "{{CHALLENGE_FROM_STEP3}}";
const signature = c.sign(null, Buffer.from(challenge, "utf8"), pk).toString("base64");
console.log(signature);
'
# => {{SIGNATURE_B64}}
```

- Ed25519 的 `algorithm` 传 `null`，签 UTF-8 字节串，输出 base64。
- 脚本 `setup_owner_confirm_key.ts` 导出了 `signChallenge()` / `verifyWithApproverFormat()` 可直接复用；生产验签器用的就是 `createPublicKey(spki) + crypto.verify(null, ...)`，路径已实测一致。
- 超时或 challenge 被改动 → 验签失败，不会成交。

---

## 5. 调 `gang_approve` 完成第一道批准

HTTP 审批面（与 MCP `gang_approve` 同一执行路径，见 `src/gateway/server.ts` 的 `/v1/confirm/approve`）：

```bash
curl -s {{GATEWAY_BASE_URL}}/v1/confirm/approve -H 'content-type: application/json' -d '{
  "requestId":"{{REQUEST_ID}}",
  "signature":"{{SIGNATURE_B64}}",
  "secondFactor":"{{BIOMETRIC_TOKEN}}"
}'
```

或 MCP `tools/call` 调 `gang_approve`（参数同名）。

**预期返回：`status: SUBMITTED` + `activityId` + `execution: "turnkey-hsm"`，此时 `txSignature` 为空、状态尚未 CONFIRMED。**
含义：应用确认锁已过，Turnkey 签名申请已提交，**还没上链**。`secondFactor` 缺失会返回 `PENDING` + reason（强确认档要求）。

---

## 6. 第二道批准：owner 在 Turnkey 侧批准并广播（当前需手动）

网关只持 agent 凭据，**不能代 owner 批准**。在 owner 侧（root profile / Turnkey App）批准 `{{ACTIVITY_ID}}`：

```bash
# 命令形态依 tk 版本，以 `tk activity --help` 为准；示例：
tk --profile root --message-format json activity approve --id {{ACTIVITY_ID}}
```

owner 批准后，HSM 产出签名。取签名并广播（当前 `finalizeTransfer()` 只是被导出，**网关没有自动调用**）：

```bash
npx tsx -e "
import { loadTurnkeySignConfig, finalizeTransfer } from './src/chain/turnkey_signer.ts';
const cfg = loadTurnkeySignConfig();
if (!cfg) throw new Error('检查 TURNKEY_LIVE_SIGN / agent key / wallet env');
const out = await finalizeTransfer(cfg, '{{ACTIVITY_ID}}');
console.log(out); // ok=true, status=SUBMITTED, txid=...
"
```

`finalizeTransfer()` 轮询 activity 直到出现 `signedTransaction`，再 `sendRawTransaction` 广播并返回 txid。用 `{{SOLANA_EXPLORER}}/tx/{{TXID}}` 确认上链。

---

## 7. 排查与状态

```bash
# 确认锁队列 / 审计 / 策略快照
curl -s {{GATEWAY_BASE_URL}}/v1/confirm/status -H 'content-type: application/json' -d '{}'
# MCP: gang_confirm_status（不传 requestId 返回 pending+audit+policy）

# Turnkey activity 状态
tk --profile agent --message-format json activity get --id {{ACTIVITY_ID}}
```

常见失败对照：
| 现象 | 原因 |
|---|---|
| 需确认交易直接 REJECTED | 未配/配错 `CONFIRM_OWNER_PUBKEY`（fail-closed） |
| `gang_approve` 返回 REJECTED | 签名无效、challenge 过期、预览被篡改、签名非 base64 |
| `gang_approve` 返回 PENDING 且提示二次复核 | STRONG 档缺 `secondFactor` |
| `LIVE_SIGN_DISABLED` | `TURNKEY_LIVE_SIGN!=1` 或 agent key/wallet env 不全 |
| `PENDING_OWNER` | owner 未在 `TURNKEY_APPROVAL_TIMEOUT_MS` 内批准，未广播 |
| approve 成功但无 txid | **正常**：仅提交了 activity，须完成步骤 6 才上链 |

---

## 8. 联动现状与最小改动建议（重要）

**现状：没有自动联动，owner 批准环节需手动接入。**
1. `gang_approve` 验签通过后，executor 只调 `executeTransfer()` 提交 activity（返回 `SUBMITTED` + `activityId`），**不轮询、不广播**（`src/mcp/server.ts` 的 `getExecutor()`，`src/chain/turnkey_signer.ts` 的 `executeTransfer()`）。
2. `finalizeTransfer()` 虽已实现，但 `src/gateway/server.ts` 的 `setLiveSigner()` 包装里**没有调用它**；注释明确写「owner 批准后由 owner 侧/运维调用」。
3. Turnkey owner 投票完全在外部，网关不持 owner 凭据（这是正确的安全边界，不要破坏）。
4. 后果：第一道批准后交易停在 `SUBMITTED`，必须「外部批准 + 人工 finalize」才上链。所谓「手机端到端」目前实际是「手机确认 + 外部批准 + 人工广播」三段式。

**最小改动建议（先在 devnet 演练，勿在真钱上试错）：**
1. **自动广播**：在 `src/gateway/server.ts` 的 `setLiveSigner` 中，`executeTransfer()` 返回 `SUBMITTED` 后**异步启动** `finalizeTransfer(cfg, activityId)`（带超时/去重/状态映射），txid 回填到 intent/audit。不要在 `gang_approve` 同步路径里 long-poll，避免 HTTP 超时。
2. **状态贯通**：维护 `activityId → requestId` 映射，在 `gang_confirm_status` 增加 `turnkeyStatus`（`SUBMITTED → OWNER_PENDING → BROADCAST → CONFIRMED`），让一屏可见两段批准进度。
3. **手机端两段串行**：App 用确认私钥签 challenge 后，再由 App（持 owner 凭据、不经网关）调 Turnkey owner 批准 API；网关只返回 activityId 与深链。这样两道批准在手机端闭环，网关仍不碰 owner 凭据。
4. **保持 fail-closed**：只有 Turnkey 返回 `signedTransaction` 才 `sendRawTransaction`；`REJECTED/FAILED/超时` 一律不广播并记审计。
