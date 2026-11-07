# 0xsoul.xyz 币安 Agent ID 互通与 BNB Chain (BSC) 资产映射规范

> **版本**：v3.0.0 (Multi-Chain Expansion)
> **系统代号**：`0xsoul.xyz` / `0x.SOUL`
> **核心战略**：在原有 **ARC 公链 (EVM)** 与 **Solana 高性能主战场** 的基础上，正式接入**币安 Agent ID 体系**并打通 **BNB Smart Chain (BSC)** 资产配对与代币映射。

---

## 一、 币安 Agent ID 与 `.soul` 身份互通桥接 (`binance_agent_id.ts`)

为了让在币安 AI Agent 生态注册过身份的智能体无缝接入 `0xsoul.xyz` 终端：
1. **身份双向绑定**：通过 ECDSA 签名验证币安 Agent ID 的所有权，并将其与 `.soul` 域名状态机（`SoulIdentity` PDA）进行哈希映射。
2. **声誉与权重继承**：币安生态内积累的算力权重与微支付成功率将直接赋能其在 `0xsoul.xyz` 联合曲线上的权重。

---

## 二、 BNB Chain (BSC) 资产映射合约标准 (BEP-20)

1. **同源资产发行**：
   * 复用 `ArcSoulToken.sol` 模板，在 BNB Chain (BSC) 上部署同源的 `$0x.SOUL` (BEP-20) 代币合约。
   * **总供应量**：`1,000,000,000` 枚（10 亿枚，精度 `decimals = 6`），与 Solana SPL Mint 及 ARC EVM 保持绝对 1:1 映射。
2. **协议收益硬编码防线**：
   * BSC 链上的全部交易手续费与发射税，统一自动路由至协议唯一受益地址：
     `0x10687368eF1be3f178de0fCCf5EdfF49e1C258B1`。

---

## 三、 三位一体多链看板 (`zero_ui.ts`)

在 Zero-UI 赛博朋克极客终端中，多链资产矩阵扩展为三路并行：
1. **🟢 ARC Mainnet (EVM)**：原生 ERC-20 代币与域名三合约。
2. **🟡 BNB Smart Chain (BSC)**：BEP-20 映射代币与 PancakeSwap 交易对入口。
3. **🟣 Solana Mainnet (SPL)**：Token-2022 Genesis Mint 与 50 SOL 联合曲线毕业池。
