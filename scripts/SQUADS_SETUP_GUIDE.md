# Squads v4 金库开户指南（骨架 · devnet 先行）

对应脚本：`scripts/setup_squads_treasury.ts`（PDA 推导复用 `scripts/init_squads_treasury.ts`）。
本指南只描述**骨架如何执行**；当前未执行任何链上交易、未填任何真实地址/密钥。

> 安全基线：金库只做「金库 → Turnkey 交易钱包」的**转账补充**；**swap 一律走交易钱包**。
> 支出限额（spending limit）在 Squads 官方文档中的语义是「向指定目标地址转出指定 mint / 定额 / 周期」，
> 不是任意指令授权；能否覆盖 Jupiter swap 未证明（P0-5），因此按**不能覆盖**设计。

---

## 一、需要你提供 / 拍板的东西

### 1. 密钥与地址（路径或值，不要贴进仓库）

| 变量 | 说明 | 谁提供 |
|---|---|---|
| `SQUADS_OWNER_KEYPAIR_PATH` | owner（手机 Voter）keypair **文件路径**；冷备密钥另存离线 | 你 |
| `SQUADS_PROPOSER_KEYPAIR_PATH` | agent Proposer 的 keypair 文件路径。**config transaction 创建者必须有 Proposer 权限**，owner 只有 Voter 不能创建提案 | 你 / 系统生成 |
| `SQUADS_CREATE_KEY` | 多签 createKey 公钥（SDK 模式须与下面的 keypair 一致） | 可 `Keypair.generate()` |
| `SQUADS_CREATE_KEYPAIR_PATH` | **仅 SDK 模式**需要：createKey 的 keypair 文件（随机 key，非资金私钥） | 可生成 |
| `SQUADS_SPEND_CREATE_KEY` | spendingLimit PDA 的 seed 公钥；每新建一个限额换一个新值 | 可生成 |
| `SQUADS_SPEND_MINT` | 限额代币 mint。SOL 用 `11111111111111111111111111111111`（`PublicKey.default`）；USDC 用真实 mint | 你拍板 |
| `SQUADS_DESTINATION_WALLET` | 由 `setup_turnkey_wallet.ts` 产出的 Turnkey 交易钱包地址（唯一打款目标） | 上一步产出 |
| `SQUADS_MEMBERS` | 成员 CSV `地址:角色:名称;...`，至少含 Voter / Proposer / Executor 三类 | 你 |

**角色 → 权限位**（Squads v4 官方：Proposer=1, Voter=2, Executor=4, All=7）：
默认 `FOUNDER`=2（owner 手机，仅投票）、`AUDITOR`=2（冷备，仅投票）、`CORE_AGENT`=4（网关 Executor）。
**agent = 仅 Proposer(1) 需要显式加入成员列表**，并用 `SQUADS_MEMBER_PERMISSIONS` 覆盖，例如：

```bash
export SQUADS_MEMBERS='{{SQUADS_VOTER_PHONE}}:FOUNDER:owner-phone;{{SQUADS_BACKUP_KEY}}:AUDITOR:cold-backup;{{SQUADS_EXECUTOR}}:CORE_AGENT:gateway;{{SQUADS_AGENT_PROPOSER}}:CORE_AGENT:agent-proposer'
export SQUADS_MEMBER_PERMISSIONS='{"{{SQUADS_AGENT_PROPOSER}}":1}'
```

> 占位符 `{{...}}` 必须替换为真实值后才可 `--execute`；dry-run 会原样打印并提示缺口。

### 2. 参数拍板（P0-1 / P0-5）

| 变量 | 默认 | 拍板含义 |
|---|---|---|
| `SQUADS_THRESHOLD` | `2` | 提案通过所需票数，建议 2-of-3 / 3-of-5，避免 1/x 与 x/x |
| `SQUADS_TIMELOCK_SECONDS` | `86400`（24h） | 提案达到阈值后冻结的秒数；Squads 时间锁**全局生效**，可用 1h/1d/1w/自定义秒 |
| `SQUADS_SPEND_LIMIT_SOL` | `5` | 每个周期可向交易钱包补充的上限。脚本当前按 **SOL 9 位小数**换算；若 `SQUADS_SPEND_MINT` 改成 USDC(6 位) 需改脚本精度 |
| `SQUADS_SPEND_PERIOD_SECONDS` | `86400` | 限额周期；官方仅证实 `Period.Day`，自定义秒数**需实测**（见第五节 TODO） |
| `SQUADS_NETWORK` | `devnet` | 先 devnet；**未验收前禁止 mainnet-beta** |

### 3. devnet SOL 获取

- 官方 faucet：`https://faucet.solana.com/`（选择 devnet），或 `solana airdrop <金额> <地址> --url devnet`（有频率限制）。
- 需要给：多签 **vault PDA**（脚本输出的 `vaultPda`，index=1）注资；owner / proposer 各留少量 SOL 付手续费与租金。
- 注意：资金必须发到 **vault PDA**，不是 multisig PDA（官方文档警告发到 multisig 账户可能无法追回）。

---

## 二、可选执行后端（适配器）

脚本支持两种适配器，dry-run 不需要任何后端：

- `SQUADS_ADAPTER=cli`（**默认**）：调用 `squads-multisig-cli`（`SQUADS_CLI_PATH` 可指定绝对路径）。无需安装 SDK。
  按官方 CLI：`multisig-create` → `config-transaction-create --action "SetTimeLock ..."` 与
  `--action "AddSpendingLimit ..."` → `proposal-vote` → `config-transaction-execute`。
- `SQUADS_ADAPTER=sdk`：先 `npm i @sqds/multisig`，走 `multisigCreateV2` + `configTransactionCreate`；
  用动态 `import`，未安装也不影响 dry-run / CLI 模式。

**不用 Controlled Multisig**：`configAuthority` 设为 `null`。带 configAuthority 的「受控多签」可让单一管理员绕过共识改配置，
官方明确 "not recommended for most use-cases"，与本设计「改配置走提案 + 时间锁」冲突。

---

## 三、执行顺序

1. **拍板**上述第二节所有参数，准备第一节所有密钥/地址。
2. 先跑 Turnkey 建钱包脚本并保存回执地址，设 `SQUADS_DESTINATION_WALLET`。
3. `npx tsx scripts/setup_squads_treasury.ts` —— dry-run，核对计划里的 PDA、阈值、权限位、限额、边界说明。
4. 确认无误后 `npx tsx scripts/setup_squads_treasury.ts --execute`（devnet）。脚本会：
   - 创建 multisig（CLI/SDK）；
   - 提交 `SetTimeLock` 提案（CLI 路径；SDK 路径在建库时直接带 `timeLock`）；
   - 提交 `AddSpendingLimit` 提案，目标仅 `SQUADS_DESTINATION_WALLET`，mint/定额/周期来自配置；
   - 写回执到 `data/squads-treasury-<时间戳>.json`。
5. **用 Voter 成员投票**（`proposal-vote ... --action Approve`），达到阈值后再
   `config-transaction-execute ... --transaction-index <N>`。时间锁到期后设置才真正生效。
6. faucet 小额注资到 `vaultPda`；用只读方式确认链上 multisig 的 members / threshold / timeLock 与计划一致。
7. 小额演练：从 vault 用 spending limit 向交易钱包转一笔，确认**只有该目标、该 mint、该定额**成功；
   尝试向其他目标 / 超定额 / swap 指令，确认**全部失败**。
8. 全部验收通过后才讨论 mainnet；本骨架不主动切换网络。

---

## 四、验收标准（不过不进下一步）

- dry-run 输出的 `multisigPda` / `vaultPda` 与链上 `getMultisigPda` / `getVaultPda` 一致。
- 成员权限符合角色：owner 手机 Voter(2)、冷备 Voter(2)、网关 Executor(4)、agent Proposer(1)。
- 阈值为拍板值；时间锁已生效，提前执行提案会被拒绝。
- spending limit 只覆盖「vault(index=1) → 指定 destination」的指定 mint 转账；周期重置正确。
- **负面用例**：其他目标地址、超额、swap/Jupiter 指令均被 spending limit 拒绝（P0-5 边界）。
- 大额补充 / 改成员 / 改阈值 / 改时间锁都必须走提案 + 时间锁，没有任何单一密钥可绕过。

---

## 五、「支出限额不覆盖 swap」的边界说明

Squads 官方 spending limit 文档定义的参数是：Account（取款账户）、Token + max amount（**一个限额只一个代币**）、
Time frame（周期重置或 Once）、Destination（**目标钱包地址，可多个**）。
SDK 侧 `multisigAddSpendingLimit` 也只接受 `mint` / `amount` / `period` / `destinations` / `members` / `vaultIndex`，
并没有「任意指令/任意 calldata」的授权语义。Jupiter swap 是 Squads 里另一条独立的交易流程。

因此本项目的资金流严格拆成两段：

```
Squads vault（受托、未投入资金）
   └─ spending limit：仅转账补充（定额 / 周期 / 单一目标）
        ↓
Turnkey 交易钱包（HSM 签名）
   └─ swap / 交易（Jupiter / SPL），受 Turnkey 签名策略、mint allowlist、限额约束
```

golden rule：**金库永不直接 swap；spending limit 永不授权 swap。** agent 拿不到金库私钥，
也拿不到交易钱包私钥，只能通过受策略约束的签名接口做事。

---

## 六、仍是 TODO / 待实测的点（不要带进有资金环境）

1. **CLI 输出解析**：`multisig-create` 输出里 multisig pubkey 的文本格式未文档化；解析失败时脚本会警告，
   请用 `SQUADS_MULTISIG_PDA` 手工指定并核对。
2. **Period / 自定义秒数**：官方只证实 `multisig.generated.Period.Day`；CLI 的 `<PERIOD>` 取值格式未文档化。
   默认 86400s 映射为 `Day`；其他周期（如 12h）在对照 SDK IDL 实测前不要使用。
3. **AddSpendingLimit config action 的 `period` 字段**：官方 config transaction 文档列出的 action 字段
   不含 `period`（只在 Controlled Multisig 的 `multisigAddSpendingLimit` 里出现）。装好 SDK 后须对照本地类型/IDL
   决定是否补该字段；当前代码把它注释保留。
4. **`SetTimeLock` vs `SetTimelock`**：官方两个页面大小写不一致；须按安装版本 IDL 核对后固定。
5. **spendingLimit PDA seed**：脚本按 `['spending_limit', multisigPda, createKey]` 本地推导，
   须与 `@sqds/multisig` 的 `getSpendingLimitPda` 实测一致；回执里的 `allowanceId` 仅作占位参考。
6. **Proposer 权限枚举名**：SDK 的 `Permission.Initiate` / `Propose` 名称未在文档证实，脚本会在运行时校验并报错提示。
7. **CLI 列表分隔符**：`AddSpendingLimit ... <MEMBERS> <DESTINATIONS>` 中多个地址的分隔符（当前按逗号）需实测确认。

> 以上 1–7 都是**接口细节未证实**，不是逻辑缺失；dry-run 与计划输出不受影响，
> `--execute` 前必须逐项在 devnet 小步验证。

---

## 七、官方文档依据

- Create Multisig（`multisigCreateV2`、`Permissions`）：<https://docs.squads.so/main/development/typescript/instructions/create-multisig.md>
- Permissions（Proposer=1 / Voter=2 / Executor=4 / All=7）：<https://docs.squads.so/main/development/reference/permissions.md>
- Add spending limit（Controlled Multisig 路径与参数）：<https://docs.squads.so/main/development/typescript/instructions/controlled-multisig-instructions/add-spending-limit.md>
- Create Config Transaction（`AddSpendingLimit` / `SetTimeLock` action）：<https://docs.squads.so/main/development/typescript/instructions/create-config-transaction.md>
- Spending Limits（语义：单一 token、定额、周期、目标地址）：<https://docs.squads.so/main/navigating-your-squad/settings/spending-limits.md>
- Time Locks（全局生效、可用周期）：<https://docs.squads.so/main/navigating-your-squad/settings/time-locks.md>
- CLI Commands（命令与 `--action` 格式）：<https://docs.squads.so/main/development/cli/commands.md>
- Squads Protocol v4 仓库（program id、SDK 说明）：<https://github.com/Squads-Protocol/v4>
