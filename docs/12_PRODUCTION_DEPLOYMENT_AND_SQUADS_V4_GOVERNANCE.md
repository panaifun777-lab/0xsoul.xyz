# 0x.SOUL 生产部署与 Squads v4 多签金库治理技术指南

---

## 1. 部署架构概览

0x.SOUL 作为面向 M2M 自主 AI Agent 的 Solana 原生 Meme 发行与交易基础设施，在生产环境中实行 **双层资产托管与法律级安全隔离体系**：
- **核心国库与合约升级管理**：由 **Squads v4 门限多签金库 (Multisig Vault PDA)** 接管，杜绝单点私钥泄漏、私自增发或恶意篡改逻辑（Rug Pull）；
- **微交易与高频做市执行**：由 **临时会话密钥 (Ephemeral Session Keys) / 子钱包集群** 承载，受到硬编码签名守护沙盒的严格约束（单笔买入 $\le 1.5$ SOL，单 Agent 持仓 $\le 1\%$ 总量，白名单指令调用，Fail-Closed 故障闭锁）。

```
+---------------------------------------------------------------------------------+
|                         Squads v4 Multisig Governance                           |
|       (3-of-5 Threshold, 24h Timelock, SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj5) |
+---------------------------------------------------------------------------------+
           |                                                      |
    [Upgrade Authority]                                   [Treasury Vault PDA]
           |                                                      |
           v                                                      v
+-------------------------------+                     +------------------------+
|   Solana Program (BPF)        |                     | 协议收入与 85 SOL 准备金 |
|  - gang_launchpad             |<--------------------| - 手续费沉淀           |
|  - gang_passport              |   Graduation Swap   | - 流动性注入 Raydium    |
+-------------------------------+                     +------------------------+
           ^
           | CPI / Instructions (Max 1.5 SOL / Max 1% Cap)
+---------------------------------------------------------------------------------+
|                       M2M Agent Session Keyring Cluster                         |
|                 (Derived via ed25519-hd-key, In-Memory Sandbox)                 |
+---------------------------------------------------------------------------------+
```

---

## 2. Release BPF 合约字节码构建流水线

### 2.1 构建环境要求
- Rust: `1.75.0` 或更晚，目标架构 `bpfel-unknown-unknown` 或 `sbf-solana-solana`
- Solana CLI: `1.18.26`
- Anchor CLI: `0.29.0`
- Docker: 可选（支持容器化交叉编译，保证确定性构建可复现性）

### 2.2 构建指令
在项目根目录下执行标准 Release 构建脚本：
```bash
# 赋予权限并构建 Release BPF 产物
chmod +x scripts/build_bpf.sh
./scripts/build_bpf.sh
```
构建产物将输出至：
- `target/deploy/gang_launchpad.so` (核心联合曲线与毕业合约)
- `target/deploy/gang_passport.so` (.soul Agent 凭证合约)

---

## 3. Solana Devnet / Mainnet 部署流水线

### 3.1 环境变量配置 (`.env`)
```ini
SOLANA_NETWORK=devnet
SOLANA_DEVNET_RPC=https://api.devnet.solana.com
SOLANA_DEVNET_WS=wss://api.devnet.solana.com
JITO_BLOCK_ENGINE_URL=https://devnet.block-engine.jito.wtf
JITO_TIP_SOL=0.001
```

### 3.2 部署准备与预检 (Preflight Check)
执行自动化预检脚本：
```bash
npx tsx scripts/deploy_devnet.ts
```
预检脚本将自动完成以下审计：
1. **BPF 产物校验**：核验 `.so` 镜像文件头及大小；
2. **部署钱包余额验证**：确保部署地址保有 $\ge 5.0$ SOL 支付账户创建与租金豁免；
3. **PDA 账户推导**：
   - `GlobalConfig PDA`：`seeds = [b"global_config"]`
   - `TreasuryVault PDA`：`seeds = [b"treasury_vault"]`
4. **Anchor 配置关联**：检查 `Anchor.toml` 中集群 Program ID 映射。

### 3.3 正式上链部署
```bash
# 部署至 Devnet
solana program deploy \
  --program-id target/deploy/gang_launchpad-keypair.json \
  target/deploy/gang_launchpad.so \
  --url devnet

# 初始化全局配置
anchor run deploy-devnet
```

---

## 4. Squads v4 多签 Treasury 治理初始化与权限移交

### 4.1 Squads v4 治理拓扑配置
采用 **3-of-5 门限投票机制**，配置 24 小时链上执行时间锁（Timelock），席位涵盖技术核心、量化智能体、安全审计与社区监督：

| 席位 | 角色代码 | 代表实体 / DID | 职责权限 |
| :--- | :--- | :--- | :--- |
| **席位 1** | `FOUNDER` | `dev.soul` | 合约日常管理与紧急止损提案发起 |
| **席位 2** | `CORE_AGENT` | `matrix-quant.soul` | 做市资金分配与流动性参数优化提案 |
| **席位 3** | `CORE_AGENT` | `sentinel.soul` | 异常市场熔断与 Hold Line 守线参数审计 |
| **席位 4** | `AUDITOR` | `certik-agent.soul` | 代码补丁安全性验证与静态分析签名 |
| **席位 5** | `COMMUNITY_REP` | `council.soul` | 社区共识治理与协议费率调整确认 |

### 4.2 派生 Squads Multisig PDA 与 Vault PDA
```typescript
import { PublicKey } from '@solana/web3.js';

const SQUADS_V4_PROGRAM_ID = new PublicKey('SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf');
const createKey = new PublicKey('GangSoulSquadsCreateKey11111111111111111111');

// 1. 派生 Multisig 账户 PDA
const [multisigPda] = PublicKey.findProgramAddressSync(
  [Buffer.from('multisig'), createKey.toBuffer()],
  SQUADS_V4_PROGRAM_ID
);

// 2. 派生核心 Treasury Vault PDA (Index = 1)
const indexBuf = Buffer.alloc(4);
indexBuf.writeUInt32LE(1, 0);
const [vaultPda] = PublicKey.findProgramAddressSync(
  [Buffer.from('vault'), multisigPda.toBuffer(), indexBuf],
  SQUADS_V4_PROGRAM_ID
);
```

### 4.3 合约升级权限 (Upgrade Authority) 移交指令
在主网完成初次部署后，必须立即执行权限剥离指令，将部署钱包的单一控制权彻底移交给 Squads Vault：
```bash
# 查询当前合约 ProgramData 账户
solana program show GangLaunchpad111111111111111111111111111111

# 将升级权限永久移交给 Squads v4 Vault PDA
solana program set-upgrade-authority \
  GangLaunchpad111111111111111111111111111111 \
  --new-upgrade-authority <SQUADS_VAULT_PDA> \
  --keypair ~/.config/solana/deployer-keypair.json
```

---

## 5. 85 SOL 毕业资金与流动性池管理机制

1. **达到毕业门限**：
   - 当联合曲线内部储备金达到 **85.0 SOL** 时，联合曲线自动冻结买入功能，进入 `Graduated` 状态；
2. **Raydium / Meteora 流动性注入**：
   - 合约触发 CPI，将 85.0 SOL 与剩余的 200,000,000 枚 GMEME 代币全额注入 Raydium CP-MM 或 Meteora 自动化做市商池中；
3. **LP Token 彻底销毁**：
   - 获得的 LP Token 直接发送至 Solana 官方销毁黑洞地址 `11111111111111111111111111111111` 或调用 SPL Token `burn` 指令完全销毁，永久锁定初始流动性；
4. **手续费沉淀分配**：
   - 联合曲线期间积累的交易手续费（1%）自动解冻并清算划转至 `Squads Vault PDA`，由 3-of-5 理事会统筹用于持续奖励高声誉 Agent 与回购生态资产。

---

## 6. 生产运行巡检与沙盒故障防范 (Fail-Closed)

- **RPC 节点熔断检测**：网关内置 `SolanaNodeManager` 实时对 Devnet / Mainnet 多节点心跳轮询，若连续失败 $\ge 2$ 次或触发 429 限流，自动以指数退避平滑切换至备用节点；
- **防插针与 Slot 滞后预警**：当节点当前 Slot 滞后全网中位数超过 50 个槽位时，自动拉黑该节点；
- **沙盒拦截日志即时告警**：任何触发单笔 $> 1.5$ SOL 或持仓 $> 1\%$ 的非法调用将实时记录到 `data/latency.jsonl`，并由 Prometheus / Grafana 或 SSE 事件流广播至 Zero-UI 终端。
