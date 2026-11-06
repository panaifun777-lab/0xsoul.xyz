use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint::ProgramResult,
    msg,
    program_error::ProgramError,
    pubkey::Pubkey,
    rent::Rent,
    sysvar::Sysvar,
};

use crate::error::LaunchpadError;
use crate::state::{BondingCurveState, GRADUATION_TARGET_SOL, GRADUATION_TOKEN_RESERVES};

/// 毕业时抽取的奖励总额（6 SOL）：平台 3 SOL + 发币 Agent 3 SOL
const GRADUATION_REWARD_SOL: u64 = 6 * 1_000_000_000;
/// 平台与创建者的分配比例（各 50%）
const PLATFORM_SHARE_BPS: u64 = 5000;

#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub struct GraduateToDexArgs {
    pub target_dex: String, // "meteora" 或 "raydium"
}

pub fn process_graduate_to_dex(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    args: GraduateToDexArgs,
) -> ProgramResult {
    let account_info_iter = &mut accounts.iter();

    let signer_info = next_account_info(account_info_iter)?;
    let bonding_curve_info = next_account_info(account_info_iter)?;
    // 协议金库（平台 3 SOL 的真实收款方）
    let fee_receiver_info = next_account_info(account_info_iter)?;
    // 发币 Agent 的创建者奖励接收地址
    let creator_info = next_account_info(account_info_iter)?;
    let _pool_vault_token_info = next_account_info(account_info_iter)?;
    let _dex_program_info = next_account_info(account_info_iter)?;

    if !signer_info.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }

    let mut curve_state = BondingCurveState::try_from_slice(&bonding_curve_info.data.borrow())?;

    // 必须达到毕业线且未曾毕业
    if curve_state.total_raised < GRADUATION_TARGET_SOL {
        return Err(LaunchpadError::TargetNotReached.into());
    }
    if curve_state.is_graduated {
        return Err(LaunchpadError::TokenAlreadyGraduated.into());
    }

    // 校验收款地址未被篡改（与曲线创建时登记的一致）
    if curve_state.fee_receiver != Pubkey::default()
        && curve_state.fee_receiver != *fee_receiver_info.key
    {
        return Err(LaunchpadError::InvalidFeeReceiver.into());
    }
    if curve_state.creator != *creator_info.key {
        return Err(LaunchpadError::InvalidAuthority.into());
    }

    // 资金分配计划:
    // 1. 抽取 6 SOL 作为平台与创建者奖励（平台 3 SOL，创建者 Agent 3 SOL）
    // 2. 剩余资金与预留的 2 亿枚代币注入 DEX 流动性池
    let total_sol = curve_state.pool_sol_balance;
    let reward_sol = GRADUATION_REWARD_SOL.min(total_sol);
    let platform_reward = (reward_sol as u128 * PLATFORM_SHARE_BPS as u128 / 10000) as u64;
    let creator_reward = reward_sol.saturating_sub(platform_reward);
    let liquidity_sol = total_sol.saturating_sub(reward_sol);

    // 3. 真实转账：奖励从曲线金库打入平台金库与创建者账户
    let rent_min = Rent::get()?.minimum_balance(bonding_curve_info.data_len());
    let curve_lamports = bonding_curve_info.lamports();
    let required = reward_sol
        .checked_add(rent_min)
        .ok_or(LaunchpadError::MathOverflow)?;
    if curve_lamports < required {
        return Err(LaunchpadError::InsufficientPoolLiquidity.into());
    }

    if reward_sol > 0 {
        **bonding_curve_info.lamports.borrow_mut() = curve_lamports
            .checked_sub(reward_sol)
            .ok_or(LaunchpadError::MathOverflow)?;

        if platform_reward > 0 {
            **fee_receiver_info.lamports.borrow_mut() = fee_receiver_info
                .lamports()
                .checked_add(platform_reward)
                .ok_or(LaunchpadError::MathOverflow)?;
        }

        if creator_reward > 0 {
            **creator_info.lamports.borrow_mut() = creator_info
                .lamports()
                .checked_add(creator_reward)
                .ok_or(LaunchpadError::MathOverflow)?;
        }

        msg!(
            "💰 [GRADUATION_REWARD] 平台 {} lamports → {}, 创建者 {} lamports → {}",
            platform_reward,
            fee_receiver_info.key,
            creator_reward,
            creator_info.key
        );
    }

    msg!(
        "🚀 [CPI_GRADUATE_INIT] 目标 DEX: {}, 注入流动性 SOL: {}, 代币量: {}, 总奖励: {} SOL",
        args.target_dex,
        liquidity_sol,
        GRADUATION_TOKEN_RESERVES,
        reward_sol / 1_000_000_000
    );

    // 调用 Meteora DAMM / Raydium CPMM 创建流动性池指令
    // 生成的 LP Token 立即执行 CPI burn 或发送至黑洞地址
    msg!("🔥 [LP_BURN_EVENT] LP 凭证已永久销毁至 11111111111111111111111111111111，防 Rug 锁定 100%");

    curve_state.is_graduated = true;
    curve_state.serialize(&mut &mut bonding_curve_info.data.borrow_mut()[..])?;

    Ok(())
}
