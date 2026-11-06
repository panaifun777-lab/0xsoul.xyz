use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint::ProgramResult,
    msg,
    program::{invoke, invoke_signed},
    program_error::ProgramError,
    pubkey::Pubkey,
    rent::Rent,
    system_instruction,
    sysvar::Sysvar,
};

use crate::error::LaunchpadError;
use crate::state::{
    AgentPassport, BondingCurveState, GRADUATION_STANDARD_SOL, REAL_TOKEN_RESERVES,
    VIRTUAL_SOL_RESERVES, VIRTUAL_TOKEN_RESERVES,
};

/// BondingCurveState 的 Borsh 序列化字节长度（无 8 字节判别符）
/// 1 + 32 + 32 + 8*7 + 1 + 1 + 8 + 32 = 163
pub const BONDING_CURVE_STATE_LEN: usize = 163;

#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub struct InitCurveArgs {
    /// 毕业目标（lamports）。传 0 则使用默认 STANDARD 档位。
    pub target_sol_graduation: u64,
}

/// 初始化一个代币的联合曲线账户。
///
/// 这是手续费真实转账的前提：`fee_receiver` 必须在曲线创建时写入链上，
/// 后续 buy / sell / graduate 才能校验并据此打款，防止被中途篡改。
///
/// # 账户列表
/// 0. `[signer]`         创建者（发币 Agent，需持有 Passport）
/// 1. `[writable]`       创建者 Passport PDA（门禁校验）
/// 2. `[]`               代币 Mint 地址
/// 3. `[writable]`       待创建的 BondingCurveState PDA
/// 4. `[]`               协议手续费收款地址（必须非默认值）
/// 5. `[]`               System Program
pub fn process_init_curve(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    args: InitCurveArgs,
) -> ProgramResult {
    let account_info_iter = &mut accounts.iter();

    let creator_info = next_account_info(account_info_iter)?;
    let passport_pda_info = next_account_info(account_info_iter)?;
    let mint_info = next_account_info(account_info_iter)?;
    let bonding_curve_info = next_account_info(account_info_iter)?;
    let fee_receiver_info = next_account_info(account_info_iter)?;
    let system_program_info = next_account_info(account_info_iter)?;

    if !creator_info.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }

    // 1. 门禁：创建者必须持有合法 AgentPassport 且未被封禁
    let (expected_passport_pda, _) =
        Pubkey::find_program_address(&[b"agent_passport", creator_info.key.as_ref()], program_id);
    if expected_passport_pda != *passport_pda_info.key {
        return Err(LaunchpadError::AgentPassportMissing.into());
    }
    let passport = AgentPassport::try_from_slice(&passport_pda_info.data.borrow())?;
    if passport.is_banned {
        return Err(LaunchpadError::AgentBanned.into());
    }

    // 2. 手续费收款地址必须有效，禁止落到默认地址（否则等于销毁）
    if *fee_receiver_info.key == Pubkey::default() {
        return Err(LaunchpadError::InvalidFeeReceiver.into());
    }

    // 3. 校验并创建曲线 PDA
    let (expected_curve_pda, bump) =
        Pubkey::find_program_address(&[b"bonding_curve", mint_info.key.as_ref()], program_id);
    if expected_curve_pda != *bonding_curve_info.key {
        return Err(ProgramError::InvalidSeeds);
    }
    if !bonding_curve_info.data_is_empty() {
        return Err(ProgramError::AccountAlreadyInitialized);
    }

    let rent = Rent::get()?;
    let lamports = rent.minimum_balance(BONDING_CURVE_STATE_LEN);

    // 通过 CPI 创建由本程序持有的账户
    invoke_signed(
        &system_instruction::create_account(
            creator_info.key,
            bonding_curve_info.key,
            lamports,
            BONDING_CURVE_STATE_LEN as u64,
            program_id,
        ),
        &[
            creator_info.clone(),
            bonding_curve_info.clone(),
            system_program_info.clone(),
        ],
        &[&[b"bonding_curve", mint_info.key.as_ref(), &[bump]]],
    )?;

    // 4. 计算毕业目标档位
    let target_sol = if args.target_sol_graduation > 0 {
        args.target_sol_graduation
    } else {
        GRADUATION_STANDARD_SOL
    };

    // 5. 写入初始状态
    let curve_state = BondingCurveState {
        bump,
        mint: *mint_info.key,
        creator: *creator_info.key,
        pool_token_balance: REAL_TOKEN_RESERVES,
        pool_sol_balance: 0,
        virtual_sol_reserves: VIRTUAL_SOL_RESERVES,
        virtual_token_reserves: VIRTUAL_TOKEN_RESERVES,
        target_sol_graduation: target_sol,
        total_raised: 0,
        is_graduated: false,
        launch_mode: 0,
        created_at: 0,
        fee_receiver: *fee_receiver_info.key,
    };
    curve_state.serialize(&mut &mut bonding_curve_info.data.borrow_mut()[..])?;

    msg!(
        "🎯 [CURVE_INIT] Mint: {}, Creator: {}, FeeReceiver: {}, 毕业目标: {} SOL",
        mint_info.key,
        creator_info.key,
        fee_receiver_info.key,
        target_sol / 1_000_000_000
    );

    Ok(())
}
