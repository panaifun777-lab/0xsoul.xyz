# Agent 钱包集群、Turnkey HSM 与 Jito 防夹交易规范

## 1. 资金托管与双层钱包架构（Dual-Tier Vault）

传统基于单个裸私钥的 Agent 交易存在致命弱点：
* **单点破产风险**：一旦提示词注入或私钥泄露，整个金库被洗劫一空。
* **1% 限购瓶颈**：平台为防巨鲸和科学家设置单钱包 1% 限购，单 Agent 无法合规获取足量早期筹码。

我们采用 **A+B 混合托管架构（Squads v4 金库 + Turnkey HSM 受限容器集群）**：

```
                ┌──────────────────────────────────────────────┐
                │        Squads v4 链上冷库 (Treasury)          │
                │     • 多签保管 (3/5 权威签名)                │
                │     • 绝不向 Agent 暴露私钥                  │
                │     • 仅通过定期额度划拨注资                 │
                └──────────────────────┬───────────────────────┘
                                       │ 每日周期性注资
                                       ▼
     ┌──────────────────────────────────────────────────────────────────┐
     │           Turnkey HSM / 容器化 Ephemeral 交易子钱包集群          │
     │  (遵循 BIP44 / Ed25519 派生路径: m/44'/501'/agent_index'/0')   │
     │                                                                  │
     │  ┌───────────────┐  ┌───────────────┐      ┌──────────────────┐  │
     │  │ Agent 00 (1%) │  │ Agent 01 (1%) │ ...  │ Agent 09 (1%)    │  │
     │  └───────┬───────┘  └───────┬───────┘      └────────┬─────────┘  │
     └──────────┼──────────────────┼───────────────────────┼────────────┘
                │                  │                       │
                └──────────────────┼───────────────────────┘
                                   │ 并发签名交易 (Slot 内打包)
                                   ▼
                ┌──────────────────────────────────────────────┐
                │      Jito Bundles 防夹提交器 (MEV Shield)     │
                │  • 聚合 5-10 笔子钱包交易 + 1 笔 Jito Tip     │
                │  • 原子性执行：要么同 Slot 全部落块，要么回滚 │
                │  • 彻底免疫夹子机器人 (Front-running / MEV)   │
                └──────────────────────────────────────────────┘
```

---

## 2. 标准 BIP39 / Ed25519 确定性派生规范

避免使用非标准的 Secp256k1 截断方式，必须使用 Solana 官方标准的 `ed25519-hd-key` 算法库：

```typescript
import * as bip39 from 'bip39';
import { derivePath } from 'ed25519-hd-key';
import { Keypair } from '@solana/web3.js';

export function deriveAgentWallet(masterMnemonic: string, agentIndex: number): Keypair {
  const seed = bip39.mnemonicToSeedSync(masterMnemonic);
  const path = `m/44'/501'/${agentIndex}'/0'`;
  const derivedSeed = derivePath(path, seed.toString('hex')).key;
  return Keypair.fromSeed(derivedSeed);
}
```

---

## 3. 内存级硬编码风控沙盒（Policy-Enforced Auto-Signer）

**安全红线**：交易风控逻辑绝不允许放在 LLM Prompt 提示词中，必须硬编码在签名守护进程（Signer Daemon）底层，执行毫秒级（< 15ms）指令解码与拦截。

### 3.1 核心风控规则表
1. **程序白名单校验（Program Allowlist）**：
   * 仅允许：`SystemProgram`, `TokenProgram (Token-2022)`, `GANG_LAUNCHPAD_PROGRAM_ID`, `JUPITER_V6_PROGRAM_ID`, `RAYDIUM_CPMM_PROGRAM_ID`。
   * 出现任何未知 Program ID 即刻抛错并熔断。
2. **锁死外部转出（Zero External Transfer）**：
   * 严禁执行向白名单外的个人地址进行原生的 SOL/SPL 转账指令。
3. **单笔与滑点硬顶**：
   * 单笔交易最大限额：$\le 1.5 \text{ SOL}$。
   * 允许滑点上限：$\le 500 \text{ bps}$ (5%)。
4. **Redis 日累计额度原子拦截**：
   * 通过 Lua 脚本原子性校验当日累计支出，超出自动挂起并向管理员报警。

---

## 4. Jito Bundles 交易打包与小费规范

### 4.1 Jito 小费账户池
必须向 Jito 官方维护的 8 个验证者小费账户之一支付 Tip（随机路由防止单一账户热点拥堵）：
* `96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5`
* `HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe`
* `Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY`
* `ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49`
* `DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh`
* `ADuUkR4vqLUMWXxW9gh6D6L8pWHLHzDvf6vnTm2VuGhL`
* `DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL`
* `3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT`

### 4.2 Jito Bundle 组装要求
1. 一个 Bundle 内最大包含 **5 笔事务（Transactions）**。
2. 最后一笔交易必须包含转给 Jito Tip 账户的指令（建议基础小费：`0.0001 ~ 0.001 SOL`，在网络拥堵时支持动态自适应加价）。
3. 使用 Jito JSON-RPC 端点发送：`https://mainnet.block-engine.jito.wtf/api/v1/bundles`，方法名 `sendBundle`。
