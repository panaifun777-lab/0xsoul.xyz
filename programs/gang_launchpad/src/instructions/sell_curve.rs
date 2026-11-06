use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint::ProgramResult,
    msg,
    program::invoke,
    program_error::ProgramError,
    pubkey::Pubkey,
    rent::Rent,
    sysvar::Sysvar,
};

use crate::curve::calculate_sell_sol_out;
use crate::error::LaunchpadError;
use crate::state::{AgentPassport, AgentPosition, BondingCurveState};

#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub struct SellCurveArgs {
    pub token_amount: u64,
    pub min_sol_out: u64,
    pub note: String, // 限制 140 字节 AI 砸盘/止盈思考理由
}

pub fn process_sell_curve(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    args: SellCurveArgs,
) -> ProgramResult {
    let account_info_iter = &mut accounts.iter();

    let signer_info = next_account_info(account_info_iter)?;
    let passport_pda_info = next_account_info(account_info_iter)?;
    let bonding_curve_info = next_account_info(account_info_iter)?;
    let position_pda_info = next_account_info(account_info_iter)?;
    // 协议手续费收款账户与 System Program（用于真实 SOL 转账）
    let fee_receiver_info = next_account_info(account_info_iter)?;
    let _system_program_info = next_account_info(account_info_iter)?;
    // 代币转移相关账户（确保卖家真实交出代币）
    let seller_token_account_info = next_account_info(account_info_iter)?;
    let pool_token_account_info = next_account_info(account_info_iter)?;
    let token_program_info = next_account_info(account_info_iter)?;

    if !signer_info.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }

    if args.note.len() > 140 {
        return Err(LaunchpadError::NoteTooLong.into());
    }

    // 1. 严格门禁：校验 AgentPassport PDA
    let (expected_passport_pda, _) =
        Pubkey::find_program_address(&[b"agent_passport", signer_info.key.as_ref()], program_id);
    if expected_passport_pda != *passport_pda_info.key {
        return Err(LaunchpadError::AgentPassportMissing.into());
    }

    let passport = AgentPassport::try_from_slice(&passport_pda_info.data.borrow())?;
    if passport.is_banned {
        return Err(LaunchpadError::AgentBanned.into());
    }

    // 2. 校验联合曲线状态
    let mut curve_state = BondingCurveState::try_from_slice(&bonding_curve_info.data.borrow())?;
    if curve_state.is_graduated {
        return Err(LaunchpadError::TokenAlreadyGraduated.into());
    }

    // 3. 校验调用者真实持仓
    let mut position = AgentPosition::try_from_slice(&position_pda_info.data.borrow())?;
    if position.amount_held < args.token_amount {
        return Err(ProgramError::InsufficientFunds);
    }

    // 4. 计算换回的 SOL (已扣除 1% 平台手续费)
    let (net_sol_out, fee_sol) = calculate_sell_sol_out(
        curve_state.virtual_sol_reserves,
        curve_state.virtual_token_reserves,
        args.token_amount,
    )?;

    if net_sol_out < args.min_sol_out {
        return Err(LaunchpadError::SlippageExceeded.into());
    }

    // 5. 更新状态
    let gross_sol = net_sol_out
        .checked_add(fee_sol)
        .ok_or(LaunchpadError::MathOverflow)?;

    // 5.1 校验手续费收款账户（防篡改）
    if curve_state.fee_receiver != Pubkey::default() && curve_state.fee_receiver != *fee_receiver_info.key {
        return Err(LaunchpadError::InvalidFeeReceiver.into());
    }

    // 5.2 真实转账：从曲线金库（bonding_curve PDA）支付卖方净额与协议手续费。
    //     bonding_curve 是由本程序持有的账户，直接操纵 lamports 是标准做法，
    //     但必须保证转出后仍保留 rent-exempt 余额，否则账户会被回收。
    let curve_lamports = bonding_curve_info.lamports();
    let rent_min = Rent::get()?.minimum_balance(bonding_curve_info.data_len());
    let required = gross_sol
        .checked_add(rent_min)
        .ok_or(LaunchpadError::MathOverflow)?;

    if curve_lamports < required {
        return Err(LaunchpadError::InsufficientPoolLiquidity.into());
    }

    if gross_sol > 0 {
        **bonding_curve_info.lamports.borrow_mut() = curve_lamports
            .checked_sub(gross_sol)
            .ok_or(LaunchpadError::MathOverflow)?;

        **signer_info.lamports.borrow_mut() = signer_info
            .lamports()
            .checked_add(net_sol_out)
            .ok_or(LaunchpadError::MathOverflow)?;

        if fee_sol > 0 {
            **fee_receiver_info.lamports.borrow_mut() = fee_receiver_info
                .lamports()
                .checked_add(fee_sol)
                .ok_or(LaunchpadError::MathOverflow)?;

            msg!(
                "💰 [FEE_TRANSFER] 卖出 {} lamports 手续费已真实转入协议金库 {}",
                fee_sol,
                fee_receiver_info.key
            );
        }
    }

    // 5.3 真实代币转移：卖家将代币交回内盘金库。
    //     缺少这一步会导致"卖家拿到 SOL 却不交出币"，等于凭空套利。
    if args.token_amount > 0 {
        invoke(
            &spl_token::instruction::transfer(
                token_program_info.key,
                seller_token_account_info.key,
                pool_token_account_info.key,
                signer_info.key,
                &[],
                args.token_amount,
            )?,
            &[
                seller_token_account_info.clone(),
                pool_token_account_info.clone(),
                signer_info.clone(),
                token_program_info.clone(),
            ],
        )?;

        msg!(
            "🪙 [TOKEN_RECLAIM] {} 枚代币已从卖方 {} 收回到内盘金库",
            args.token_amount,
            seller_token_account_info.key
        );
    }

    curve_state.pool_sol_balance = curve_state
        .pool_sol_balance
        .checked_sub(gross_sol)
        .ok_or(LaunchpadError::MathOverflow)?;
    curve_state.virtual_sol_reserves = curve_state
        .virtual_sol_reserves
        .checked_sub(gross_sol)
        .ok_or(LaunchpadError::MathOverflow)?;
    curve_state.virtual_token_reserves = curve_state
        .virtual_token_reserves
        .checked_add(args.token_amount)
        .ok_or(LaunchpadError::MathOverflow)?;
    curve_state.total_raised = curve_state.total_raised.saturating_sub(gross_sol);

    position.amount_held = position
        .amount_held
        .checked_sub(args.token_amount)
        .ok_or(LaunchpadError::MathOverflow)?;

    // 6. 抛出带 AI 砸盘思考理由的链上日志
    msg!(
        "📉 [AGENT_TRADE_EVENT] Agent: {}, Mint: {}, is_buy: false, sol: {}, tokens: {}, note: \"{}\"",
        passport.soul_domain,
        curve_state.mint,
        net_sol_out,
        args.token_amount,
        args.note
    );

    curve_state.serialize(&mut &mut bonding_curve_info.data.borrow_mut()[..])?;
    position.serialize(&mut &mut position_pda_info.data.borrow_mut()[..])?;

    Ok(())
}
