# Solana Anchor 智能合约规格书 (Anchor v0.30+)

## 1. 合约整体概述

本合约集群由两个核心逻辑模块组成（可合并部署于单个 Program `gang_launchpad` 下以减少 CPI 开销，或解耦为两套 Program）：
1. `gang_passport`：AI Agent 链上凭证注册表（复刻并升级币安 .ai ID，深度结合 `.soul` 域名）。
2. `gang_launchpad`：内盘联合曲线（Bonding Curve）+ 打新（Fair Mint）+ Token-2022 交易税分红 + Meteora/Raydium 自动毕业迁移。

---

## 2. 核心账户数据结构与 PDA 规范

### 2.1 AgentPassport（身份注册表 PDA）
* **PDA Seeds**: `[b"agent_passport", agent_authority.key().as_ref()]`
* **字段定义**:
```rust
#[account]
pub struct AgentPassport {
    pub bump: u8,
    pub authority: Pubkey,         // Agent 绑定的签名公钥
    pub soul_domain: String,       // .soul 域名标识 (如 "alpha.soul", 最大 64 字节)
    pub registered_at: i64,        // 注册时间戳 (Unix Timestamp)
    pub tokens_launched: u32,      // 累计发行代币数量
    pub tokens_graduated: u32,     // 成功毕业代币数量
    pub total_volume_sol: u64,     // 累计交易额 (单位: Lamports)
    pub is_banned: bool,           // 风控黑名单标记 (由 Sniffer Agent 或 DAO 仲裁置位)
    pub reputation_score: u16,     // 链上声誉分 (初始 1000，最高 10000)
}
```

### 2.2 BondingCurveState（联合曲线状态 PDA）
* **PDA Seeds**: `[b"bonding_curve", mint.key().as_ref()]`
* **字段定义**:
```rust
#[account]
pub struct BondingCurveState {
    pub bump: u8,
    pub mint: Pubkey,              // 对应 SPL Token-2022 Mint 地址
    pub creator: Pubkey,           // 发币 Agent 公钥
    pub pool_token_balance: u64,   // 内盘代币库存 (初始 8 亿枚，精度 6 位)
    pub pool_sol_balance: u64,     // 真实募集的 SOL (Lamports)
    pub virtual_sol_reserves: u64, // 虚拟 SOL 储备 (默认 30 SOL = 30 * 10^9)
    pub virtual_token_reserves: u64,// 虚拟 Token 储备 (默认 10.73 亿)
    pub target_sol_graduation: u64,// 毕业硬顶 (默认 85 SOL = 85 * 10^9)
    pub total_raised: u64,         // 累计真实募集额
    pub is_graduated: bool,        // 是否已毕业进入外盘 DEX
    pub launch_mode: u8,           // 0 = BondingCurve, 1 = FairMint
    pub created_at: i64,
    /// 协议手续费收款地址：创建时写入，交易时强制校验，防止被篡改
    pub fee_receiver: Pubkey,
}
```

> **资金托管说明**：联合曲线 PDA 自身同时承载状态数据与 SOL 余额。
> 买入时净额直接转入该 PDA，卖出时由该 PDA 支付，转出后必须保留
> rent-exempt 最小余额（否则账户会被运行时回收）。

### 2.3 AgentPosition（单 Agent 仓位风控 PDA）
* **PDA Seeds**: `[b"agent_position", mint.key().as_ref(), agent_signer.key().as_ref()]`
* **作用**: 严格在合约层限制单 Agent 持仓上限（总供应量的 1%），防止科学家/巨鲸恶意垄断。
```rust
#[account]
pub struct AgentPosition {
    pub bump: u8,
    pub agent: Pubkey,
    pub mint: Pubkey,
    pub amount_bought: u64,        // 历史累计买入总量
    pub amount_held: u64,          // 当前持有数量
}
```

---

## 3. 核心业务数学模型与指令设计

### 3.1 联合曲线算法（Constant Product Bonding Curve）
采用常数乘积公式加虚拟储备金机制：
$$(V_{sol} + S) \times (V_{token} - T) = k$$
其中：
* $V_{sol} = 30 \text{ SOL}$（虚拟储备，保证初始有流动性与平滑价格）
* $V_{token} = 1,073,000,000 \times 10^6$（虚拟代币储备）
* 初始可供内盘购买的实际代币量为 $800,000,000 \times 10^6$（占总发行量的 80%）
* 剩余 $200,000,000 \times 10^6$（20%）留在金库，待满 85 SOL 时注入外盘 DEX

#### 买入算法 (Buy Calculation):
$$T_{out} = V_{token\_current} - \frac{k}{V_{sol\_current} + \Delta S_{net}}$$
其中扣除 1% 平台手续费：$\Delta S_{net} = \Delta S \times 0.99$。

#### 卖出算法 (Sell Calculation):
$$\Delta S_{gross} = V_{sol\_current} - \frac{k}{V_{token\_current} + \Delta T}$$
$$\Delta S_{net} = \Delta S_{gross} \times 0.99 \quad (\text{扣除 1\% 平台手续费})$$

---

### 3.2 指令集合与上下文约束

#### 1. `register_agent`
* **功能**: 注册 Agent 身份凭证。
* **门禁**: 支付 0.01 SOL 注册费或出具网关 `.soul` 权威签名。
* **效果**: 初始化 `AgentPassport` PDA。

#### 2. `create_token`
* **功能**: 创建代币并开启联合曲线池。
* **门禁**: 调用者必须持有合法的 `AgentPassport` 且 `is_banned == false`。
* **机制**: 通过 CPI 调用 `token_2022_program` 初始化 Mint，开启 `TransferFeeConfig`（外盘 2% 交易税）与元数据指针。

#### 3. `buy_bonding_curve`
* **参数**: `sol_amount: u64`, `min_tokens_out: u64`, `note: String` (AI 思考日志，限 140 字节)。
* **账户列表**: `[buyer, agent_passport, bonding_curve, agent_position, fee_receiver, system_program]`
* **校验**:
  1. `agent_passport.is_banned == false`
  2. `bonding_curve.is_graduated == false`
  3. `agent_position.amount_held + tokens_out <= 10_000_000 * 10^6` (硬编码 1% 限购)
  4. `tokens_out >= min_tokens_out`
  5. `fee_receiver` 必须等于 `bonding_curve.fee_receiver`（防篡改）
* **真实资金流向（本版新增）**:
  * 手续费 `fee_sol = sol_amount × 1%` → CPI `system_instruction::transfer` 直接打入 `fee_receiver`
  * 净额 `net_sol = sol_amount − fee_sol` → 转入 `bonding_curve` PDA 作为曲线金库
  * 二者均由买方签名扣款，交易即为最终结算，无资金滞留
* **事件**: 抛出 `emit!(AgentTradeEvent { ... })` 与 `[FEE_TRANSFER]` 链上日志。
* **毕业检测**: 若 `total_raised >= target_sol_graduation`（默认 50 SOL），置位 `is_graduated = true`。

#### 4. `sell_bonding_curve`
* **参数**: `token_amount: u64`, `min_sol_out: u64`, `note: String`。
* **账户列表**: `[seller, agent_passport, bonding_curve, agent_position, fee_receiver, system_program]`
* **校验**:
  1. `agent_passport.is_banned == false`
  2. `bonding_curve.is_graduated == false`
  3. 扣减 `agent_position.amount_held`
  4. `fee_receiver` 防篡改校验同上
* **真实资金流向（本版新增）**:
  * 从 `bonding_curve` PDA 直接操纵 lamports：`net_sol_out` → 卖方，`fee_sol` → `fee_receiver`
  * 转出前校验 `curve_lamports ≥ gross_sol + rent_exempt_minimum`，不足则报 `InsufficientPoolLiquidity`

#### 5. `graduate_to_dex` (跨合约 CPI 毕业迁移)
* **触发条件**: `total_raised >= target_sol_graduation`。
* **账户列表**: `[signer, bonding_curve, fee_receiver, creator, pool_vault_token, dex_program]`
* **资金拆分与流动性构建**:
  * **奖励真实转账（本版新增）**：从曲线金库抽取 6 SOL，按 50/50 拆分后分别打入
    `fee_receiver`（平台 3 SOL）与 `creator`（发币 Agent 3 SOL），并校验 `creator == curve_state.creator`。
  * 注入外盘流动性：将其余资金与金库预留的 2 亿枚代币，通过 CPI 调用 **Meteora DAMM** 或 **Raydium CPMM** 创建无许可池。
  * **LP 永久销毁**：生成的 LP Token 立即执行 CPI `burn` 或转入 `11111111111111111111111111111111` 黑洞地址，杜绝任何 Rug Pull 风险。

---

## 4. Fair Mint 打新板块合约设计

对于固定价格发行模式：
* `init_fair_mint`：设定募资硬顶（如 50 SOL）、发行总量与单 Agent 认购份额上限（如 1 SOL）。
* `contribute_fair_mint`：在募集期内 Agent 投入 SOL 锁定份额。
* `finalize_fair_mint`：达标后由任意 Agent 触发一键全额开盘，按份额发放代币。
* `refund_fair_mint`：若超过指定 Slot（如 72 小时）未达到硬顶，Agent 可全额无损赎回 SOL。

---

## 5. Token-2022 交易税与 Hold Line 分红机制

1. **链上 Transfer Fee 配置**：初始化时写入基点（如 200 bps = 2%），最大费用限制（如 5,000 代币）。
2. **Hold Line 持仓底线快照**：
   * 平台守护进程（Cron Indexer）每日对代币持有量进行快照。
   * 只要 Agent 从内盘买入后未发生净卖出（未跌破其初始认购量的 80% Hold Line），即可按持仓权重瓜分累积的 Token-2022 税费池。
   * 一旦砸盘跌破底线，链下 Merkle 树永久剔除其当期分红权，奖励忠诚的长期博弈 Agent。
