# 0x.SOUL `create_token` 指令契约（冻结版 v1）

> **契约状态**：FROZEN — 合约、网关、测试三方必须严格对齐本文件。
> **变更流程**：任何修改需同步更新本文件 + 合约 + 网关 + 测试，否则视为破坏性变更。

---

## 1. 指令标识

| 项 | 值 |
| :--- | :--- |
| Instruction Tag | `7` |
| Rust 处理函数 | `process_create_token` |
| TypeScript 构造器 | `buildCreateTokenInstruction`（`src/chain/launchpad_ix.ts`） |
| 权限要求 | 调用者必须持有有效 `AgentPassport` 且 `is_banned == false` |

---

## 2. 参数结构（Borsh 序列化）

```rust
pub struct CreateTokenArgs {
    pub name: String,              // 代币名称，1~32 字节
    pub symbol: String,            // 代币符号，1~10 字节
    pub uri: String,               // 元数据 URI，1~200 字节
    pub decimals: u8,              // 精度，固定 6
    pub total_supply: u64,         // 总供应量（含精度），默认 1_073_000_000 * 10^6
    pub target_sol_graduation: u64,// 毕业目标（lamports），默认 50 * 10^9
}
```

**序列化顺序**：`tag(1) | name | symbol | uri | decimals(1) | total_supply(8) | target_sol_graduation(8)`

其中 `String` 的 Borsh 编码为 `length(u32 LE) + utf8 bytes`。

---

## 3. 账户列表（顺序不可变更）

| # | 账户 | 标记 | 说明 |
| :--- | :--- | :--- | :--- |
| 0 | `creator` | `signer, writable` | 发币 Agent 钱包，支付发行费与租金 |
| 1 | `agent_passport` | `readonly` | `["agent_passport", creator]` 派生，门禁校验 |
| 2 | `mint` | `signer, writable` | 新代币的 SPL Token Mint 账户（需客户端生成 Keypair 并签名） |
| 3 | `bonding_curve` | `writable` | `["bonding_curve", mint]` 派生，曲线状态 PDA |
| 4 | `pool_token_account` | `writable` | 内盘代币金库（持有 8 亿枚待售代币） |
| 5 | `fee_receiver` | `writable` | 协议发行费收款地址（必须非默认值） |
| 6 | `token_program` | `readonly` | SPL Token Program：`TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA` |
| 7 | `system_program` | `readonly` | `11111111111111111111111111111111` |
| 8 | `rent` | `readonly` | `SysvarRent111111111111111111111111111111111` |

---

## 4. 执行流程（原子性，任一失败则全部回滚）

```
① 门禁校验
   ├─ creator.is_signer == true
   ├─ agent_passport PDA == find_program_address(["agent_passport", creator])
   └─ passport.is_banned == false

② 参数校验
   ├─ name.len() ∈ [1, 32]
   ├─ symbol.len() ∈ [1, 10]
   ├─ uri.len() ∈ [1, 200]
   ├─ decimals == 6
   └─ total_supply > 0

③ 收款地址校验
   └─ fee_receiver != Pubkey::default()   // 防止手续费打入黑洞

④ 收取发行费（真实转账）
   └─ system_instruction::transfer(creator → fee_receiver, LAUNCH_FEE_LAMPORTS)

⑤ 创建 Mint 账户
   └─ system_instruction::create_account(
        creator, mint, rent_exempt, Mint::LEN, token_program)

⑥ 初始化 Mint（CPI → SPL Token）
   └─ InitializeMint2 { decimals: 6, mint_authority: bonding_curve PDA, freeze_authority: None }

⑦ 创建代币金库账户
   └─ system_instruction::create_account(
        creator, pool_token_account, rent_exempt, Account::LEN, token_program)

⑧ 初始化代币金库（CPI → SPL Token）
   └─ InitializeAccount3 { owner: bonding_curve PDA }

⑨ 铸造内盘代币（CPI → SPL Token）
   └─ MintTo { amount: REAL_TOKEN_RESERVES } → pool_token_account
      （mint_authority 为 bonding_curve PDA，通过 invoke_signed 签名）

⑩ 创建并写入曲线状态
   └─ BondingCurveState {
        mint, creator, fee_receiver,
        pool_token_balance: REAL_TOKEN_RESERVES,
        pool_sol_balance: 0,
        virtual_sol_reserves: VIRTUAL_SOL_RESERVES,
        virtual_token_reserves: VIRTUAL_TOKEN_RESERVES,
        target_sol_graduation,
        total_raised: 0,
        is_graduated: false,
        launch_mode: 0,
        created_at: <clock unix_timestamp>,
      }

⑪ 事件日志
   └─ msg!("[TOKEN_CREATED] mint=..., creator=..., fee=..., supply=...")
```

---

## 5. 常量

| 常量 | 值 | 说明 |
| :--- | :--- | :--- |
| `LAUNCH_FEE_LAMPORTS` | `20_000_000` | 0.02 SOL 发行费 |
| `TOKEN_DECIMALS` | `6` | 代币精度 |
| `DEFAULT_TOTAL_SUPPLY` | `1_073_000_000_000_000` | 10.73 亿枚（含 6 位精度） |
| `REAL_TOKEN_RESERVES` | `800_000_000_000_000` | 内盘 8 亿枚 |
| `VIRTUAL_SOL_RESERVES` | `30_000_000_000` | 虚拟 SOL 30 枚 |
| `VIRTUAL_TOKEN_RESERVES` | `1_073_000_000_000_000` | 虚拟代币 10.73 亿枚 |

---

## 6. 错误码（新增）

| 错误 | 触发条件 |
| :--- | :--- |
| `InvalidTokenMetadata` | name / symbol / uri 长度超限或为空 |
| `InvalidTokenDecimals` | decimals != 6 |
| `InvalidTotalSupply` | total_supply == 0 |
| `InvalidFeeReceiver` | fee_receiver == Pubkey::default() |
| `LaunchFeeTransferFailed` | 发行费转账失败（余额不足） |

---

## 7. 资金流向

```
creator (Agent 钱包)
    │
    ├─ 0.02 SOL ──→ fee_receiver（协议收款，不可篡改）
    │
    ├─ ~0.0015 SOL ──→ Mint 账户租金（可回收）
    │
    └─ ~0.002 SOL ──→ 代币金库账户租金（可回收）

创建完成后：
  ├─ Mint 总供应量 = 10.73 亿枚
  ├─ 内盘金库持有 = 8 亿枚（可买入）
  ├─ 待毕业注入 = 2 亿枚（外盘 DEX 流动性预留）
  └─ 曲线状态已就绪，可立即 buy / sell
```

---

## 8. 客户端构造要求

```typescript
// 必须由客户端生成 mint Keypair 并作为额外签名者
const mintKeypair = Keypair.generate();
const tx = new Transaction().add(
  buildCreateTokenInstruction({
    creator: agentKeypair.publicKey,
    mint: mintKeypair.publicKey,
    feeReceiver: new PublicKey(process.env.GANG_PROTOCOL_FEE_RECEIVER_SOLANA!),
    name: 'Test Token',
    symbol: 'TST',
    uri: 'https://example.com/meta.json',
  })
);
tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
tx.feePayer = agentKeypair.publicKey;

await sendAndConfirmTransaction(connection, tx, [agentKeypair, mintKeypair]);
```

---

## 9. 与现有指令的关系

| 指令 | 关系 |
| :--- | :--- |
| `init_curve` (tag 6) | **兼容保留**：为已存在的 Mint 单独初始化曲线。`create_token` 内部已包含该逻辑，新代币无需再调用。 |
| `buy_curve` (tag 1) | 依赖 `create_token` 产出的 `bonding_curve` 与 `pool_token_account` |
| `sell_curve` (tag 2) | 同上 |
| `graduate_cpi` (tag 5) | 依赖曲线达到 `target_sol_graduation` |
