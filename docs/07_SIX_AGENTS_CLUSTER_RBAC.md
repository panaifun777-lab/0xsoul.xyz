# 6 大 Agent 角色集群、RBAC 权限矩阵与博弈协同模型

## 1. 为什么需要多智能体集群（Agent Swarm）？

在 Meme 币高频链上博弈中，单一 Agent 无法同时兼顾“高频嗅探、安全审计、顺势追高、网格做市、逆向抄底与风控熔断”。

系统参考量化实战模型，构建了 **6 只职责严格解耦的自治 Agent 集群**。每只 Agent 拥有由 Turnkey 管理的独立派生子钱包（HD Path），并在 Fastify 网关层绑定细粒度的 **基于角色的访问控制（Role-Based Access Control, RBAC）**。

---

## 2. 6 大 Agent 角色定义与分工矩阵

```
                ┌──────────────────────────────────────────────┐
                │             Orchestrator 调度中枢             │
                │        (状态机同步与并发 Bundle 组装)         │
                └──────┬──────────┬──────────┬──────────┬──────┘
                       │          │          │          │
         ┌─────────────┘          │          │          └─────────────┐
         ▼                        ▼          ▼                        ▼
┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐
│  Sniffer (嗅探)  │    │  Surfer (冲浪)   │    │  Degen (刺客)    │    │ Cyclops (巨目)   │
│ • 合约安全审计   │    │ • 突破趋势追踪   │    │ • 首发内盘狙击   │    │ • 聪明钱巨鲸追踪 │
│ • 蜜罐/貔貅拦截  │    │ • 动量指标驱动   │    │ • 1% 极速打新    │    │ • 链上异动跟单   │
│ • 一票否决(Veto) │    │ • 动态分批止盈   │    │ • Jito Bundle 抢 │    │ • 筹码结构分析   │
└──────────────────┘    └──────────────────┘    └──────────────────┘    └──────────────────┘
         │
         │ (实时告警)
         ▼
┌──────────────────┐    ┌──────────────────┐
│  Pincher (钳子)  │    │  Razgon (极速)   │
│ • 双向做市微操   │    │ • 极速扫盘套利   │
│ • 内盘买卖护盘   │    │ • 跨池 DEX 价差  │
│ • 赚取 Token 费  │    │ • 瞬时流动性补充 │
└──────────────────┘    └──────────────────┘
```

### 2.1 角色权责详表

| Agent 标识 | 角色定位 | 链上操作权限 (RBAC) | 单笔上限 | 日累计上限 | 核心策略逻辑与指令 |
|---|---|---|---|---|---|
| **Sniffer** (嗅探者) | 安全卫士 / 风险扫描 | **只读 + Veto 提权**<br>(`canSignTx = false`, `canVeto = true`) | 0 SOL | 0 SOL | 实时扫描新池源码与 PDA，发现蜜罐/貔貅调用 `POST /api/veto/token` 写入黑名单。 |
| **Degen** (刺客) | 新盘狙击 / 早期打新 | **受限内盘交易**<br>(仅限 `gang_launchpad`) | 1.0 SOL | 10.0 SOL | 监控新 Launch 代币，在第 1-3 个 Slot 内通过 Jito Bundle 抢占 1% 早期筹码。 |
| **Surfer** (冲浪者) | 趋势突破 / 动量跟进 | **全流动性 Swap**<br>(内盘 + Jupiter 白名单) | 1.5 SOL | 15.0 SOL | 当代币进度达到 60%~85% 即将毕业时顺势加仓，跨合约建池后分批移动止盈。 |
| **Cyclops** (巨目) | 聪明钱与异动跟单 | **全流动性 Swap** | 1.0 SOL | 10.0 SOL | 订阅 x402 聪明钱异动流，计算 Alpha 胜率模型，高胜率 Agent 进场时自动跟单。 |
| **Pincher** (钳子) | 做市做商 / 维护底线 | **双向买卖做市** | 0.5 SOL | 8.0 SOL | 在内盘维持价格平稳，保证持仓不破 Hold Line，持续获取 Token-2022 交易税分红。 |
| **Razgon** (极速) | 跨池套利 / 闪电清算 | **极速多指令 Swap** | 2.0 SOL | 20.0 SOL | 在内盘联合曲线价与外盘 Meteora/Raydium 出现瞬时价差时进行无风险套利平水。 |

---

## 3. 内存级 RBAC 策略守卫实现 (TypeScript)

在 Fastify 网关签名核心或 Turnkey 代理层实施强类型策略守卫：

```typescript
export interface AgentRolePolicy {
  roleName: 'Sniffer' | 'Degen' | 'Surfer' | 'Cyclops' | 'Pincher' | 'Razgon';
  canSignTx: boolean;
  canVeto: boolean;
  allowedPrograms: Set<string>;
  maxSolPerTx: number;
  dailySpendLimitSol: number;
  allowedActions: Set<'buy' | 'sell' | 'veto' | 'arbitrage'>;
}

export const AGENT_ROLE_MATRIX: Record<string, AgentRolePolicy> = {
  Sniffer: {
    roleName: 'Sniffer',
    canSignTx: false,
    canVeto: true,
    allowedPrograms: new Set(),
    maxSolPerTx: 0,
    dailySpendLimitSol: 0,
    allowedActions: new Set(['veto']),
  },
  Degen: {
    roleName: 'Degen',
    canSignTx: true,
    canVeto: false,
    allowedPrograms: new Set([
      '11111111111111111111111111111111', // System
      'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb', // Token-2022
      'GangLaunchpad111111111111111111111111111111', // 内盘
    ]),
    maxSolPerTx: 1.0,
    dailySpendLimitSol: 10.0,
    allowedActions: new Set(['buy', 'sell']),
  },
  Surfer: {
    roleName: 'Surfer',
    canSignTx: true,
    canVeto: false,
    allowedPrograms: new Set([
      '11111111111111111111111111111111',
      'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
      'GangLaunchpad111111111111111111111111111111',
      'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4', // Jupiter v6
    ]),
    maxSolPerTx: 1.5,
    dailySpendLimitSol: 15.0,
    allowedActions: new Set(['buy', 'sell']),
  },
  // 其余角色依此类推...
};
```

---

## 4. 多智能体并发协同博弈时序

1. **第 0 秒（新池生成）**：
   * 某 Agent 发起创建代币。
   * **Sniffer** 在 50ms 内下载元数据，模拟执行买卖指令；校验无恶意逻辑后向调度器广播 `AUDIT_PASSED`。
2. **第 1 秒（并发狙击）**：
   * **Degen** 集群启动。调度器通过 BIP44 派生的 5 个子钱包各买入 0.2 SOL。
   * 5 笔交易与 1 笔 Jito Tip 组装进单个 Jito Bundle，一个 Slot 内成交，合规锁死 5% 早期筹码。
3. **第 30 秒（动量拉升）**：
   * 外部流量进场，募集金额达到 50 SOL。
   * **Surfer** 检测到动量突破指标触发，加仓 1.0 SOL，并在 `--note` 中留下交易理由："Bollinger Band Upper Breakout, target 85 SOL graduation."
4. **第 120 秒（毕业前夕与外盘套利）**：
   * 募集达到 85 SOL，触发自动毕业，流动性注入 Meteora。
   * **Razgon** 监控内外盘价差，完成毫秒级无风险价差平水。
   * **Pincher** 监控持仓防线，确保不触碰 Hold Line 警戒线，为团队锁定全天 Token-2022 分红收益。
