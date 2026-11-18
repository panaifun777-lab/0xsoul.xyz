# Step 1 开户脚本执行清单（Agent 钱包服务 · 设计稿 2026-11-18）

本目录两个骨架脚本对应设计稿第 4 页「开钱包五步」与 Step 1（只读钱包）：

| 脚本 | 对应步骤 | 作用 |
|---|---|---|
| `setup_turnkey_wallet.ts` | 建交易钱包 / 发 key | HSM 内创建每只 agent 一只 devnet 交易钱包 + 签名策略（allowlist/限额） |
| `setup_squads_treasury.ts` | 建金库 / 设规矩 | 创建 Squads v4 多签金库 + 支出限额（仅金库→交易钱包转账）+ 阈值/时间锁 |

两个脚本都支持 `--dry-run`（默认，不花费用、不调外部 API）与 `--execute`（真正开户）。
**先 dry-run 看计划，确认无误再 `--execute`。**

---

## 一、需要你提供的账号 / 密钥（填进环境变量）

### Turnkey（交易钱包）
- `TURNKEY_API_PUBLIC_KEY` — API public key（**不是钱包私钥**）
- `TURNKEY_API_PRIVATE_KEY` — API private key（stamper 用）
- `TURNKEY_ORGANIZATION_ID` — 组织 ID
- 执行前安装：`npm i @turnkey/http @turnkey/api-key-stamper`

### Squads（多签金库）
- `SQUADS_OWNER_KEYPAIR_PATH` — owner（手机 Voter）keypair 文件路径；冷备密钥另存
- `SQUADS_CREATE_KEY` — 多签 create key（用真实公钥；dry-run 可用占位符）
- `SQUADS_MEMBERS` — 成员 CSV（格式 `地址:角色:名称;...`，角色 FOUNDER/CORE_AGENT/AUDITOR/COMMUNITY_REP）
- 执行前安装：`npm i @sqds/multisig`

### Solana / 网络
- `SOLANA_RPC_URL`（可选，默认 devnet）
- devnet faucet SOL（给金库/钱包注资）
- `SQUADS_DESTINATION_WALLET` — 由 Turnkey 脚本产出的交易钱包地址（建金库时填）

---

## 二、需要你拍板的参数（设计稿 N1/N2/N3 + P0 三件）

| 编号 | 事项 | 默认值 / 选项 |
|---|---|---|
| N1 | 试点范围 | 自用先行（推荐）/ 对外 |
| N2 | 确认阈值 | 沿用 0.10 / 0.50 / 1.00 SOL、3 分钟 / 免确认线改 0 全确认 |
| N3 | 发币门时点 | 参数表六处全定才开（推荐）/ 先开 85 SOL 窄门 |
| P0-1 | 金库阈值与时间锁 | 默认 2-of-3、24h；按链上字节码核验结果定稿 |
| P0-2 | 工具 allowlist / mint allowlist | 默认 Jupiter/System/ComputeBudget/SPL/Token-2022/ATA；mint 待填 |
| P0-3 | 限额最终数字 | 单笔 ≤1.5、日累计 15 SOL（脚本默认），待定稿 |

> 重要：这些数字在拍板前都是**测试夹具/提案值**，不是决定。脚本按默认值生成计划，你可在环境变量覆盖。

---

## 三、执行顺序（严格按设计稿，不跳步）

1. **拍板**第二节所有参数；准备第一节所有账号/密钥
2. `npx tsx scripts/setup_turnkey_wallet.ts` —— 先看 dry-run 计划，确认策略 allowlist
3. `npx tsx scripts/setup_turnkey_wallet.ts --execute` —— 真正建交易钱包，保存回执里的地址
4. 用回执地址设置 `SQUADS_DESTINATION_WALLET`
5. `npx tsx scripts/setup_squads_treasury.ts` —— 看金库计划（PDA/阈值/时间锁/支出限额）
6. `npx tsx scripts/setup_squads_treasury.ts --execute` —— 真正建金库 + 支出限额
7. **页面注资**：faucet SOL 转入交易钱包，页面须明示「注资额即最大可亏额」
8. **发 key**：为每个 agent 客户端生成 MCP API key（存哈希、只显示一次、可吊销）—— 此项服务尚未实现，属 Step 1 后续工程
9. **连接测试**：标准 MCP 客户端只调只读工具查一次余额，查对才算开通（MCP 握手已验收通过）
10. **网关接入**：把钱包地址/金库 PDA 配进网关，签名只走「批准令牌 → SIGN_TRANSACTION」

---

## 四、验收标准（不过不进下一步）

- 四个标准客户端各连通一次并留记录（已通过协议级测试）
- key 吊销后只读立即失效（待 API key 服务实现）
- agent 无任何签名路径；无批准令牌调签名接口被拒并留痕（待签名端接入）
- 金库支出限额只对「金库→交易钱包」转账生效，不覆盖 swap（P0-5 边界）
- 限额重启不丢（当前 `PolicyEnforcedSandbox` 为内存态，Step 1 工程需持久化）

---

## 五、安全铁律（脚本已内建）

- 私钥在 HSM/Enclave 内生成，**不导出、不落库、不进日志**
- 网关仅可 `SIGN_TRANSACTION`；无批准令牌不得签名
- agent 永不自建钱包、永不持私钥；拿到的只是可吊销 API key
- 支出限额只管金库→交易钱包转账；swap 一律走交易钱包

> 提示：两个脚本的 TODO 适配器是刻意留白——真正的 SDK 调用签名依赖你选定的 Turnkey/Squads 版本，
> 等账号与 SDK 就绪后按 TODO 填入即可执行；dry-run 部分现在就能跑，用于核对配置与计划。
