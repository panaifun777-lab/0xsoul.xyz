use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::{
    account_info::{next_account_info, AccountInfo},
    clock::Clock,
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

/// 代币发行创建费：0.02 SOL
pub const LAUNCH_FEE_LAMPORTS: u64 = 20_000_000;
/// 代币精度：6 位
pub const TOKEN_DECIMALS: u8 = 6;
/// 默认总供应量：10.73 亿枚（含 6 位精度）
pub const DEFAULT_TOTAL_SUPPLY: u64 = 1_073_000_000_000_000;
/// 代币名称最大长度
pub const MAX_NAME_LEN: usize = 32;
/// 代币符号最大长度
pub const MAX_SYMBOL_LEN: usize = 10;
/// 元数据 URI 最大长度
pub const MAX_URI_LEN: usize = 200;

/// SPL Token Mint 账户字节长度（标准 82 字节）
const MINT_ACCOUNT_LEN: usize = 82;
/// SPL Token 代币账户字节长度（标准 165 字节）
const TOKEN_ACCOUNT_LEN: usize = 165;

#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub struct CreateTokenArgs {
    pub name: String,
    pub symbol: String,
    pub uri: String,
    pub decimals: u8,
    pub total_supply: u64,
    pub target_sol_graduation: u64,
}

/// 创建新代币并初始化其联合曲线。
///
/// 这是整个平台的「发币入口」：一次性完成 Mint 创建、代币金库初始化、
/// 内盘代币铸造、发行费收取与曲线状态写入。
///
/// # 账户列表（顺序不可变更，见 docs/16_CREATE_TOKEN_CONTRACT.md）
/// 0. `[signer, writable]` creator
/// 1. `[]`                agent_passport
/// 2. `[signer, writable]` mint
/// 3. `[writable]`        bonding_curve PDA
/// 4. `[writable]`        pool_token_account
/// 5. `[writable]`        fee_receiver
/// 6. `[]`                token_program
/// 7. `[]`                system_program
/// 8. `[]`                rent
/// 校验代币元数据参数，返回规范化后的总供应量。
///
/// 抽成纯函数以便单元测试覆盖，不含任何链上状态依赖。
pub fn validate_create_token_args(args: &CreateTokenArgs) -> Result<u64, LaunchpadError> {
    if args.name.is_empty()
        || args.name.len() > MAX_NAME_LEN
        || args.symbol.is_empty()
        || args.symbol.len() > MAX_SYMBOL_LEN
        || args.uri.is_empty()
        || args.uri.len() > MAX_URI_LEN
    {
        return Err(LaunchpadError::InvalidTokenMetadata);
    }
    if args.decimals != TOKEN_DECIMALS {
        return Err(LaunchpadError::InvalidTokenDecimals);
    }
    let total_supply = if args.total_supply == 0 {
        DEFAULT_TOTAL_SUPPLY
    } else {
        args.total_supply
    };
    if total_supply < REAL_TOKEN_RESERVES {
        return Err(LaunchpadError::InvalidTotalSupply);
    }
    Ok(total_supply)
}

pub fn process_create_token(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    args: CreateTokenArgs,
) -> ProgramResult {
    let account_info_iter = &mut accounts.iter();

    let creator_info = next_account_info(account_info_iter)?;
    let passport_pda_info = next_account_info(account_info_iter)?;
    let mint_info = next_account_info(account_info_iter)?;
    let bonding_curve_info = next_account_info(account_info_iter)?;
    let pool_token_account_info = next_account_info(account_info_iter)?;
    let fee_receiver_info = next_account_info(account_info_iter)?;
    let token_program_info = next_account_info(account_info_iter)?;
    let system_program_info = next_account_info(account_info_iter)?;
    let rent_info = next_account_info(account_info_iter)?;

    // ---------------------------------------------------------------
    // ① 门禁校验：必须持有未封禁的 AgentPassport
    // ---------------------------------------------------------------
    if !creator_info.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }

    let (expected_passport_pda, _) =
        Pubkey::find_program_address(&[b"agent_passport", creator_info.key.as_ref()], program_id);
    if expected_passport_pda != *passport_pda_info.key {
        return Err(LaunchpadError::AgentPassportMissing.into());
    }
    let passport = AgentPassport::try_from_slice(&passport_pda_info.data.borrow())?;
    if passport.is_banned {
        return Err(LaunchpadError::AgentBanned.into());
    }

    // ---------------------------------------------------------------
    // ② 参数校验（复用纯函数，便于单元测试覆盖）
    // ---------------------------------------------------------------
    let total_supply = validate_create_token_args(&args)?;

    // ---------------------------------------------------------------
    // ③ 收款地址校验：禁止落到默认地址（否则等于销毁）
    // ---------------------------------------------------------------
    if *fee_receiver_info.key == Pubkey::default() {
        return Err(LaunchpadError::InvalidFeeReceiver.into());
    }

    // ---------------------------------------------------------------
    // ④ 校验 PDA 派生
    // ---------------------------------------------------------------
    let (expected_curve_pda, curve_bump) =
        Pubkey::find_program_address(&[b"bonding_curve", mint_info.key.as_ref()], program_id);
    if expected_curve_pda != *bonding_curve_info.key {
        return Err(ProgramError::InvalidSeeds);
    }
    if !bonding_curve_info.data_is_empty() {
        return Err(ProgramError::AccountAlreadyInitialized);
    }

    // ---------------------------------------------------------------
    // ⑤ 收取发行费（真实转账到协议金库）
    // ---------------------------------------------------------------
    invoke(
        &system_instruction::transfer(creator_info.key, fee_receiver_info.key, LAUNCH_FEE_LAMPORTS),
        &[
            creator_info.clone(),
            fee_receiver_info.clone(),
            system_program_info.clone(),
        ],
    )
    .map_err(|_| LaunchpadError::LaunchFeeTransferFailed)?;

    msg!(
        "💰 [LAUNCH_FEE] {} lamports 发行费已真实转入协议金库 {}",
        LAUNCH_FEE_LAMPORTS,
        fee_receiver_info.key
    );

    // ---------------------------------------------------------------
    // ⑥ 创建 Mint 账户
    // ---------------------------------------------------------------
    let rent = Rent::from_account_info(rent_info)?;
    // 兼容 rent_info 直接传入或通过 sysvar 读取
    let mint_rent = rent.minimum_balance(MINT_ACCOUNT_LEN);

    invoke(
        &system_instruction::create_account(
            creator_info.key,
            mint_info.key,
            mint_rent,
            MINT_ACCOUNT_LEN as u64,
            token_program_info.key,
        ),
        &[
            creator_info.clone(),
            mint_info.clone(),
            system_program_info.clone(),
        ],
    )?;

    // ---------------------------------------------------------------
    // ⑦ 初始化 Mint：mint_authority = bonding_curve PDA
    // ---------------------------------------------------------------
    invoke(
        &spl_token::instruction::initialize_mint2(
            token_program_info.key,
            mint_info.key,
            bonding_curve_info.key,
            None,
            args.decimals,
        )?,
        &[
            mint_info.clone(),
            rent_info.clone(),
        ],
    )?;

    // ---------------------------------------------------------------
    // ⑧ 创建并初始化代币金库账户（PDA，由本程序 invoke_signed 创建，无需客户端签名）
    // ---------------------------------------------------------------
    let (expected_pool_account, pool_bump) =
        Pubkey::find_program_address(&[b"pool_token", mint_info.key.as_ref()], program_id);
    if expected_pool_account != *pool_token_account_info.key {
        return Err(ProgramError::InvalidSeeds);
    }

    let account_rent = rent.minimum_balance(TOKEN_ACCOUNT_LEN);
    let pool_seeds: &[&[u8]] = &[
        b"pool_token",
        mint_info.key.as_ref(),
        &[pool_bump],
    ];

    invoke_signed(
        &system_instruction::create_account(
            creator_info.key,
            pool_token_account_info.key,
            account_rent,
            TOKEN_ACCOUNT_LEN as u64,
            token_program_info.key,
        ),
        &[
            creator_info.clone(),
            pool_token_account_info.clone(),
            system_program_info.clone(),
        ],
        &[pool_seeds],
    )?;

    invoke(
        &spl_token::instruction::initialize_account3(
            token_program_info.key,
            pool_token_account_info.key,
            mint_info.key,
            bonding_curve_info.key,
        )?,
        &[
            pool_token_account_info.clone(),
            mint_info.clone(),
            rent_info.clone(),
        ],
    )?;

    // ---------------------------------------------------------------
    // ⑨ 铸造内盘代币到金库（mint_authority 为曲线 PDA，需 invoke_signed）
    // ---------------------------------------------------------------
    let curve_seeds: &[&[u8]] = &[
        b"bonding_curve",
        mint_info.key.as_ref(),
        &[curve_bump],
    ];

    invoke_signed(
        &spl_token::instruction::mint_to(
            token_program_info.key,
            mint_info.key,
            pool_token_account_info.key,
            bonding_curve_info.key,
            &[],
            REAL_TOKEN_RESERVES,
        )?,
        &[
            mint_info.clone(),
            pool_token_account_info.clone(),
            bonding_curve_info.clone(),
            token_program_info.clone(),
        ],
        &[curve_seeds],
    )?;

    // ---------------------------------------------------------------
    // ⑩ 创建并写入曲线状态
    // ---------------------------------------------------------------
    let curve_rent = rent.minimum_balance(crate::instructions::init_curve::BONDING_CURVE_STATE_LEN);
    invoke_signed(
        &system_instruction::create_account(
            creator_info.key,
            bonding_curve_info.key,
            curve_rent,
            crate::instructions::init_curve::BONDING_CURVE_STATE_LEN as u64,
            program_id,
        ),
        &[
            creator_info.clone(),
            bonding_curve_info.clone(),
            system_program_info.clone(),
        ],
        &[curve_seeds],
    )?;

    let target_sol = if args.target_sol_graduation > 0 {
        args.target_sol_graduation
    } else {
        GRADUATION_STANDARD_SOL
    };

    // Sysvar 读取当前链上时间（失败时回落为 0，不影响业务逻辑）
    let created_at = Clock::get().map(|c| c.unix_timestamp).unwrap_or(0);

    let curve_state = BondingCurveState {
        bump: curve_bump,
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
        created_at,
        fee_receiver: *fee_receiver_info.key,
    };
    curve_state.serialize(&mut &mut bonding_curve_info.data.borrow_mut()[..])?;

    // ---------------------------------------------------------------
    // ⑪ 事件日志
    // ---------------------------------------------------------------
    msg!(
        "🚀 [TOKEN_CREATED] Mint: {}, Creator: {}, Name: {}, Symbol: {}, Supply: {}, 发行费: {} lamports → {}",
        mint_info.key,
        creator_info.key,
        args.name,
        args.symbol,
        total_supply,
        LAUNCH_FEE_LAMPORTS,
        fee_receiver_info.key
    );

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn valid_args() -> CreateTokenArgs {
        CreateTokenArgs {
            name: "Gang Soul Test".to_string(),
            symbol: "GST".to_string(),
            uri: "https://gang.soul/meta/test.json".to_string(),
            decimals: TOKEN_DECIMALS,
            total_supply: DEFAULT_TOTAL_SUPPLY,
            target_sol_graduation: 0,
        }
    }

    #[test]
    fn test_valid_args_pass() {
        let supply = validate_create_token_args(&valid_args()).unwrap();
        assert_eq!(supply, DEFAULT_TOTAL_SUPPLY);
        assert!(supply >= REAL_TOKEN_RESERVES);
    }

    #[test]
    fn test_empty_name_rejected() {
        let mut args = valid_args();
        args.name = String::new();
        assert_eq!(
            validate_create_token_args(&args).unwrap_err(),
            LaunchpadError::InvalidTokenMetadata
        );
    }

    #[test]
    fn test_name_too_long_rejected() {
        let mut args = valid_args();
        args.name = "A".repeat(MAX_NAME_LEN + 1);
        assert_eq!(
            validate_create_token_args(&args).unwrap_err(),
            LaunchpadError::InvalidTokenMetadata
        );
    }

    #[test]
    fn test_symbol_too_long_rejected() {
        let mut args = valid_args();
        args.symbol = "S".repeat(MAX_SYMBOL_LEN + 1);
        assert_eq!(
            validate_create_token_args(&args).unwrap_err(),
            LaunchpadError::InvalidTokenMetadata
        );
    }

    #[test]
    fn test_wrong_decimals_rejected() {
        let mut args = valid_args();
        args.decimals = 9;
        assert_eq!(
            validate_create_token_args(&args).unwrap_err(),
            LaunchpadError::InvalidTokenDecimals
        );
    }

    #[test]
    fn test_zero_supply_falls_back_to_default() {
        let mut args = valid_args();
        args.total_supply = 0;
        let supply = validate_create_token_args(&args).unwrap();
        assert_eq!(supply, DEFAULT_TOTAL_SUPPLY);
    }

    #[test]
    fn test_supply_below_real_reserves_rejected() {
        let mut args = valid_args();
        args.total_supply = REAL_TOKEN_RESERVES - 1;
        assert_eq!(
            validate_create_token_args(&args).unwrap_err(),
            LaunchpadError::InvalidTotalSupply
        );
    }

    #[test]
    fn test_launch_fee_is_002_sol() {
        // 契约校验：发行费必须为 0.02 SOL = 20_000_000 lamports
        assert_eq!(LAUNCH_FEE_LAMPORTS, 20_000_000);
        assert_eq!(LAUNCH_FEE_LAMPORTS as f64 / 1_000_000_000.0, 0.02);
    }

    #[test]
    fn test_token_account_lens_match_spl_standard() {
        // SPL Token 标准账户长度，用于租金计算，改动会导致资金计算错误
        assert_eq!(MINT_ACCOUNT_LEN, 82);
        assert_eq!(TOKEN_ACCOUNT_LEN, 165);
    }
}
