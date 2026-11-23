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

## 4. 需要真实交易验证的点（devnet，未做）

1. 构造一笔真实 Jupiter V0 swap，用 `get_policy_evaluations` 看 Turnkey 实际解析出的 `program_keys` / `transfers` / `spl_transfers` / `token_mint` 各是什么。
2. `program_keys` 是否稳定落在 6 个 allowlist 内；ALT 地址是否出现在 `transfers.to` / `spl_transfers.to` 或触发 `ADDRESS_TABLE_LOOKUP` 哨兵。
3. wSOL 输入与输出代币是否进入 `spl_transfers`、mint 值是否等于 `{{MINT}}`。
4. 输入 SOL 是否被 `transfers.amount` 捕获；若否，金额上限对 swap 无效。
5. 两票 consensus 在「提交」时刻是否仍通过（agent 一票 + owner 一票）。
6. 反例测试：非 allowlist mint、超金额、非 allowlist program、人为放大滑点——确认都会被拒或被网关拦下。

## 5. 诚实结论

**不能完整表达「只允许买 allowlist 内的币且滑点受控」。**

- 程序 allowlist：可以表达（顶层 program_keys），但需真实 swap 验证 DEX CPI 是否引入额外顶层程序。
- mint allowlist：仅对 TransferChecked 类顶层 SPL 转移可靠；对 Jupiter swap 的 CPI 代币流基本看不见，骨架里的写法是尽力而为，不能作为「只买 allowlist 币」的强保证。
- 金额上限：只约束 System Program 直接转账（lamports）；swap 走 wSOL/SPL 时可绕过，且 SPL amount 不是 SOL。
- 滑点：**完全没有表达通道**。Turnkey `solana.tx` 语言没有 slippage / minOut / quote / price 字段，无法在策略里判定「滑点受控」。用 `instruction_data_hex` 锁定报价属于把策略绑定到单笔交易，不是通用方案。

因此分工必须是：Turnkey 策略只做**粗粒度backstop**（钱包 + 顶层程序 allowlist + 粗金额上限 + 2-of-N 多签）；「买 allowlist 内的币、真实价格、滑点上限、1%/1.5 SOL 硬顶、报价 TTL」全部由**网关层**（Jupiter quote → minOut 计算与校验、价格源、持仓检查、确认锁）承担。网关当前这些检查用的是种子价，接真实 Jupiter 报价是本方案落地的前置条件。
