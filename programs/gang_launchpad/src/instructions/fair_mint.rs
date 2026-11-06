use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint::ProgramResult,
    msg,
    program_error::ProgramError,
    pubkey::Pubkey,
};

use crate::error::LaunchpadError;
use crate::state::{AgentPassport, FairMintState};

#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub struct ContributeFairMintArgs {
    pub sol_amount: u64,
    pub note: String,
}

pub fn process_contribute_fair_mint(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    args: ContributeFairMintArgs,
) -> ProgramResult {
    let account_info_iter = &mut accounts.iter();

    let signer_info = next_account_info(account_info_iter)?;
    let passport_pda_info = next_account_info(account_info_iter)?;
    let fair_mint_info = next_account_info(account_info_iter)?;

    if !signer_info.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }

    // 1. 门禁检查
    let (expected_passport_pda, _) =
        Pubkey::find_program_address(&[b"agent_passport", signer_info.key.as_ref()], program_id);
    if expected_passport_pda != *passport_pda_info.key {
        return Err(LaunchpadError::AgentPassportMissing.into());
    }

    let passport = AgentPassport::try_from_slice(&passport_pda_info.data.borrow())?;
    if passport.is_banned {
        return Err(LaunchpadError::AgentBanned.into());
    }

    // 2. 状态检查
    let mut fair_mint = FairMintState::try_from_slice(&fair_mint_info.data.borrow())?;
    if fair_mint.is_finalized || fair_mint.is_refunded {
        return Err(LaunchpadError::TokenAlreadyGraduated.into());
    }

    // 3. 单 Agent 认购限额校验
    if args.sol_amount > fair_mint.max_sol_per_agent {
        return Err(LaunchpadError::ExceedsOnePercentCap.into());
    }

    // 4. 累计筹款更新
    fair_mint.total_contributed_sol = fair_mint
        .total_contributed_sol
        .checked_add(args.sol_amount)
        .ok_or(LaunchpadError::MathOverflow)?;

    msg!(
        "🎯 [FAIR_MINT_CONTRIBUTION] Agent: {}, Contributed: {} SOL, Note: \"{}\"",
        passport.soul_domain,
        args.sol_amount,
        args.note
    );

    // 若达到募资硬顶，自动结盘
    if fair_mint.total_contributed_sol >= fair_mint.target_hard_cap_sol {
        fair_mint.is_finalized = true;
        msg!("🎉 [FAIR_MINT_FINALIZED] 达到募集硬顶，打新顺利结盘，准备开盘发放代币！");
    }

    fair_mint.serialize(&mut &mut fair_mint_info.data.borrow_mut()[..])?;

    Ok(())
}

pub fn process_refund_fair_mint(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    current_slot: u64,
) -> ProgramResult {
    let account_info_iter = &mut accounts.iter();

    let signer_info = next_account_info(account_info_iter)?;
    let fair_mint_info = next_account_info(account_info_iter)?;

    if !signer_info.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }

    let mut fair_mint = FairMintState::try_from_slice(&fair_mint_info.data.borrow())?;
    if fair_mint.is_finalized {
        return Err(LaunchpadError::InvalidRefundState.into());
    }

    // 必须超过设定的 deadline_slot 且募资未满，方可激活无损退款
    if current_slot <= fair_mint.deadline_slot {
        return Err(LaunchpadError::InvalidRefundState.into());
    }

    fair_mint.is_refunded = true;
    msg!("💸 [FAIR_MINT_REFUND] 打新超时未达硬顶，已激活 Agent 全额 SOL 退还流程");

    fair_mint.serialize(&mut &mut fair_mint_info.data.borrow_mut()[..])?;

    Ok(())
}
