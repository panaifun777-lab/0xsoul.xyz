# 0x.SOUL 多智能体协同开发任务分解清单 (WBS & Task Checklist)

本文档将 0x.SOUL 全系统开发拆解为细粒度的工作分解结构（Work Breakdown Structure, WBS），并明确分配到不同的专业研发智能体（Dev Agents），标明前置依赖、关键路径与具体交付物。

---

## 1. 智能体研发角色配置表

在多智能体协同开发流水线中，由以下 6 类专业研发智能体分工协作：

| 研发智能体代码 | 研发角色 | 专业领域与职责范围 |
|---|---|---|
| **AGENT-SOL** | Solana 智能合约工程师 | Rust、Anchor、Token-2022、CPI 跨合约调用、Solana 链上测试 |
| **AGENT-WAL** | 钱包与风控系统工程师 | BIP39/Ed25519 派生、Turnkey HSM、Jito Bundles、内存策略沙盒 |
| **AGENT-GTW** | 网关与协议架构师 | Node.js Fastify、Redis 原子计数、/llms.txt、x402 协议实现 |
| **AGENT-IDX** | 链下索引与数据工程师 | Solana WebSocket/Geyser 监听、Borsh 事件解码、IPFS Kubo、SSE 推送 |
| **AGENT-CLI** | 开发者工具工程师 | TypeScript、@gang-soul/cli、MCP Server、Claude/Cursor 适配器 |
| **AGENT-SEC** | 安全审计与 QA 工程师 | 漏洞扫描、提示词注入防御、Proof 0 边界压测、E2E 自动化闭环 |

---

## 2. 关键路径与依赖拓扑图 (Critical Path)

```
[WBS 1.1 派生库] ──► [WBS 1.2 沙盒风控] ──► [WBS 1.3 Jito Bundle] ──┐
                                                                    ▼
[WBS 2.1 身份合约] ──► [WBS 2.2 联合曲线] ──► [WBS 2.3 毕业建池] ──► [WBS 4.1 Proof 0 实测]
                                                                    ▲
[WBS 3.1 Fastify] ──► [WBS 3.2 /llms.txt] ──► [WBS 3.3 SSE 索引] ───┘
                                                                    │
                                                                    ▼
                                      [WBS 5.1 CLI/MCP] ──► [WBS 6.1 主网部署]
```
**关键路径 (Critical Path)**: WBS 1.2 (沙盒风控) + WBS 2.2 (联合曲线合约) -> WBS 4.1 (Proof 0 验证通过) -> WBS 3.2 (网关 tx/build) -> WBS 6.1 (生产部署)。

---

## 3. 详细任务分解清单 (WBS 表格)

### 阶段一：M1 捕手先行（钱包集群与量化接入）

| WBS 编码 | 任务名称 | 负责智能体 | 前置依赖 | 核心产出物 | 验收标准 | 状态 |
|:---:|---|:---:|:---:|---|---|:---:|
| **1.1** | 标准 Ed25519 BIP44 派生库 | `AGENT-WAL` | 无 | `src/wallet/derive.ts` | 兼容 Phantom/Backpack 助记词，派生速度 10 钱包 < 5ms | [ ] |
| **1.2** | 内存硬编码风控策略沙盒 | `AGENT-WAL` | 1.1 | `src/wallet/policy.ts` | 白名单拦截率 100%，禁止外部地址转出，单笔 <= 1.5 SOL | [ ] |
| **1.3** | Jito Bundle 组装与小费构造 | `AGENT-WAL` | 1.2 | `src/wallet/jito.ts` | 随机路由 8 个官方小费账户，支持原子提交 5 笔交易 | [ ] |
| **1.4** | 4 套迷因量化策略对接适配器 | `AGENT-WAL` | 1.3 | `src/quant/adapter.ts` | 与既有量化系统无缝集成，支持模拟盘与实盘一键切换 | [ ] |

---

### 阶段二：M2 合约闭环（Solana Anchor 核心合约）

| WBS 编码 | 任务名称 | 负责智能体 | 前置依赖 | 核心产出物 | 验收标准 | 状态 |
|:---:|---|:---:|:---:|---|---|:---:|
| **2.1** | `gang_passport` 身份注册表模块 | `AGENT-SOL` | 无 | `programs/passport/src/lib.rs` | 生成不可转让 SBT PDA，记录发币数、胜率与 `.soul` 域名 | [ ] |
| **2.2** | `buy/sell_bonding_curve` 联合曲线 | `AGENT-SOL` | 2.1 | `programs/launchpad/src/curve.rs` | 常数乘积算法，强制单 Agent 1% 限购，抛出 `--note` 事件 | [ ] |
| **2.3** | `Fair Mint` 固定打新与退款模块 | `AGENT-SOL` | 2.1 | `programs/launchpad/src/fair.rs` | 设定硬顶，超募开盘，超时支持 Agent 全额无损退回 SOL | [ ] |
| **2.4** | 85 SOL 满额自动跨合约 CPI 毕业 | `AGENT-SOL` | 2.2 | `programs/launchpad/src/dex_cpi.rs` | 跨合约调用 Meteora/Raydium 注入池并立即 burn/锁死 LP | [ ] |
| **2.5** | Token-2022 交易税与 Hold Line 快照 | `AGENT-SOL` | 2.4 | `programs/launchpad/src/tax.rs` | 配置 TransferFee 2%，低于持仓底线者剔除税费分红资格 | [ ] |

---

### 阶段三：M3 网关与看板（Fastify + IPFS + Zero-UI）

| WBS 编码 | 任务名称 | 负责智能体 | 前置依赖 | 核心产出物 | 验收标准 | 状态 |
|:---:|---|:---:|:---:|---|---|:---:|
| **3.1** | Fastify 高性能网关基础脚手架 | `AGENT-GTW` | 无 | `gateway/src/server.ts` | 异步高性能架构，内置 Redis 连接池与限流中间件 | [ ] |
| **3.2** | 零 PDA 计算交易构建器 (`POST /api/tx/build`) | `AGENT-GTW` | 2.2, 3.1 | `gateway/src/routes/build.ts` | 外部 Agent 零计算获取 Base64 VersionedTransaction | [ ] |
| **3.3** | 机器接入说明书 (`/llms.txt`) | `AGENT-GTW` | 3.2 | `gateway/public/llms.txt` | 纯 Markdown 格式，3 行指令引导 Claude/Grok 自主接入 | [ ] |
| **3.4** | 本地 IPFS Kubo 容器化元数据发布器 | `AGENT-IDX` | 3.1 | `gateway/src/services/ipfs.ts` | 上传图片与 JSON 秒级生成 CIDv1，本地 Kubo 自动 pin | [ ] |
| **3.5** | 链下 Geyser/WebSocket 实时索引器 | `AGENT-IDX` | 2.2, 3.1 | `indexer/src/worker.ts` | 毫秒级解码 Anchor 事件，SSE 端到端推送延迟 < 500ms | [ ] |
| **3.6** | Zero-UI 暗黑极客终端只读大屏 | `AGENT-CLI` | 3.5 | `frontend/index.html` | 零钱包连接按钮，SSE 直推 Agent 思考日志与毕业进度条 | [ ] |

---

### 阶段四：M4 外部接入包与域名认证（CLI + MCP + .soul）

| WBS 编码 | 任务名称 | 负责智能体 | 前置依赖 | 核心产出物 | 验收标准 | 状态 |
|:---:|---|:---:|:---:|---|---|:---:|
| **4.1** | Proof 0 Devnet 安全边界与拦截压测 | `AGENT-SEC` | 1.2, 3.2 | `tests/proof0-validator.ts` | 实测验证 Squads 限额边界与网关策略 100% 拦截 | [ ] |
| **4.2** | `@gang-soul/cli` 命令行交互包 | `AGENT-CLI` | 3.2 | `packages/cli/bin/index.ts` | 支持 `npx` 免安装一键查询行情、打新发币与买卖 | [ ] |
| **4.3** | `@gang-soul/mcp-server` 适配包 | `AGENT-CLI` | 4.2 | `packages/mcp/src/index.ts` | 严格剪裁 Tool Allowlist，接入 Claude Desktop 与 Cursor | [ ] |
| **4.4** | `.soul` 分布式域名网关签名预言机 | `AGENT-GTW` | 2.1, 3.1 | `gateway/src/services/soul_attest.ts`| 验证 .soul 权威注册并签署 Ed25519 证明，2 秒内激活通行证 | [ ] |
| **4.5** | x402 链上微支付中间件与情报变现 | `AGENT-GTW` | 3.1 | `gateway/src/middleware/x402.ts` | HTTP 402 拦截，验证 USDC/SOL 链上到账后放行聪明钱流 | [ ] |
| **4.6** | 每日 AI 链上打狗简报与 TG 广播 | `AGENT-CLI` | 3.5 | `scripts/daily_report.ts` | 每早 9:00 与代币毕业时自动生成摘要并推送 Telegram 频道 | [ ] |
| **4.7** | EVM 跨链抽象接口设计 (Base/BSC/ARC) | `AGENT-GTW` | 4.2 | `sdk/src/abstract/chain.ts` | 统一客户端指令集与 Market JSON Schema，预留 EVM 路由 | [ ] |

---

## 4. 交付物质量验收与代码准入卡（Quality Gate）

所有研发智能体在提交代码合入前，必须自检满足以下 5 条铁律：
1. **测试覆盖**：新增核心业务逻辑单元测试覆盖率 $\ge 85\%$。
2. **密钥零暴露**：`git diff` 中严禁出现私钥、助记词、明文密码与硬编码 Token。
3. **无未捕获异常**：异步 Promise 必须全部显式包裹 `try/catch`，网关严禁出现未处理异常导致进程崩溃。
4. **编译与类型安全**：Rust 代码必须通过 `cargo clippy -- -D warnings`；TypeScript 代码必须通过 `tsc --noEmit`。
5. **审计留痕**：每次重要逻辑变更需附带架构决策记录（ADR）或修改说明。
