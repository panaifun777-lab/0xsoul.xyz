use anchor_lang::prelude::*;
use anchor_lang::system_program;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{self, Burn, SyncNative, Token, TokenAccount},
    token_interface::{Mint as MintInterface, TokenAccount as TokenAccountInterface, TokenInterface},
};
use raydium_cp_swap::{
    cpi,
    program::RaydiumCpSwap,
    states::{AmmConfig, OBSERVATION_SEED, POOL_LP_MINT_SEED, POOL_SEED, POOL_VAULT_SEED},
};

pub const TARGET_SOL_LAMPORTS: u64 = 50_000_000_000;      // 50 SOL 满标线
pub const MIGRATION_FEE_RESERVE: u64 = 500_000_000;       // 预留 0.5 SOL 支付 Raydium 建池费与租金
pub const DEX_RESERVED_TOKENS: u64 = 200_000_000_000_000; // 2亿枚 $0x.SOUL (Decimals = 6)

pub fn migrate_to_raydium(ctx: Context<MigrateToRaydium>) -> Result<()> {
    let curve = &mut ctx.accounts.bonding_curve;

    require!(curve.is_completed, ErrorCode::CurveNotCompleted);
    require!(!curve.is_migrated, ErrorCode::AlreadyMigrated);
    require!(
        curve.real_sol_reserves >= TARGET_SOL_LAMPORTS,
        ErrorCode::InsufficientSolForMigration
    );

    curve.is_migrated = true;

    let mint_key = curve.mint;
    let signer_seeds: &[&[&[u8]]] = &[&[
        b"bonding_curve",
        mint_key.as_ref(),
        &[curve.bump],
    ]];

    let init_sol_amount = TARGET_SOL_LAMPORTS
        .checked_sub(MIGRATION_FEE_RESERVE)
        .unwrap();
    let init_token_amount = DEX_RESERVED_TOKENS;

    let is_token0_wsol = ctx.accounts.token_0_mint.key() == spl_token::native_mint::ID;

    let (wsol_account_info, init_amount_0, init_amount_1) = if is_token0_wsol {
        (
            ctx.accounts.creator_token_0.to_account_info(),
            init_sol_amount,
            init_token_amount,
        )
    } else {
        (
            ctx.accounts.creator_token_1.to_account_info(),
            init_token_amount,
            init_sol_amount,
        )
    };

    system_program::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: curve.to_account_info(),
                to: wsol_account_info.clone(),
            },
            signer_seeds,
        ),
        init_sol_amount,
    )?;

    token::sync_native(CpiContext::new(
        ctx.accounts.token_program.to_account_info(),
        SyncNative {
            account: wsol_account_info,
        },
    ))?;

    let cpi_accounts = cpi::accounts::Initialize {
        creator: curve.to_account_info(),
        amm_config: ctx.accounts.amm_config.to_account_info(),
        authority: ctx.accounts.authority.to_account_info(),
        pool_state: ctx.accounts.pool_state.to_account_info(),
        token_0_mint: ctx.accounts.token_0_mint.to_account_info(),
        token_1_mint: ctx.accounts.token_1_mint.to_account_info(),
        lp_mint: ctx.accounts.lp_mint.to_account_info(),
        creator_token_0: ctx.accounts.creator_token_0.to_account_info(),
        creator_token_1: ctx.accounts.creator_token_1.to_account_info(),
        creator_lp_token: ctx.accounts.creator_lp_token.to_account_info(),
        token_0_vault: ctx.accounts.token_0_vault.to_account_info(),
        token_1_vault: ctx.accounts.token_1_vault.to_account_info(),
        create_pool_fee: ctx.accounts.create_pool_fee.to_account_info(),
        observation_state: ctx.accounts.observation_state.to_account_info(),
        token_program: ctx.accounts.token_program.to_account_info(),
        token_0_program: ctx.accounts.token_0_program.to_account_info(),
        token_1_program: ctx.accounts.token_1_program.to_account_info(),
        associated_token_program: ctx.accounts.associated_token_program.to_account_info(),
        system_program: ctx.accounts.system_program.to_account_info(),
        rent: ctx.accounts.rent.to_account_info(),
    };

    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.cp_swap_program.to_account_info(),
        cpi_accounts,
        signer_seeds,
    );

    cpi::initialize(cpi_ctx, init_amount_0, init_amount_1, 0)?;

    ctx.accounts.creator_lp_token.reload()?;
    let lp_balance = ctx.accounts.creator_lp_token.amount;
    require!(lp_balance > 0, ErrorCode::ZeroLpMinted);

    token::burn(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Burn {
                mint: ctx.accounts.lp_mint.to_account_info(),
                from: ctx.accounts.creator_lp_token.to_account_info(),
                authority: curve.to_account_info(),
            },
            signer_seeds,
        ),
        lp_balance,
    )?;

    msg!("0x.SOUL Graduated! Pool initialized & {} LP tokens permanently burned.", lp_balance);
    Ok(())
}

#[derive(Accounts)]
pub struct MigrateToRaydium<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        mut,
        seeds = [b"bonding_curve", bonding_curve.mint.as_ref()],
        bump = bonding_curve.bump,
    )]
    pub bonding_curve: Box<Account<'info, crate::state::BondingCurve>>,

    pub cp_swap_program: Program<'info, RaydiumCpSwap>,

    pub amm_config: Box<Account<'info, AmmConfig>>,

    /// CHECK: Raydium auth
    #[account(
        seeds = [raydium_cp_swap::AUTH_SEED.as_bytes()],
        seeds::program = cp_swap_program.key(),
        bump,
    )]
    pub authority: UncheckedAccount<'info>,

    /// CHECK: pool state
    #[account(
        mut,
        seeds = [
            POOL_SEED.as_bytes(),
            amm_config.key().as_ref(),
            token_0_mint.key().as_ref(),
            token_1_mint.key().as_ref(),
        ],
        seeds::program = cp_swap_program.key(),
        bump,
    )]
    pub pool_state: UncheckedAccount<'info>,

    #[account(
        constraint = token_0_mint.key() < token_1_mint.key() @ ErrorCode::InvalidTokenMintOrder
    )]
    pub token_0_mint: Box<InterfaceAccount<'info, MintInterface>>,

    pub token_1_mint: Box<InterfaceAccount<'info, MintInterface>>,

    /// CHECK: lp mint
    #[account(
        mut,
        seeds = [
            POOL_LP_MINT_SEED.as_bytes(),
            pool_state.key().as_ref(),
        ],
        seeds::program = cp_swap_program.key(),
        bump,
    )]
    pub lp_mint: UncheckedAccount<'info>,

    #[account(mut)]
    pub creator_token_0: Box<InterfaceAccount<'info, TokenAccountInterface>>,

    #[account(mut)]
    pub creator_token_1: Box<InterfaceAccount<'info, TokenAccountInterface>>,

    #[account(mut)]
    pub creator_lp_token: Box<Account<'info, TokenAccount>>,

    /// CHECK: token 0 vault
    #[account(
        mut,
        seeds = [
            POOL_VAULT_SEED.as_bytes(),
            pool_state.key().as_ref(),
            token_0_mint.key().as_ref(),
        ],
        seeds::program = cp_swap_program.key(),
        bump,
    )]
    pub token_0_vault: UncheckedAccount<'info>,

    /// CHECK: token 1 vault
    #[account(
        mut,
        seeds = [
            POOL_VAULT_SEED.as_bytes(),
            pool_state.key().as_ref(),
            token_1_mint.key().as_ref(),
        ],
        seeds::program = cp_swap_program.key(),
        bump,
    )]
    pub token_1_vault: UncheckedAccount<'info>,

    /// CHECK: pool fee
    #[account(mut)]
    pub create_pool_fee: UncheckedAccount<'info>,

    /// CHECK: observation state
    #[account(
        mut,
        seeds = [
            OBSERVATION_SEED.as_bytes(),
            pool_state.key().as_ref(),
        ],
        seeds::program = cp_swap_program.key(),
        bump,
    )]
    pub observation_state: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
    pub token_0_program: Interface<'info, TokenInterface>,
    pub token_1_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[error_code]
pub enum ErrorCode {
    #[msg("Bonding curve has not reached 50 SOL target yet.")]
    CurveNotCompleted,
    #[msg("Liquidity has already been migrated to Raydium.")]
    AlreadyMigrated,
    #[msg("Insufficient SOL in vault for migration.")]
    InsufficientSolForMigration,
    #[msg("token_0_mint must be lexicographically smaller than token_1_mint.")]
    InvalidTokenMintOrder,
    #[msg("Zero LP tokens minted during initialization.")]
    ZeroLpMinted,
}
