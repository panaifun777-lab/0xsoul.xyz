# 0xsoul.xyz 多链演进与技术集成标准规范 (Arc ➔ Base ➔ Solana)

> **版本**：v2.5.0 (Production-Ready)
> **系统标识**：`0xsoul.xyz` / `0x.soul`
> **核心战略**：先从 **Arc 公链（EVM + 0x.soul 域名 USDC 结算冷启动）** 切入，无缝平移至 **Base 链（L2 高性能过渡）**，最终全面决战 **Solana 终极高性能 Meme 联合曲线与 AI 做市主战场**。

---

## 一、 多链演进战略与路线图 (Multi-Chain Roadmap)

为了兼顾开发冷启动成本、用户体验与最终的 Solana 高频流动性爆发，`0xsoul.xyz` 采用**三阶段渐进式多链部署策略**：

1. **Phase 1：Arc 公链（冷启动与 DID 域名锚定阶段）**
   * **技术栈**：EVM 兼容链、Solidity 智能合约 (`ArcNameRegistry`, `ArcNameRegistrar`, `ArcNameResolver`)、USDC 原生结算。
   * **核心目标**：依托现有的 `.soul` / `0x.soul` 域名系统和 USDC 微支付，完成早期 AI Agent 身份确权与低成本冷启动。
2. **Phase 2：Base 链（L2 生态扩展与 Agent 经济圈桥接阶段）**
   * **技术栈**：Base (Coinbase L2)、Coinbase CDP SDK、EVM 智能合约平移。
   * **核心目标**：借助 Base 链上繁荣的 Agent 钱包生态和极低 Gas 费，扩大 M2M 微支付与协议影响力。
3. **Phase 3：Solana 链（终极高性能 Meme 联合曲线与 AI 做市主战场）**
   * **技术栈**：Rust / Anchor 智能合约、Token-2022 扩展、Jito Bundles、BIP44 内存热签名钱包集群。
   * **核心目标**：依托 Solana 400ms 极速区块与联合曲线（50/85 SOL 梯度毕业），实现 AI 智能体高频微交易、Hold Line 守线防跌与极速内盘套利。

---

## 二、 Arc 公链技术集成标准（Phase 1 规范）

在 Arc 公链上，系统主要承载 `.soul` 域名注册、USDC 结算与 AgentPassport 初始身份认证：

1. **合约架构（参考本地 `contracts/arc-reference/`）**：
   * **`ArcNameRegistry.sol`**：核心记录管理，存储所有 `.soul` / `0x.soul` 域名的所有者、解析器和过期时间。
   * **`ArcNameRegistrar.sol`**：注册逻辑，支持通过 USDC 进行域名购买与续费（收益直接汇入 `0x10687368eF1be3f178de0fCCf5EdfF49e1C258B1`）。
   * **`ArcNameResolver.sol`**：地址与多链元数据解析。
2. **集成标准**：
   * 网关层通过 `src/soul/afc_bridge.ts` 与 Arc 合约进行 RPC 交互。
   * 采用 USDC 作为唯一计价与结算代币，确保冷启动阶段资金账目清晰。

---

## 三、 Base 链过渡标准（Phase 2 规范）

当协议由 Arc 向 Base L2 演进时：
1. **合约迁移**：将 EVM 域名注册与发行合约通过 Hardhat / Foundry 重新部署至 Base Mainnet / Sepolia。
2. **SDK 升级**：网关层 `ChainExecutor` 引入 EVM 签名适配器，支持 Agent 在 Base 上进行低成本无感签名与 CDP 智能钱包托管。

---

## 四、 Solana 终极主战场标准（Phase 3 规范）

当协议进入 Solana 高性能主战场时：
1. **Anchor 联合曲线合约 (`programs/gang_launchpad/`)**：
   * 采用 $x \cdot y = k$ 恒定乘积数学模型。
   * 内置反狙击动态开盘费衰减（50% ➔ 120 秒内衰减至 1%）。
   * 严格执行 1% 单一 Agent 持仓硬顶与 1.5 SOL 单笔沙盒限额。
2. **Agent 钱包与 Jito MEV 防御**：
   * BIP44 标准派生（`m/44'/501'/{index}'/0'`），内存热签名。
   * 附加 0.0001 SOL Jito Tip 交易，彻底杜绝夹子攻击（Sandwich Attack）。
3. **协议受益地址硬编码防线**：
   * 所有链上发射费、1% 交易手续费、6 SOL 毕业奖励及 DID 域名收入，统一汇入协议唯一受益地址：`0x10687368eF1be3f178de0fCCf5EdfF49e1C258B1`（Arc/Base EVM 端）与对应 Base58 地址（Solana 端）。

---

## 五、 外部 AI 智能体发现与 AGO/GEO 自动化标准

1. **`https://0xsoul.xyz/llms.txt`**：向全球 AI 智能体暴露纯 Markdown 格式的机器说明书。
2. **Model Context Protocol (MCP)**：暴露 8 大行业标准工具，实现 A2A 零人工无缝接入。
3. **分布式 DID 锚定**：以 `0x.soul` 作为跨链身份通行证，打通 Arc 域名、Base L2 与 Solana 高性能 Meme 联合曲线的全生态矩阵。
