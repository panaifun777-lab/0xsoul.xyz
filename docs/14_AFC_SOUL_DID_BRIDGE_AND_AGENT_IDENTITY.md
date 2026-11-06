# AFC `.soul` 双链 DID 桥接与 Agent ID 链上身份确权规范

> 本文档基于对 `AFC域名网站 12.25 完成版本` 源代码的完整扫描结果编写，
> 明确 `.soul` 域名系统与 GANG.SOUL 平台的双链身份桥接架构、Agent ID
> 链上绑定规则、确权流程与收益归属模型。

---

## 一、AFC `.soul` 域名系统扫描结论

### 1.1 技术栈事实

| 项目 | 实测值 | 来源 |
| :--- | :--- | :--- |
| 底层链 | **Arc L1**（Circle 发行的稳定币原生 L1，EVM 兼容） | `shared/arc-config.ts` |
| 测试网 chainId | `5042002`（`0x4CEF52`） | `ARC_NETWORKS.testnet` |
| 主网 chainId | `5042`（`0x13B2`） | `ARC_NETWORKS.mainnet` |
| RPC 端点 | `https://rpc.testnet.arc.io` | 同上 |
| 结算货币 | **USDC**（ERC-20 接口，`0x3600...0000`，6 位小数） | `usdcAddress` / `usdcDecimals` |
| 域名标准 | **ERC-721 + ENS 衍生架构** | `ArcNameRegistry.sol` |
| 支持的 TLD | `web4`、`web5`、**`soul`** | `deployments/testnet.json` |

### 1.2 三个已部署合约（Arc Testnet）

| 合约 | 地址 | 职责 |
| :--- | :--- | :--- |
| `ArcNameRegistry` | `0x79f1DF663a4b543cEF6bB09e7A47C050eC0A7398` | ERC-721 所有权唯一事实源 |
| `ArcNameResolver` | `0xF1A286D1374969d24601C46D117DBA4Bc59b35cD` | 多链地址、文本记录、主域名解析 |
| `ArcNameRegistrar` | `0xaC3fa556996c8865e61f995f83E8e1ea56a28c0b` | 注册 / 续费 / 拍卖 / USDC 收款 |

### 1.3 tokenId 计算规则（关键）

`ArcNameRegistry.sol` 注释明确：

```
tokenId = uint256(keccak256(bytes(fullName)))
fullName = label + "." + tld  （全小写）
```

实测验证（`@noble/hashes` keccak_256）：

```
keccak256("alpha.soul") = 0x...
tokenId("alpha.soul")   = 95970670347468337102313492609718039275158662558842815947508270774687109084279
```

> 注意：`"alpha.soul"` 与 `"alpha.web4"` 是两个不同的 tokenId，同一 label 在不同 TLD 下完全独立。

### 1.4 注册权限分层（v2 规则）

| 字符长度 | 开放方式 | 价格（USDC/年） |
| :--- | :--- | :--- |
| 1–2 字符 | 仅拍卖（`startAuction`，由协议创建者发起） | 拍卖定价 |
| 3 字符 | 仅协议创建者可直接注册（`register` / `mintReserved`） | 160 USDC |
| 4 字符 | 公开开放 | 16 USDC |
| 5+ 字符 | 公开开放 | 8 USDC |

协议创建者始终可通过 `mintReserved` 铸造任意长度域名（含团队域名）。

### 1.5 多链地址解析能力（桥接的技术基础）

`ArcNameResolver.sol` 已实现 SLIP-44 标准多链地址存储：

```solidity
function setAddr(uint256 tokenId, uint256 coinType, bytes calldata addrBytes) external;
function addr(uint256 tokenId, uint256 coinType) external view returns (bytes memory);
```

| coinType | 链 | 用途 |
| :--- | :--- | :--- |
| `60` | ETH / Arc | EVM 原生地址 |
| `0` | BTC | 比特币地址 |
| **`501`** | **Solana** | **GANG.SOUL 平台身份桥接** |

**结论：`.soul` 域名不需要"迁移"，它天然可以绑定 Solana 地址。**

---

## 二、双链 DID 桥接架构

### 2.1 为什么是"两者兼顾"而不是二选一

`.soul` 域名的价值在于**唯一所有权**，而所有权由 Arc L1 的 ERC-721 承载。若在 Solana 重新铸造一套，会产生两份互相矛盾的"权威"，属于价值分叉。因此采用：

> **Arc L1 做权威注册与所有权（USDC 结算），Solana 做身份使用与穿透鉴权。**

```
┌──────────────────────────────┐          ┌──────────────────────────────┐
│      Arc L1 (EVM, USDC)      │          │           Solana             │
│                              │          │                              │
│  ArcNameRegistry (ERC-721)   │          │  AgentPassport PDA           │
│  tokenId = keccak(fullName)  │          │  seeds = ["agent_passport",  │
│  ownerOf(tokenId) → 0x...    │          │           wallet.pubkey]     │
│                              │          │  soul_domain: "alpha.soul"   │
│  ArcNameResolver             │          │  solana_address: <base58>    │
│  addr(tokenId, 501) → 32B    │          │  reputation_score: u16       │
└──────────────┬───────────────┘          └──────────────▲───────────────┘
               │                                          │
               │  ① 只读 eth_call                          │ ③ 链上验签
               │  （网关永不持私钥）                        │   注册 Passport
               ▼                                          │
      ┌────────────────────────────────────────────────┴──┐
      │           GANG.SOUL Gateway（链下鉴权层）            │
      │  AfcSoulBridge.resolveOnArc(fullName)             │
      │  AfcSoulBridge.verifyCrossChainBinding(...)        │
      │  SoulDomainResolver.generateAttestation(...)       │
      │  → Ed25519 签名凭证（含 nonce + expiry）            │
      └───────────────────────────────────────────────────┘
```

### 2.2 两种注册方式的分工

| 场景 | 操作链 | 操作方式 | 谁付费 |
| :--- | :--- | :--- | :--- |
| **注册 `.soul` 域名本体** | Arc L1（EVM） | 连接 MetaMask → `ArcNameRegistrar.register()` | USDC 支付给协议 beneficiary |
| **绑定 Solana 地址** | Arc L1（EVM） | 持有者签名 `ArcNameResolver.setAddr(tokenId, 501, pubkey)` | 仅 Arc gas |
| **在 Solana 注册 Agent 身份** | Solana | 携带网关 Attestation 调用 `register_passport` | Solana gas |
| **确权变更（转移域名）** | Arc L1（EVM） | ERC-721 `transferFrom` | 仅 Arc gas |
| **Solana 侧身份失效** | Solana | 网关检测到 Arc 链 owner 变更 → 标记 Passport 过期 | — |

> **关键设计**：Solana 侧不复制所有权，只缓存"授权快照"。Arc 链上的 token 转移会自然导致 Solana 侧授权失效。

### 2.3 实现代码位置

| 模块 | 路径 | 职责 |
| :--- | :--- | :--- |
| 双链桥接适配器 | `src/soul/afc_bridge.ts` | `AfcSoulBridge`：只读 RPC、跨链校验、签发凭证 |
| 本地 DID 注册表 | `src/soul/resolver.ts` | `SoulDomainResolver`：内存注册表 + Ed25519 Attestation |
| 网关路由 | `src/gateway/server.ts` | `/v1/soul/resolve/:domain`、`/v1/passport/claim` |

`AfcSoulBridge` 的核心方法：

```typescript
// ① 读取 Arc 链上的真实归属
resolveOnArc('alpha.soul') → {
  fullName, tokenId, evmOwner, solanaAddress, exists, fetchedAt
}

// ② 校验跨链绑定是否成立
verifyCrossChainBinding('alpha.soul', '<solana_pubkey>')
  → { ok: true/false, reason?, record }

// ③ 通过校验后签发 Solana 侧可用凭证
attestCrossChain('alpha.soul', '<solana_pubkey>', 'QUANT_MAKER')
  → { attestation, record }
```

---

## 三、Agent ID 链上身份绑定与确权建议

### 3.1 三层身份模型

| 层级 | 载体 | 绑定内容 | 变更权限 |
| :--- | :--- | :--- | :--- |
| **L1 所有权层** | Arc L1 ERC-721 | `tokenId → EVM 地址` | 域名持有者（可转移） |
| **L2 跨链绑定层** | Arc Resolver `addr(tokenId, 501)` | `tokenId → Solana 公钥` | 域名持有者（可更新） |
| **L3 使用授权层** | Solana `AgentPassport` PDA | `solana_pubkey → soul_domain` | 网关 Attestation + 合约校验 |

### 3.2 PDA 派生规则（Solana 侧）

```rust
seeds = [b"agent_passport", agent_wallet.key().as_ref()]
program_id = GangPassport1111111111111111111111111111111
```

`AgentPassport` 结构：

```rust
pub struct AgentPassport {
    pub bump: u8,
    pub authority: Pubkey,          // 智能体钱包
    pub soul_domain: String,        // "alpha.soul"
    pub registered_at: i64,
    pub tokens_launched: u32,
    pub tokens_graduated: u32,
    pub total_volume_sol: u64,
    pub is_banned: bool,
    pub reputation_score: u16,      // SRS 0~10000
}
```

**确定性**：同一个钱包地址只能拥有一个 Passport PDA，无法重复注册、无法女巫攻击。

### 3.3 确权流程（Agent ID 完整生命周期）

```
【阶段 1｜域名注册】
  运营者/用户 → Arc L1 Registrar.register("alpha", "soul", 1 year)
             → 支付 8 USDC → 获得 ERC-721 tokenId

【阶段 2｜跨链绑定】
  持有者 → Arc L1 Resolver.setAddr(tokenId, 501, <Solana 公钥 32 字节>)
        → 绑定完成，可在 Arc 浏览器查到

【阶段 3｜网关鉴权】
  智能体 → GET /v1/passport/claim?domain=alpha.soul&pubkey=<solana_pubkey>
         → 网关 AfcSoulBridge.verifyCrossChainBinding()
         → 通过则返回 Ed25519 Attestation（nonce + 300s 有效期）

【阶段 4｜链上确权】
  智能体 → Solana register_passport(passport_pda, attestation, soul_domain)
         → 合约验证 Attestation 签名与 nonce
         → 写入 AgentPassport PDA，注册完成

【阶段 5｜权限使用】
  智能体 → launch_token / trade_swap / copy_trade
         → 合约检查 Passport 是否存在、是否 banned、SRS 是否达标

【阶段 6｜变更与撤销】
  域名转移 → Arc L1 ERC-721 transferFrom
          → 网关检测到 owner 变更 → 旧 Passport 标记过期
          → 新持有者重新走【阶段 2~4】
```

### 3.4 确权安全规则（必须落实）

| 规则 | 实现方式 | 防的是什么 |
| :--- | :--- | :--- |
| **R1 一钱包一身份** | PDA 种子唯一性 | 女巫攻击 / 多重身份刷量 |
| **R2 Attestation 短时效** | `expiry = now + 300s` | 凭证被盗后长期冒用 |
| **R3 nonce 防重放** | 合约记录已用 nonce | 同一凭证重复注册 |
| **R4 所有权以 Arc 链为准** | 网关只读 `ownerOf(tokenId)` | Solana 侧伪造身份 |
| **R5 SRS 低于阈值冻结** | `reputation_score == 0` → `is_banned = true` | 恶意智能体持续作恶 |
| **R6 收益地址与治理分离** | `GlobalConfig.fee_receiver` 由 Squads v4 多签控制 | 单点私钥被盗导致资金被劫 |

---

## 四、收益归属与合规模型

### 4.1 收益来源（全部链上可审计）

| # | 收益项 | 结算链 | 收取方式 | 建议费率 |
| :--- | :--- | :--- | :--- | :--- |
| 1 | 代币发行创建费 | Solana | `launch_token` 指令内向 `fee_receiver` 转账 | 0.02 SOL / 次 |
| 2 | 联合曲线交易手续费 | Solana | 买卖各扣 1%（`TRADING_FEE_BPS=100`），其中 `GANG_PROTOCOL_FEE_BPS` 归协议 | 20 bps 归协议 |
| 3 | 毕业注入 DEX 服务费 | Solana | 满标时按档位收取（MICRO 0.3 / STANDARD 0.5 / WHALE 0.85 SOL） | 按档位 |
| 4 | x402 信号订阅费 | Solana | `GET /v1/signals/alpha` 返回 402，付款后解锁 | 0.005 SOL / 次 |
| 5 | `.soul` 域名注册与续费 | **Arc L1** | `ArcNameRegistrar` 的 `transferFrom(payer, treasury, price)` 直接进 beneficiary | 8 / 16 / 160 USDC 每年 |

### 4.2 收益地址的正确配置方式

> ⚠️ **安全铁律（Mental Seal）**：严禁在源代码中硬编码地址、私钥、API Key。
> 所有收益地址一律通过**环境变量**注入，链上权威值存放于 `GlobalConfig` PDA。

| 侧 | 环境变量 | 存储位置 | 变更权限 |
| :--- | :--- | :--- | :--- |
| EVM（Arc L1） | `GANG_PROTOCOL_FEE_RECEIVER_EVM` | 已硬编码在 AFC 合约 `PROTOCOL_OWNER`（`transferable: false`，永久锁定） | 不可变更 |
| Solana | `GANG_PROTOCOL_FEE_RECEIVER_SOLANA` | `GlobalConfig.fee_receiver` PDA | Squads v4 3-of-5 多签 + 24h 时间锁 |

配置示例（`.env`，**不提交到版本库**）：

```bash
GANG_PROTOCOL_FEE_RECEIVER_EVM=0x10687368eF1be3f178de0fCCf5EdfF49e1C258B1
GANG_PROTOCOL_FEE_RECEIVER_SOLANA=<你的 Solana 收款地址 base58>
GANG_LAUNCH_FEE_SOL=0.02
GANG_PROTOCOL_FEE_BPS=20
```

启动自检（`src/config/graduation.ts`）：

```typescript
validateRevenueConfig()  // 缺少任一环境变量时返回 { ok: false, missing: [...] }
```

> **为什么不能"隐藏"写入代码**：所有上链的 Solana / EVM 程序字节码完全公开，
> 任何人反编译即可读取常量。所谓"隐藏"在技术上不成立，反而会因不可审计
> 而降低机构投资者信任。正确做法是**透明公开 + 多签治理保护**。

---

## 五、毕业门槛：三档可配置模型

### 5.1 行业对标（2026-11）

| 平台 | 门槛 | 折合 USD（@ $200/SOL） | 机制 |
| :--- | :--- | :--- | :--- |
| pump.fun | 约 85 SOL | ~$17,000 | 代币售罄触发 |
| gang.fun | 85 SOL | ~$17,000 | 固定 SOL 金额 |
| Moonshot | 约 $500 | ~2.5 SOL | 极低门槛 |
| Raydium LaunchPad | 5–50 SOL | 自定义 | 创建者配置 |
| **GANG.SOUL（默认）** | **50 SOL** | **~$10,000** | 三档可配置 |

### 5.2 三档配置

| 档位 | SOL | 定位 | 毕业注入费 |
| :--- | :--- | :--- | :--- |
| `MICRO` | 30 | 社区 Meme 快速启动 | 0.3 SOL |
| **`STANDARD`（默认）** | **50** | 流动性与门槛最佳平衡 | **0.5 SOL** |
| `WHALE` | 85 | 完全对齐 gang.fun / pump.fun | 0.85 SOL |

### 5.3 配置方式

```bash
# 方式一：按档位切换
GRADUATION_TIER=STANDARD   # MICRO | STANDARD | WHALE

# 方式二：直接指定金额（自动匹配档位或使用自定义值）
GRADUATION_TARGET_SOL=50
```

代码位置：

| 层 | 文件 | 说明 |
| :--- | :--- | :--- |
| 合约常量 | `programs/gang_launchpad/src/state.rs` | `GRADUATION_TARGET_SOL = 50e9`，另有 `GRADUATION_MICRO_SOL` / `_STANDARD_SOL` / `_WHALE_SOL` |
| TS 配置 | `src/config/graduation.ts` | `GRADUATION_TIERS` + `resolveGraduationTier()` + `calcCurveProgress()` |
| 网关 | `src/gateway/server.ts` | 全部进度计算与毕业判定改为动态读取 |
| 前端 | `src/gateway/zero_ui.ts` | `renderZeroUi(targetSol)` 注入，前端不再硬编码 |

> **大用户适配说明**：巨鲸级项目可直接使用 `WHALE` 档（85 SOL）获得更高流动性深度；
> 社区项目使用 `MICRO` 档（30 SOL）快速毕业。三档并存，无需改代码。

---

## 六、落地检查清单

| # | 事项 | 状态 |
| :--- | :--- | :--- |
| 1 | AFC `.soul` 合约地址与 tokenId 规则确认 | ✅ 已扫描并实测 |
| 2 | `AfcSoulBridge` 只读桥接适配器 | ✅ 已实现 `src/soul/afc_bridge.ts` |
| 3 | keccak256 tokenId 计算（`@noble/hashes`） | ✅ 实测与合约一致 |
| 4 | ABI 函数选择器校准 | ✅ `ownerOf=0x6352211e`、`addr=0x724474cd` |
| 5 | 毕业门槛三档可配置 | ✅ 已落地 `.env` + 代码 |
| 6 | 收益地址环境变量注入 | ✅ 已加入 `.env.example` |
| 7 | AgentPassport PDA 绑定规则 | ✅ 已有 Rust 合约实现 |
| 8 | Arc 链 `setAddr(tokenId, 501, pubkey)` 写入 | ⏳ 需域名持有者在 Arc L1 执行（前端交互） |
| 9 | 网关 `/v1/passport/claim` 接入 `AfcSoulBridge` | ⏳ 待接入（当前为内存注册表模式） |
| 10 | Mainnet 切换（chainId 5042 + 合约地址更新） | ⏳ 部署时更新 `.env` |
