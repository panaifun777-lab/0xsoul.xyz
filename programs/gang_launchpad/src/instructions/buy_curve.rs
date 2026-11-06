use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::{
    account_info::{next_account_info, AccountInfo},
    clock::Clock,
    entrypoint::ProgramResult,
    msg,
    program::{invoke, invoke_signed},
    program_error::ProgramError,
    pubkey::Pubkey,
    system_instruction,
    sysvar::Sysvar,
};

use crate::curve::{
    calculate_buy_tokens_out_with_fee, calculate_dynamic_fee_bps, is_graduation_threshold_met,
    verify_one_percent_holding_cap,
};
use crate::error::LaunchpadError;
use crate::state::{AgentPassport, AgentPosition, BondingCurveState};

#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub struct BuyCurveArgs {
    pub sol_amount: u64,
    pub min_tokens_out: u64,
    pub note: String, // 限制 140 字节 AI 思考理由
}

pub fn process_buy_curve(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    args: BuyCurveArgs,
) -> ProgramResult {
    let account_info_iter = &mut accounts.iter();

    let signer_info = next_account_info(account_info_iter)?;
    let passport_pda_info = next_account_info(account_info_iter)?;
    let bonding_curve_info = next_account_info(account_info_iter)?;
    let position_pda_info = next_account_info(account_info_iter)?;
    // 协议手续费收款账户与 System Program（用于真实 SOL 转账）
    let fee_receiver_info = next_account_info(account_info_iter)?;
    let system_program_info = next_account_info(account_info_iter)?;
    // 代币转移相关账户（确保买家真实拿到代币）
    let pool_token_account_info = next_account_info(account_info_iter)?;
    let buyer_token_account_info = next_account_info(account_info_iter)?;
    let token_program_info = next_account_info(account_info_iter)?;

    if !signer_info.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }

    if args.note.len() > 140 {
        return Err(LaunchpadError::NoteTooLong.into());
    }

    // 1. 严格门禁：校验 AgentPassport PDA 并确认未被封禁
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

    // 3. 反狙击动态费率计算 (50% -> 120秒内线性衰减至 1%，创作者首发豁免)
    let current_timestamp = Clock::get()
        .map(|c| c.unix_timestamp)
        .unwrap_or(curve_state.created_at + 121);
    let is_creator = curve_state.creator == *signer_info.key;
    let fee_bps = calculate_dynamic_fee_bps(curve_state.created_at, current_timestamp, is_creator);
    msg!(
        "🛡️ [ANTI_SNIPE] 当前交易生效费率: {} bps (创作者豁免: {})",
        fee_bps,
        is_creator
    );

    // 常数乘积算法计算 Tokens Out 与动态手续费
    let (tokens_out, fee_sol) = calculate_buy_tokens_out_with_fee(
        curve_state.virtual_sol_reserves,
        curve_state.virtual_token_reserves,
        args.sol_amount,
        fee_bps,
    )?;

    if tokens_out < args.min_tokens_out {
        return Err(LaunchpadError::SlippageExceeded.into());
    }

    // 4. 校验单 Agent 1% 限购硬顶约束
    let mut position = if position_pda_info.data_len() > 0 {
        AgentPosition::try_from_slice(&position_pda_info.data.borrow())?
    } else {
        AgentPosition {
            bump: 0,
            agent: *signer_info.key,
            mint: curve_state.mint,
            amount_bought: 0,
            amount_held: 0,
        }
    };

    verify_one_percent_holding_cap(position.amount_held, tokens_out)?;

    // 5. 校验手续费收款账户（防篡改：必须与曲线创建时写入的地址一致）
    if curve_state.fee_receiver != Pubkey::default() && curve_state.fee_receiver != *fee_receiver_info.key {
        return Err(LaunchpadError::InvalidFeeReceiver.into());
    }

    // 6. 真实转账：手续费从买方直接打入协议收款地址（CPI → System Program）
    //    这是让协议收益真正落袋的关键一步，避免手续费滞留在曲线账户中。
    if fee_sol > 0 {
        invoke(
            &system_instruction::transfer(signer_info.key, fee_receiver_info.key, fee_sol),
            &[
                signer_info.clone(),
                fee_receiver_info.clone(),
                system_program_info.clone(),
            ],
        )?;

        msg!(
            "💰 [FEE_TRANSFER] {} lamports 手续费已真实转入协议金库 {}",
            fee_sol,
            fee_receiver_info.key
        );
    }

    // 6.1 真实转账：净买入资金进入联合曲线金库（bonding_curve PDA 自身持有 lamports）
    //     缺少这一步会导致曲线没有真实资金，卖方将无法提现。
    let net_sol = args
        .sol_amount
        .checked_sub(fee_sol)
        .ok_or(LaunchpadError::MathOverflow)?;
    if net_sol > 0 {
        invoke(
            &system_instruction::transfer(signer_info.key, bonding_curve_info.key, net_sol),
            &[
                signer_info.clone(),
                bonding_curve_info.clone(),
                system_program_info.clone(),
            ],
        )?;
    }

    // 6.2 真实代币转移：从内盘金库划转 tokens_out 到买方代币账户。
    //     内盘金库的 owner 是曲线 PDA，因此需要 invoke_signed 以 PDA 身份签名。
    //     缺少这一步会导致"买家付了 SOL 却拿不到币"。
    if tokens_out > 0 {
        let (curve_pda, curve_bump) =
            Pubkey::find_program_address(&[b"bonding_curve", curve_state.mint.as_ref()], program_id);
        let curve_seeds: &[&[u8]] = &[
            b"bonding_curve",
            curve_state.mint.as_ref(),
            &[curve_bump],
        ];

        invoke_signed(
            &spl_token::instruction::transfer(
                token_program_info.key,
                pool_token_account_info.key,
                buyer_token_account_info.key,
                &curve_pda,
                &[],
                tokens_out,
            )?,
            &[
                pool_token_account_info.clone(),
                buyer_token_account_info.clone(),
                bonding_curve_info.clone(),
                token_program_info.clone(),
            ],
            &[curve_seeds],
        )?;

        msg!(
            "🪙 [TOKEN_TRANSFER] {} 枚代币已从内盘金库转给买方 {}",
            tokens_out,
            buyer_token_account_info.key
        );
    }

    // 7. 更新状态数据
    curve_state.pool_sol_balance = curve_state
        .pool_sol_balance
        .checked_add(args.sol_amount - fee_sol)
        .ok_or(LaunchpadError::MathOverflow)?;
    curve_state.virtual_sol_reserves = curve_state
        .virtual_sol_reserves
        .checked_add(args.sol_amount - fee_sol)
        .ok_or(LaunchpadError::MathOverflow)?;
    curve_state.virtual_token_reserves = curve_state
        .virtual_token_reserves
        .checked_sub(tokens_out)
        .ok_or(LaunchpadError::MathOverflow)?;
    curve_state.total_raised = curve_state
        .total_raised
        .checked_add(args.sol_amount)
        .ok_or(LaunchpadError::MathOverflow)?;

    position.amount_bought = position
        .amount_bought
        .checked_add(tokens_out)
        .ok_or(LaunchpadError::MathOverflow)?;
    position.amount_held = position
        .amount_held
        .checked_add(tokens_out)
        .ok_or(LaunchpadError::MathOverflow)?;

    // 6. 毕业门槛检测 (满 85 SOL)
    if is_graduation_threshold_met(curve_state.total_raised) {
        curve_state.is_graduated = true;
        msg!(
            "🎓 [GRADUATION_EVENT] 代币 {} 已募集达 85 SOL，内盘关闭，已触发 DEX 流动性迁移！",
            curve_state.mint
        );
    }

    // 7. 抛出带 AI 思考理由的链上日志
    msg!(
        "📝 [AGENT_TRADE_EVENT] Agent: {}, Mint: {}, is_buy: true, sol: {}, tokens: {}, note: \"{}\"",
        passport.soul_domain,
        curve_state.mint,
        args.sol_amount,
        tokens_out,
        args.note
    );

    curve_state.serialize(&mut &mut bonding_curve_info.data.borrow_mut()[..])?;
    position.serialize(&mut &mut position_pda_info.data.borrow_mut()[..])?;

    Ok(())
}
