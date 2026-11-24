# Jupiter / SPL 买币策略：能力边界与验证清单

> 配套骨架：`scripts/setup_spl_policy.sh`（未执行、未部署、不碰真实密钥）。
> 本文只做研究与方案设计；任何数字与表达式都必须在 devnet 用真实交易验证后才能上线。

## 1. 当前代码的能力与缺口

- `src/chain/turnkey_signer.ts`
  - 签名器只会 `buildSystemTransfer()`：单条 `SystemProgram.transfer`，`signWith` 用钱包地址，提交 `TRANSACTION_TYPE_SOLANA` 的 unsigned hex，走 tk `sign transaction`；owner 在外部批准后轮询 activity 取签名并广播。
  - 没有任何 Jupiter / SPL 构造逻辑；`SignRequest` 只有 `to / amountSol / note`。
- `src/mcp/server.ts`
  - `gang_preview`：`priceSol = 0.000000038` 是种子价，`priceDataSource: 'seed'`，明确注明「真实报价路（Jupiter）尚未接入」。它做的是 1.5 SOL 硬顶、1% 持仓硬顶、TTL 60s、`slippagePct` 默认 1%，以及 60s 报价哈希。这些是**网关层**规则，不是链上/策略层规则。
  - `gang_transfer_sol`：唯一走真实 Turnkey 签名的路径（SOL 转账）；构造 `liveTransferTo`，走确认锁三档，批准后由 HSM 签名。
  - `getExecutor()` 注释直接写明：代币买卖（mint/isBuy）当前策略未覆盖 Jupiter/SPL，不伪造成交。即买币仍是 mock。
- `src/wallet/policy.ts`
  - `DEFAULT_SECURITY_POLICY.allowedProgramIds` 已含 Jupiter v6、SPL Token、Token-2022、ComputeBudget、Jito tip、Raydium CPMM 等；`maxSolPerTx=1.5`、`maxSlippageBps=500`。
  - 但这是**进程内内存沙箱**（对 VersionedTransaction 的 `compiledInstructions` 做 <1ms 自审），不是 Turnkey 策略；`allowedMints` 只在 `setup_turnkey_wallet.ts` 的 TODO 计划里出现，没有真实链上策略。
  - 缺口：Turnkey 侧只有 System Program 转账 ALLOW 策略；SPL/Jupiter 路径既没有 Turnkey 策略，也没有真实 Jupiter 报价接线。

## 2. Jupiter swap 指令结构 vs 简单 SPL transfer

| 维度 | 简单 SPL Transfer | Jupiter v6 swap |
|---|---|---|
| 指令 | 单条 `Transfer` / `TransferChecked`，一个源 token account → 一个目标 token account | 多指令：ComputeBudget、ATA create、wSOL wrap/`SyncNative`、Jupiter route（内部 CPI 到多个 DEX），常为 V0 + ALT |
| `solana.tx.spl_transfers` | 1 条，字段完整 | 可能为 0 条，或只捕获顶层 wSOL 转账；DEX 内部代币流是 CPI，不在列表里 |
| `token_mint` | 仅 `TransferChecked` / `TransferCheckedWithFee` 暴露；简单 `Transfer` 为空 | 同上；顶层若为简单 Transfer 则 mint 为空 |
| `solana.tx.transfers`（原生 SOL） | System Program 直接转账会被记录 | 输入 SOL 常被包成 wSOL 走 SPL，可能不出现；`transfers.amount` 只认 System Program 直接调用 |
| `instructions.count() == spl_transfers.count()` | 成立 | 不成立（有大量非 SPL-transfer 指令） |

关键陷阱：`all()` 对空列表返回 `true`。若策略只写 `spl_transfers.all(t, t.token_mint == '{{MINT}}')`，一个没有任何 spl_transfer 的 swap 会**空真通过**。骨架里加了 `spl_transfers.count() > 0` 兜底，并保留 `|| t.token_mint == ''` 以兼容简单 Transfer——这同时意味着 mint 约束力被削弱，见第 4 节结论。

## 3. `solana.tx` 策略语言边界

可用字段（官方文档核对）：`version` / `account_keys` / `program_keys` / `instructions`（含 `program_key`、`accounts`、`instruction_data_hex`、上传 IDL 后的 `parsed_instruction_data`）/ `transfers` / `spl_transfers`（`from`、`to`、`amount`、`owner`、`signers`、`token_mint`）/ `address_table_lookups` / V1 资源限制 / `recent_blockhash`。

**不存在**：滑点、min amount out、报价 ID、价格、截止时间、路由参数。`transfer.amount` 是 lamports，`spl_transfer.amount` 是代币原子单位，都不是「预期成交价」。

其他必须注意：
- `&&` / `||` 不短路（两端都求值）。V1-only 字段（`priority_fee_lamports` 等）在 LEGACY/V0 交易上会求值报错；Jupiter 常用 V0，因此骨架**不碰** V1 字段。
- 任意卖出仍由另一条策略/网关规则管；本 ALLOW 只覆盖买币。
- consensus 沿用已验证写法 `approvers.filter(user, user.id in [agent, owner]).count() >= 2`；不要退回两个 `count()` 做 `&&`（提交即拒）。

## 4. 真实交易验证结果（已实测，2026-11-24）

配套脚本：`scripts/devnet_spl_swap_probe.ts`（devnet 简单 transfer）与
`scripts/jupiter_swap_probe.mjs`（mainnet 真实 Jupiter swap 构造，只签名评估不广播）。

### 4.1 简单 SPL transfer：策略引擎完整解析

最初失败的根因不是策略语言，而是**探针构造错误**：交易的 fee payer 与 source ATA owner
是 devnet 测试 keypair，但 `signWith` 指向 Turnkey 钱包，两者不一致，Turnkey 无法解析。
修正为「Turnkey 钱包同时是 fee payer + source ATA owner」后：

| 条件 | 结果 |
|---|---|
| `wallet.id` + `spl_transfers.count()==1` + `token_mint==MINT` | 匹配 → `ACTIVITY_STATUS_CONSENSUS_NEEDED` |
| 上式 + `t.amount == 500000` | 匹配（amount 是代币原子单位，非人类可读） |
| 上式 + `program_keys.all(p, p in [Token, System])` | 匹配 |
| 上式 + `t.destination == poolAta` | 匹配 |
| **删除该策略后提交同一交易** | **403 unauthorized**（证明匹配确实来自 SPL 条件，不是残留策略） |

结论：对顶层 `TransferChecked`，`token_mint` / `amount` / `destination` / `program_keys`
全部可解析，mint allowlist 在这类交易上可靠。

### 4.2 真实 Jupiter swap：CPI 内代币流完全不可见

用 mainnet lite-api 取真实 quote（0.001 SOL → USDC，路由随请求变化，实测出现过
Meteora DLMM / BisonFi+Manifest / ZeroFi），以 Turnkey 钱包为 `userPublicKey` 构造
VersionedTransaction，**不签名、不广播**，提交给 Turnkey 策略引擎评估：

| 条件 | 结果 |
|---|---|
| `wallet.id` 单独 | 匹配 → 待批准（基线正常） |
| `wallet.id && spl_transfers.count() >= 1` | **不匹配 → 403** |
| `wallet.id && spl_transfers.count() == 0` | 匹配 → 待批准 |

顶层程序实测为：`ComputeBudget`、`Jupiter aggregator`、`System`、`SPL Token`、
以及随路由变化的 DEX program；指令约 8 条。

结论（已证实第 2 节的最坏假设）：**Jupiter 聚合器内部通过 CPI 完成的代币转移不会进入
`spl_transfers`，`token_mint` 对真实 swap 完全不可见**。因此：
- 第 3 节骨架里 `spl_transfers.all(...)` 对真实 swap 恒为空真（`all()` 空列表返回 true）；
  `count() > 0` 兜底会让真实 swap 被拒——这是 fail-closed，安全但买币不可用。
- 用 `token_mint` 做「只买 allowlist 币」的强保证，只对顶层 TransferChecked 有效，
  **对 Jupiter swap 无效**。

## 5. 诚实结论

**Turnkey 策略无法完整表达「只允许买 allowlist 内的币且滑点受控」。**

- 简单 SPL transfer（顶层 TransferChecked）：mint / amount / destination / program allowlist 全部可靠。
- 真实 Jupiter swap：CPI 代币流不可见，`spl_transfers` 恒为 0，mint allowlist 失效；
  顶层 program 随路由变化，固定 allowlist 需要持续维护，只能做粗粒度 backstop。
- 金额上限：只约束 System Program 直接转账（lamports）；swap 走 wSOL/SPL 时不可见。
- 滑点：**完全没有表达通道**。Turnkey `solana.tx` 没有 slippage / minOut / quote / price 字段。
  用 `instruction_data_hex` 锁定报价等于绑定单笔交易，不是通用方案。

因此分工必须是：Turnkey 策略只做**粗粒度 backstop**（钱包 + 顶层程序 allowlist +
粗金额上限 + 2-of-N 多签）；「买 allowlist 内的币、真实价格、滑点上限、1%/1.5 SOL 硬顶、
报价 TTL」全部由**网关层**（Jupiter quote → minOut 计算与校验、价格源、持仓检查、确认锁）
承担。网关当前持有 Jupiter quote 适配层（`src/price/jupiter_quote.ts`）但默认 seed 回退；
真实买币上线前，必须让网关在构造 swap 时用 quote 校验 minOut 与目标 mint，并保留确认锁。
