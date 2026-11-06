pub mod curve;
pub mod error;
pub mod instructions;
pub mod state;

use borsh::BorshDeserialize;
use solana_program::{
    account_info::AccountInfo,
    entrypoint,
    entrypoint::ProgramResult,
    msg,
    program_error::ProgramError,
    pubkey::Pubkey,
};

use instructions::*;

#[derive(Debug)]
pub enum LaunchpadInstruction {
    RegisterPassport(RegisterPassportArgs),
    BuyCurve(BuyCurveArgs),
    SellCurve(SellCurveArgs),
    ContributeFairMint(ContributeFairMintArgs),
    RefundFairMint { current_slot: u64 },
    GraduateToDex(GraduateToDexArgs),
    InitCurve(InitCurveArgs),
    CreateToken(CreateTokenArgs),
}

entrypoint!(process_instruction);

pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    if instruction_data.is_empty() {
        return Err(ProgramError::InvalidInstructionData);
    }

    let instruction_tag = instruction_data[0];
    let payload = &instruction_data[1..];

    match instruction_tag {
        0 => {
            let args = RegisterPassportArgs::try_from_slice(payload)
                .map_err(|_| ProgramError::InvalidInstructionData)?;
            process_register_passport(program_id, accounts, args)
        }
        1 => {
            let args = BuyCurveArgs::try_from_slice(payload)
                .map_err(|_| ProgramError::InvalidInstructionData)?;
            process_buy_curve(program_id, accounts, args)
        }
        2 => {
            let args = SellCurveArgs::try_from_slice(payload)
                .map_err(|_| ProgramError::InvalidInstructionData)?;
            process_sell_curve(program_id, accounts, args)
        }
        3 => {
            let args = ContributeFairMintArgs::try_from_slice(payload)
                .map_err(|_| ProgramError::InvalidInstructionData)?;
            process_contribute_fair_mint(program_id, accounts, args)
        }
        4 => {
            if payload.len() < 8 {
                return Err(ProgramError::InvalidInstructionData);
            }
            let current_slot = u64::from_le_bytes(
                payload[0..8]
                    .try_into()
                    .map_err(|_| ProgramError::InvalidInstructionData)?,
            );
            process_refund_fair_mint(program_id, accounts, current_slot)
        }
        5 => {
            let args = GraduateToDexArgs::try_from_slice(payload)
                .map_err(|_| ProgramError::InvalidInstructionData)?;
            process_graduate_to_dex(program_id, accounts, args)
        }
        6 => {
            let args = InitCurveArgs::try_from_slice(payload)
                .map_err(|_| ProgramError::InvalidInstructionData)?;
            process_init_curve(program_id, accounts, args)
        }
        7 => {
            let args = CreateTokenArgs::try_from_slice(payload)
                .map_err(|_| ProgramError::InvalidInstructionData)?;
            process_create_token(program_id, accounts, args)
        }
        _ => {
            msg!("未知的 Instruction Tag: {}", instruction_tag);
            Err(ProgramError::InvalidInstructionData)
        }
    }
}
