use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{
        self, spl_token::instruction::AuthorityType, Mint, MintTo, SetAuthority, Token,
        TokenAccount,
    },
};

pub const TOTAL_SUPPLY: u64 = 1_000_000_000_000_000;          // 10亿枚 (Decimals = 6)
pub const INITIAL_REAL_TOKEN_RESERVES: u64 = 800_000_000_000_000; // 8亿枚用于内盘销售
pub const INITIAL_VIRTUAL_TOKEN: u64 = 1_073_000_000_000_000; // 10.73亿虚拟 Token 储备
pub const INITIAL_VIRTUAL_SOL: u64 = 17_062_500_000;          // 17.0625 SOL 虚拟储备

pub fn initialize_curve(ctx: Context<InitializeCurve>) -> Result<()> {
    let curve = &mut ctx.accounts.bonding_curve;

    curve.mint = ctx.accounts.mint.key();
    curve.creator = ctx.accounts.creator.key();
    curve.virtual_token_reserves = INITIAL_VIRTUAL_TOKEN;
    curve.virtual_sol_reserves = INITIAL_VIRTUAL_SOL;
    curve.real_token_reserves = INITIAL_REAL_TOKEN_RESERVES;
    curve.real_sol_reserves = 0;
    curve.is_completed = false;
    curve.is_migrated = false;
    curve.bump = ctx.bumps.bonding_curve;

    let mint_key = ctx.accounts.mint.key();
    let signer_seeds: &[&[&[u8]]] = &[&[
        b"bonding_curve",
        mint_key.as_ref(),
        &[curve.bump],
    ]];

    token::mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            MintTo {
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.curve_token_vault.to_account_info(),
                authority: curve.to_account_info(),
            },
            signer_seeds,
        ),
        TOTAL_SUPPLY,
    )?;

    token::set_authority(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            SetAuthority {
                current_authority: curve.to_account_info(),
                account_or_mint: ctx.accounts.mint.to_account_info(),
            },
            signer_seeds,
        ),
        AuthorityType::MintTokens,
        None,
    )?;

    msg!(
        "0x.SOUL Bonding Curve Initialized! Vaults pre-warmed (Token Vault: {}, WSOL Vault: {})",
        ctx.accounts.curve_token_vault.key(),
        ctx.accounts.curve_wsol_vault.key()
    );

    Ok(())
}

#[derive(Accounts)]
pub struct InitializeCurve<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(
        init,
        payer = creator,
        mint::decimals = 6,
        mint::authority = bonding_curve,
    )]
    pub mint: Box<Account<'info, Mint>>,

    #[account(
        address = anchor_spl::token::spl_token::native_mint::ID @ ErrorCode::InvalidNativeMint
    )]
    pub wsol_mint: Box<Account<'info, Mint>>,

    #[account(
        init,
        payer = creator,
        space = 8 + crate::state::BondingCurve::INIT_SPACE,
        seeds = [b"bonding_curve", mint.key().as_ref()],
        bump
    )]
    pub bonding_curve: Box<Account<'info, crate::state::BondingCurve>>,

    #[account(
        init,
        payer = creator,
        associated_token::mint = mint,
        associated_token::authority = bonding_curve,
    )]
    pub curve_token_vault: Box<Account<'info, TokenAccount>>,

    #[account(
        init,
        payer = creator,
        associated_token::mint = wsol_mint,
        associated_token::authority = bonding_curve,
    )]
    pub curve_wsol_vault: Box<Account<'info, TokenAccount>>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[error_code]
pub enum ErrorCode {
    #[msg("The provided WSOL mint address does not match spl_token::native_mint::ID.")]
    InvalidNativeMint,
}
