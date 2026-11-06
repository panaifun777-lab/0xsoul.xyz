use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::pubkey::Pubkey;

/// 虚拟 SOL 储备 (30 SOL)
pub const VIRTUAL_SOL_RESERVES: u64 = 30 * 1_000_000_000;
/// 虚拟 Token 储备 (1,073,000,000 枚，精度 6 位)
pub const VIRTUAL_TOKEN_RESERVES: u64 = 1_073_000_000 * 1_000_000;
/// 内盘实际可买代币总量 (8 亿枚 = 80%)
pub const REAL_TOKEN_RESERVES: u64 = 800_000_000 * 1_000_000;
/// 外盘 DEX 预留代币总量 (2 亿枚 = 20%)
pub const GRADUATION_TOKEN_RESERVES: u64 = 200_000_000 * 1_000_000;
/// 毕业硬顶 — 默认 50 SOL（行业合理区间 25~150 SOL，可由 GlobalConfig 覆盖）
pub const GRADUATION_TARGET_SOL: u64 = 50 * 1_000_000_000;
/// 超微盘快速毕业档位 (25 SOL) — BANG.fun 原生推荐
pub const GRADUATION_TIER_25_SOL: u64 = 25 * 1_000_000_000;
pub const GRADUATION_MICRO_SOL: u64 = 25 * 1_000_000_000;
/// 标准毕业档位 (50 SOL) — 默认，~$10,000 USD
pub const GRADUATION_TIER_50_SOL: u64 = 50 * 1_000_000_000;
pub const GRADUATION_STANDARD_SOL: u64 = 50 * 1_000_000_000;
/// 巨鲸满标档位 (85 SOL) — 对齐 gang.fun / pump.fun，~$17,000 USD
pub const GRADUATION_TIER_85_SOL: u64 = 85 * 1_000_000_000;
pub const GRADUATION_WHALE_SOL: u64 = 85 * 1_000_000_000;
/// 深度超级池档位 (150 SOL) — 机构与强庄生态专用
pub const GRADUATION_TIER_150_SOL: u64 = 150 * 1_000_000_000;
pub const GRADUATION_SUPER_WHALE_SOL: u64 = 150 * 1_000_000_000;
/// 单个 Agent 仓位硬顶上限 (1% = 10,000,000 枚)
pub const MAX_AGENT_HOLDING_CAP: u64 = 10_000_000 * 1_000_000;
/// 平台基础交易手续费 (100 bps = 1%)
pub const TRADING_FEE_BPS: u64 = 100;
/// 反狙击初始开盘手续费 (5000 bps = 50%)
pub const ANTI_SNIPE_MAX_FEE_BPS: u64 = 5000;
/// 反狙击费率线性衰减周期 (120 秒)
pub const ANTI_SNIPE_DECAY_SECONDS: i64 = 120;

/// Agent 链上凭证注册表 PDA
#[derive(BorshSerialize, BorshDeserialize, Debug, Clone, PartialEq)]
pub struct AgentPassport {
    pub bump: u8,
    pub authority: Pubkey,
    pub soul_domain: String,       // 如 "alpha.soul"
    pub registered_at: i64,
    pub tokens_launched: u32,
    pub tokens_graduated: u32,
    pub total_volume_sol: u64,
    pub is_banned: bool,
    pub reputation_score: u16,     // 初始 1000, 最高 10000
}

/// 联合曲线状态 PDA
#[derive(BorshSerialize, BorshDeserialize, Debug, Clone, PartialEq)]
pub struct BondingCurveState {
    pub bump: u8,
    pub mint: Pubkey,
    pub creator: Pubkey,
    pub pool_token_balance: u64,
    pub pool_sol_balance: u64,
    pub virtual_sol_reserves: u64,
    pub virtual_token_reserves: u64,
    pub target_sol_graduation: u64,
    pub total_raised: u64,
    pub is_graduated: bool,
    pub launch_mode: u8,           // 0: BondingCurve, 1: FairMint
    pub created_at: i64,
    /// 协议手续费收款地址（创建时写入，交易时强制校验，防止被篡改）
    /// 追加在结构末尾以保持既有字段的 Borsh 布局兼容。
    pub fee_receiver: Pubkey,
}

/// 单 Agent 仓位跟踪 PDA (防止科学家绕过 1% 限购)
#[derive(BorshSerialize, BorshDeserialize, Debug, Clone, PartialEq)]
pub struct AgentPosition {
    pub bump: u8,
    pub agent: Pubkey,
    pub mint: Pubkey,
    pub amount_bought: u64,
    pub amount_held: u64,
}

/// 固定价格打新 (Fair Mint) 状态 PDA
#[derive(BorshSerialize, BorshDeserialize, Debug, Clone, PartialEq)]
pub struct FairMintState {
    pub bump: u8,
    pub mint: Pubkey,
    pub creator: Pubkey,
    pub target_hard_cap_sol: u64,  // 募集硬顶 (如 50 SOL)
    pub total_contributed_sol: u64,// 已认购 SOL
    pub max_sol_per_agent: u64,    // 单 Agent 认购上限 (如 1.0 SOL)
    pub token_price_lamports: u64, // 固定代币单价
    pub deadline_slot: u64,        // 截止 Slot
    pub is_finalized: bool,        // 是否成功结盘
    pub is_refunded: bool,         // 是否超时退款
}
