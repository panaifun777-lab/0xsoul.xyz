use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint::ProgramResult,
    msg,
    program_error::ProgramError,
    pubkey::Pubkey,
};

use crate::state::AgentPassport;

#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub struct RegisterPassportArgs {
    pub soul_domain: String, // 例如 "alpha.soul"
}

pub fn process_register_passport(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    args: RegisterPassportArgs,
) -> ProgramResult {
    let account_info_iter = &mut accounts.iter();

    let signer_info = next_account_info(account_info_iter)?;
    let passport_pda_info = next_account_info(account_info_iter)?;
    let _system_program_info = next_account_info(account_info_iter)?;

    if !signer_info.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }

    if args.soul_domain.len() > 64 {
        return Err(ProgramError::InvalidArgument);
    }

    let (expected_pda, bump) =
        Pubkey::find_program_address(&[b"agent_passport", signer_info.key.as_ref()], program_id);

    if expected_pda != *passport_pda_info.key {
        return Err(ProgramError::InvalidSeeds);
    }

    let passport = AgentPassport {
        bump,
        authority: *signer_info.key,
        soul_domain: args.soul_domain,
        registered_at: 0,
        tokens_launched: 0,
        tokens_graduated: 0,
        total_volume_sol: 0,
        is_banned: false,
        reputation_score: 1000,
    };

    passport.serialize(&mut &mut passport_pda_info.data.borrow_mut()[..])?;
    msg!("Agent Passport successfully registered for: {}", signer_info.key);

    Ok(())
}
