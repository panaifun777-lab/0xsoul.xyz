# GANG.SOUL 真实收入上线路线图（Go-Live Roadmap）

> 本文档基于对当前代码库的**逐项核查**编写，不使用任何推测。
> 目标是：让六项收益从"模拟记账"变成"真实到账"。

---

## 一、现状核查结果（必须正视）

| 核查项 | 命令 | 实际结果 | 含义 |
| :--- | :--- | :--- | :--- |
| BPF 部署产物 | `wc -c target/deploy/gang_launchpad.so` | **24 字节** | 是 ELF 头占位符，**不是可部署程序** |
| 网关真实上链 | `rg -c "sendTransaction" src/gateway/server.ts` | **0 处** | 所有交易是内存模拟 `5mockTxSig_...` |
| 执行器真实广播 | `rg -c "sendTransaction" src/execution/live_executor.ts` | **0 处** | 签名是拼接字符串 `5SolLiveTxSig...` |
| 合约发币能力 | `rg -c "initialize_mint\|create_token" programs/gang_launchpad/src/` | **0 处** | **合约无法创建代币** |
| Solana CLI | `solana --version` | 未安装 | 无法部署 |
| Anchor CLI | `anchor --version` | 未安装 | 无法构建/部署 |
| Docker 守护进程 | `docker info` | 未运行 | 无法容器化构建 |

### 结论

**当前系统是一个架构完整、逻辑自洽、测试充分的「全链路模拟原型」**，但：

- ❌ 合约从未真实部署到任何链
- ❌ 所有交易从未真实上链
- ❌ 合约缺少发币指令（"Agent 发币"这条路在链上不存在）
- ❌ 因此**当前没有任何真实收入产生**

这不是失败——这是原型的正常状态。但要变成真实业务，必须走完下面的路径。

---

## 二、六项收益的真实化路径

### ① 代币发行创建费（0.02 SOL/次）

**当前**：网关内存记账，合约无对应逻辑。

**必须做**：

| 步骤 | 具体工作 | 工作量 |
| :--- | :--- | :--- |
| 1 | 合约新增 `create_token` 指令（CPI 调用 SPL Token-2022 创建 Mint + Metadata） | 2-3 天 |
| 2 | 在该指令中加入 `system_instruction::transfer(creator, fee_receiver, 0.02 SOL)` | 0.5 天 |
| 3 | 网关 `POST /v1/tokens/launch` 改为构造真实交易并 `sendTransaction` | 1 天 |
| 4 | 前端/API 返回真实 Mint 地址与 Tx 签名 | 0.5 天 |

**真实收入 = 0.02 SOL × 实际发币数量**

---

### ② 交易手续费（1% 中 0.2% 归协议）

**当前**：✅ **合约逻辑已实现**（`buy_curve.rs` / `sell_curve.rs` 已有 CPI 真实转账）。

**必须做**：

| 步骤 | 具体工作 | 工作量 |
| :--- | :--- | :--- |
| 1 | 真实构建 BPF 并部署（见第四节） | 1 天 |
| 2 | 每个代币调用 `init_curve` 登记 `fee_receiver` | 已完成脚本 |
| 3 | 网关 `POST /v1/trade/swap` 改为真实构造交易并广播 | 1-2 天 |
| 4 | 给 10 个 Agent 钱包真实充值 SOL（否则无法付 gas） | 0.5 天 |

**真实收入 = 日交易量 × 1% × 20%**

---

### ③ `.soul` 域名费（8/16/160 USDC/年）

**当前**：✅ **Arc L1 合约已实现真实转账**（`ArcNameRegistrar`）。

**必须做**：

| 步骤 | 具体工作 | 状态 |
| :--- | :--- | :--- |
| 1 | Arc L1 合约已部署在 testnet | ✅ 已完成 |
| 2 | 收款地址已锁定为 `0x10687368eF1be3f178de0fCCf5EdfF49e1C258B1` | ✅ 已完成 |
| 3 | 前端网站上线（Vercel/Netlify） | ⏳ 待部署 |
| 4 | 切换 mainnet（chainId 5042） | ⏳ 需真实 USDC |

**这是六项中唯一「现在就能收钱」的业务**，因为它在另一条链上已完全就绪。

---

### ④ x402 情报订阅（0.005 SOL/次）

**当前**：收款地址已修正为您的钱包，但验款是内存模拟。

**必须做**：

| 步骤 | 具体工作 | 工作量 |
| :--- | :--- | :--- |
| 1 | 引入链上验款：查询 Tx 是否真实转账到 `recipientVault` 且金额匹配 | 1 天 |
| 2 | 或接入 Coinbase x402 Facilitator 服务 | 0.5 天 |
| 3 | 增加防重放（链上确认后记录 signature） | 0.5 天 |

**真实收入 = 调用次数 × 0.005 SOL**

---

### ⑤ 毕业奖励（6 SOL/项目，平台 3 SOL）

**当前**：✅ **合约逻辑已实现**（`graduate_cpi.rs` 真实转账）。

**必须做**：

| 步骤 | 具体工作 | 工作量 |
| :--- | :--- | :--- |
| 1 | 补齐 DEX CPI（Meteora/Raydium 建池）—— 当前只有日志，无真实 CPI | 3-5 天 |
| 2 | LP Token 真实销毁 | 1 天 |
| 3 | 部署 + 端到端测试 | 2 天 |

**真实收入 = 毕业项目数 × 3 SOL**

---

### ⑥ 做市价差

**当前**：`live_executor.ts` 全部是模拟（无 `sendTransaction`）。

**风险提示**：做市是唯一**可能亏损**的收益项。需要真实资金、真实行情、真实风控。建议最后做。

**必须做**：

| 步骤 | 具体工作 | 工作量 |
| :--- | :--- | :--- |
| 1 | 接入真实 RPC 与签名广播 | 2 天 |
| 2 | 用 Devnet 小额（0.1 SOL）跑通完整链路 | 3 天 |
| 3 | 接入真实行情源（Jupiter/DexScreener API） | 2 天 |
| 4 | 设置最大回撤熔断（如累计亏损 > 1 SOL 自动停机） | 1 天 |

---

## 三、已交付的上线脚本

### 1. `scripts/deploy.sh` —— 一键部署

```bash
# Devnet（自动空投、自动构建、自动部署、自动初始化）
bash scripts/deploy.sh devnet

# Mainnet（有二次确认保护）
bash scripts/deploy.sh mainnet
```

功能：
- 自动检测 Solana CLI / Anchor CLI / Docker
- 自动检查钱包余额（Devnet 不足自动空投）
- 三级构建回退：`cargo-build-sbf` → `anchor build` → Docker 镜像
- 校验产物真实大小（< 10KB 直接报错，防止部署占位符）
- 自动执行曲线初始化
- 输出验证命令

### 2. `scripts/init_curve.ts` —— 曲线初始化

```bash
npm run init:curve -- --cluster devnet --mint <代币Mint>
npm run init:curve -- --cluster devnet --file mints.txt
```

功能：
- 校验收款地址非默认值（防止手续费打入黑洞）
- 校验代币未被初始化（幂等，可重复执行）
- 构造 `init_curve` 指令（tag=6）
- 批量处理，失败不中断

### 3. npm 快捷命令

```bash
npm run deploy:devnet    # 部署到 Devnet
npm run deploy:mainnet   # 部署到 Mainnet
npm run init:curve       # 初始化曲线
npm run squads:init      # 初始化 Squads 多签金库
```

---

## 四、真实上线的完整步骤（按顺序）

### 阶段 1：环境准备（0.5 天）

```bash
# 1.1 安装 Solana CLI（Windows PowerShell）
cmd /c "curl -sSfL https://release.anza.xyz/stable/install | sh"
# 重开终端后验证
solana --version

# 1.2 安装 Anchor CLI（可选，脚本会回退到 solana CLI）
cargo install --git https://github.com/coral-xyz/anchor anchor-cli --locked

# 1.3 准备部署钱包
solana-keygen new --outfile ~/.config/solana/id.json
solana config set --url devnet
solana airdrop 5
```

### 阶段 2：补齐合约发币指令（2-3 天）

这是**最大的缺口**。需要新增 `create_token` 指令：

- 用 CPI 调用 SPL Token-2022 创建 Mint
- 创建 Metadata 账户
- 收取 0.02 SOL 发行费（真实转账到 `fee_receiver`）
- 初始化 BondingCurve PDA

### 阶段 3：真实构建与部署（1 天）

```bash
export GANG_PROTOCOL_FEE_RECEIVER_SOLANA=EE41ShdfntDz4gjfMTRZWUY1aujAX1FEVKtYTaE7RGSS
bash scripts/deploy.sh devnet
```

### 阶段 4：网关接入真实上链（2-3 天）

改造 `src/gateway/server.ts`：
- `POST /v1/tokens/launch` → 构造真实 `create_token` 交易
- `POST /v1/trade/swap` → 构造真实 `buy_curve` / `sell_curve` 交易
- 用 `sendAndConfirmTransaction` 替换 `5mockTxSig_...`
- 返回真实 Tx 签名

### 阶段 5：Agent 钱包充值（0.5 天）

10 个 Agent 钱包每个至少 0.5 SOL 用于 gas 与做市本金：

```bash
# 导出钱包地址
npx tsx -e "..."  # 或从网关 API 获取
solana transfer <agent_address> 0.5 --allow-unfunded-recipient
```

### 阶段 6：收益验收（1 天）

```bash
# 6.1 发一个测试币
curl -X POST http://127.0.0.1:3000/v1/tokens/launch -d '{"name":"Test","symbol":"TST"}'

# 6.2 买入一笔
curl -X POST http://127.0.0.1:3000/v1/trade/swap \
  -d '{"agentIndex":0,"mint":"<真实mint>","isBuy":true,"solAmount":0.1,"note":"test"}'

# 6.3 在 Solana Explorer 查看真实 Tx
# 6.4 在 Explorer 查看 EE41Shdfnt... 是否收到手续费
```

---

## 五、时间与成本估算

| 阶段 | 工作量 | 成本 |
| :--- | :--- | :--- |
| 环境准备 | 0.5 天 | 0 |
| 合约补发币指令 | 2-3 天 | 0 |
| 真实构建部署 | 1 天 | Devnet 免费 / Mainnet 约 3-5 SOL |
| 网关真实上链 | 2-3 天 | 0 |
| Agent 充值 | 0.5 天 | Devnet 免费 / Mainnet 约 5 SOL |
| 收益验收 | 1 天 | 极少量测试 gas |
| **合计** | **7-9 天** | **Devnet: 0** / **Mainnet: 8-10 SOL** |

---

## 六、关于"由 Agent 发币交易吗？"

**当前答案：不能**，因为合约里没有发币指令。

**补齐后可以**，流程如下：

```
Agent 调用 MCP 工具 gang_launch_token
    ↓
网关构造 create_token 交易
    ↓
Agent 钱包签名（HD 派生，私钥不出服务端）
    ↓
合约 CPI 创建 Mint + 收 0.02 SOL 发行费 → 您的钱包
    ↓
Agent 立即可以调用 gang_trade_execute 买卖自己的币
```

这就是"Agent 自主发币 + 自主交易"的完整闭环。**技术上完全可行，只差那一个指令。**

---

## 七、建议的推进顺序

| 优先级 | 事项 | 理由 |
| :--- | :--- | :--- |
| 🔴 P0 | 补齐合约 `create_token` 指令 | 没有它，发币和发行费都不存在 |
| 🔴 P0 | 安装 Solana CLI + 部署到 Devnet | 没有部署，永远是模拟 |
| 🟠 P1 | 网关接入真实上链 | 让交易产生真实手续费 |
| 🟠 P1 | x402 链上验款 | 让订阅费真实到账 |
| 🟡 P2 | 毕业 DEX CPI | 让毕业奖励真实到账 |
| 🟢 P3 | 做市真实化 | 唯一可能亏钱，放最后 |
| 🟢 P3 | 域名网站部署上线 | 已就绪，只是部署 |

---

## 八、风险提示

1. **Mainnet 成本**：部署 + Agent 充值约需 8-10 SOL（约 $1,600-2,000 @ $200/SOL）。
2. **做市可能亏损**：不要用全部资金做市，设置熔断。
3. **合约未经审计**：真实资金上线前建议做第三方安全审计（约 $5,000-15,000）。
4. **法律合规**：代币发行平台涉及证券法、AML/KYC，请咨询专业律师。

---

## 附：当前已验证可用的部分

| 能力 | 状态 |
| :--- | :--- |
| 合约手续费真实转账逻辑（买/卖/毕业） | ✅ 代码已实现，待部署 |
| `.soul` 域名 Arc L1 真实收款 | ✅ 已部署，可立即收 USDC |
| Agent ID 注册与钱包自动分配 | ✅ 已实测通过 |
| 网关收益台账与结算接口 | ✅ 已实测通过 |
| 部署与初始化脚本 | ✅ 已交付 |
| Zero-UI 看板与 SSE 实时流 | ✅ 运行中 |
| 全套自动化测试（24 项） | ✅ 全部通过 |
