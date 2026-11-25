# Jupiter 真实买币切主网执行清单（已实测，待 owner 授权）

> 状态：**第 2 步已执行（ALLOW 策略已加），其余阻塞待 owner 处理**。
> 实测日期：2026-11-24。所有命令在 VPS `/opt/0xsoul` 与 tk CLI `0xsoul-user`/`0xsoul-agent` profile 下验证。

## 执行进度（2026-11-24）

- [x] 新 ALLOW 策略已创建：`jupiter-swap-backstop-v1`，policyId `c42500a9-bfed-49d3-95de-03e31c62cb62`。
      条件与 consensus 见第 1 节；已验证能匹配真实 mainnet swap（pending）。
      加策略后线上 `gang_preview` 仍 `executionMode:mock / liveSwap:false`，现有 devnet 行为不变。
- [ ] 阻塞 1：owner 向 `AGENT_WALLET_ADDRESS` 转 0.02–0.05 SOL mainnet（当前余额 0）。
- [ ] 阻塞 2/3：改 compose + .env、重建容器、owner 手机确认准备。

## 0. 硬性阻塞（执行前必须解决）

1. **Turnkey 钱包 mainnet 余额 = 0 lamports**（devnet = 489,995,000 = 0.49 SOL）。
   切主网后无法支付 gas，任何 swap 都会在广播阶段失败。
   → 需 owner 向 `AGENT_WALLET_ADDRESS` 转入小额 mainnet SOL（建议 0.02–0.05 SOL 起，覆盖 gas + 一笔测试交易）。
2. **docker-compose.yml 硬编码 `SOLANA_NETWORK=devnet`**（第 31 行 environment），
   改 `.env` 不生效。`.env` 里还有两条冲突的 `SOLANA_NETWORK`（第 12 行 devnet、第 71 行 mainnet），
   必须一并清理，否则读取顺序不确定。
3. **owner 手机确认私钥**：确认锁 `CONFIRM_OWNER_PUBKEY` 已配（compose 第 25 行），
   但对应的 owner 签名私钥必须在 owner 手机上，网关不持有。真实买币属 STRONG 档（金额≥阈值），
   需 `secondFactor` 二次复核。

## 1. 已验证可行的部分（不需要再试）

- `buildJupiterSwap()` 在 `JUPITER_SWAP_ENABLED=1 + SOLANA_NETWORK=mainnet` 干跑成功：
  minOut=68220，顶层程序 = ComputeBudget / ATA / System / SPL Token / Jupiter v6，全部落在白名单内。
- Turnkey 策略条件（**实测 pending，可匹配真实 swap**）：
  ```
  wallet.id == '<WALLET_ID>' &&
  solana.tx.program_keys.all(p, p in [
    '11111111111111111111111111111111',
    '<SPL_TOKEN_PROGRAM>',
    '<TOKEN_2022_PROGRAM>',
    '<ASSOCIATED_TOKEN_PROGRAM>',
    'ComputeBudget111111111111111111111111111111',
    '<JUPITER_V6_PROGRAM>'
  ]) &&
  solana.tx.spl_transfers.count() == 0
  ```
  consensus: `approvers.filter(user, user.id in ['<AGENT_USER_ID>', '<OWNER_USER_ID>']).count() >= 2`
  （`<...>` 占位符用脚本里已验证的真实值替换；探针策略 `jup-swap-backstop-probe` 已删除，未留存。）
- 关键：**不能**复用 `setup_spl_policy.sh` 的旧条件（含 `spl_transfers.count() > 0`），
  实测真实 Jupiter swap 的 `spl_transfers.count() == 0`，旧条件会拒绝一切真实 swap。

## 2. 执行顺序（owner 确认后逐条执行，每步验证）

1. owner 转 0.02–0.05 SOL 到 `AGENT_WALLET_ADDRESS`，用 `getBalance` 确认 > 0。
2. ~~用 tk CLI 创建上面的 ALLOW 策略~~ **已完成**：`jupiter-swap-backstop-v1`
   （policyId `c42500a9-bfed-49d3-95de-03e31c62cb62`），`policy list` 已核对。无需重复创建。
3. 改 `docker-compose.yml` 第 31 行 `SOLANA_NETWORK=devnet` → `mainnet`，
   并加 `JUPITER_SWAP_ENABLED=1`（可选 `JUPITER_QUOTE_ENABLED=1` 让价格也走真实报价）。
   同时删除 `.env` 第 12 行重复的 `SOLANA_NETWORK=devnet`（保留第 71 行 mainnet）。
4. `docker compose build gang-gateway && docker compose up -d --force-recreate gang-gateway`。
5. 验证：容器日志出现 `live swap signer ENABLED`；`gang_preview` 返回
   `executionMode: turnkey-jupiter-swap`、`priceDataSource: jupiter`、
   `preview.liveSwap` 存在且含 minOut/programs。
6. **第一笔真实买币必须小额**：`solAmount ≤ 0.005 SOL`，owner 手机批准 + secondFactor，
   观察 `/v1/confirm/status` 的 `signingActivities` 到 `BROADCASTED` 并拿到 txid，
   在 Solana Explorer 核对成交价与 minOut。确认无误后再逐步放大到 1.5 SOL 硬顶内。

## 3. 安全边界（不可越过）

- 网关永远不代批；owner 批准必须发生在 Turnkey 侧（手机/App）。
- 单笔 1.5 SOL 硬顶、1% 持仓硬顶、60s 报价 TTL、三档确认锁全部保持开启。
- Turnkey 策略只做粗粒度 backstop；目标 mint / minOut / 滑点 / 顶层程序白名单由网关层保证，
  任何一层失败都 fail-closed，绝不伪造成交。
- 本清单不含任何私钥/API key；所有密钥仍在既有 env 与 owner 设备上。
