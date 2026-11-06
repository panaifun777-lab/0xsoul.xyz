use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct RegisterSoulIdentity<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: agent wallet
    pub agent: UncheckedAccount<'info>,

    #[account(
        init,
        payer = payer,
        space = 8 + SoulIdentity::INIT_SPACE,
        seeds = [b"soul_identity", agent.key().as_ref()],
        bump
    )]
    pub soul_identity: Box<Account<'info, SoulIdentity>>,

    pub system_program: Program<'info, System>,
}

#[account]
#[derive(InitSpace)]
pub struct SoulIdentity {
    pub owner: Pubkey,
    #[max_len(64)]
    pub domain_name: String,
    pub is_active: bool,
    pub bump: u8,
}

#[event]
pub struct SoulIdentityRegisteredEvent {
    pub owner: Pubkey,
    pub domain_name: String,
    pub timestamp: i64,
}

pub fn register_soul_identity(
    ctx: Context<RegisterSoulIdentity>,
    domain_name: String,
) -> Result<()> {
    require!(
        !domain_name.is_empty() && domain_name.as_bytes().len() <= 64,
        IdentityError::InvalidDomainLength
    );
    require!(
        domain_name.ends_with(".soul"),
        IdentityError::InvalidDomainSuffix
    );

    let identity = &mut ctx.accounts.soul_identity;
    let agent_key = ctx.accounts.agent.key();

    identity.owner = agent_key;
    identity.domain_name = domain_name.clone();
    identity.is_active = true;
    identity.bump = ctx.bumps.soul_identity;

    msg!("0x.SOUL Identity registered for Agent: {} with domain: {}", agent_key, domain_name);

    emit!(SoulIdentityRegisteredEvent {
        owner: agent_key,
        domain_name,
        timestamp: Clock::get()?.unix_timestamp,
    });

    Ok(())
}

#[error_code]
pub enum IdentityError {
    #[msg("Domain name length is invalid (must be between 1 and 64 bytes).")]
    InvalidDomainLength,
    #[msg("Domain name must strictly end with the .soul suffix.")]
    InvalidDomainSuffix,
}
