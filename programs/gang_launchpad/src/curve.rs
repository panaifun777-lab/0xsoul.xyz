use crate::error::LaunchpadError;
use crate::state::{
    ANTI_SNIPE_DECAY_SECONDS, ANTI_SNIPE_MAX_FEE_BPS, GRADUATION_TARGET_SOL,
    MAX_AGENT_HOLDING_CAP, TRADING_FEE_BPS,
};

/// 计算反狙击动态手续费基点 (bps)
/// 规则:
/// 1. 创作者豁免反狙击高额手续费，享受基础费率 1% (100 bps)
/// 2. 曲线创建后 120 秒内，手续费率从 50% (5000 bps) 线性衰减至 1% (100 bps)
/// 3. 超过 120 秒后，维持 1% (100 bps) 基础费率
pub fn calculate_dynamic_fee_bps(
    created_at: i64,
    current_time: i64,
    is_creator: bool,
) -> u64 {
    if is_creator {
        return TRADING_FEE_BPS; // 创作者首发豁免，基础 100 bps (1%)
    }

    let elapsed = current_time.saturating_sub(created_at);
    if elapsed >= ANTI_SNIPE_DECAY_SECONDS {
        return TRADING_FEE_BPS; // 120秒后衰减完成，恢复 1%
    }

    // 线性平滑衰减公式: 100 + (5000 - 100) * (120 - elapsed) / 120
    let delta = (ANTI_SNIPE_MAX_FEE_BPS - TRADING_FEE_BPS) as i64;
    let remaining_time = (ANTI_SNIPE_DECAY_SECONDS - elapsed) as i64;
    let extra_fee = (delta * remaining_time) / ANTI_SNIPE_DECAY_SECONDS;
    (TRADING_FEE_BPS as i64 + extra_fee) as u64
}

/// 计算买入代币数量 (支持动态手续费率)
/// 公式: (V_sol + S_net) * (V_token - T_out) = k
/// T_out = V_token - k / (V_sol + S_net)
pub fn calculate_buy_tokens_out_with_fee(
    virtual_sol: u64,
    virtual_token: u64,
    sol_amount: u64,
    fee_bps: u64,
) -> Result<(u64, u64), LaunchpadError> {
    let fee_sol = (sol_amount as u128 * fee_bps as u128 / 10000) as u64;
    let net_sol = sol_amount
        .checked_sub(fee_sol)
        .ok_or(LaunchpadError::MathOverflow)?;

    let v_sol = virtual_sol as u128;
    let v_tok = virtual_token as u128;
    let k = v_sol
        .checked_mul(v_tok)
        .ok_or(LaunchpadError::MathOverflow)?;

    let new_sol = v_sol
        .checked_add(net_sol as u128)
        .ok_or(LaunchpadError::MathOverflow)?;

    let new_token = k
        .checked_div(new_sol)
        .ok_or(LaunchpadError::MathOverflow)?;

    let tokens_out = v_tok
        .checked_sub(new_token)
        .ok_or(LaunchpadError::MathOverflow)? as u64;

    Ok((tokens_out, fee_sol))
}

/// 兼容传统接口：默认 1% 费率
pub fn calculate_buy_tokens_out(
    virtual_sol: u64,
    virtual_token: u64,
    sol_amount: u64,
) -> Result<(u64, u64), LaunchpadError> {
    calculate_buy_tokens_out_with_fee(virtual_sol, virtual_token, sol_amount, TRADING_FEE_BPS)
}

/// 计算卖出代币换回的 SOL 数量
/// 公式: (V_token + T) * (V_sol - S_gross) = k
/// S_gross = V_sol - k / (V_token + T)
pub fn calculate_sell_sol_out(
    virtual_sol: u64,
    virtual_token: u64,
    token_amount: u64,
) -> Result<(u64, u64), LaunchpadError> {
    let v_sol = virtual_sol as u128;
    let v_tok = virtual_token as u128;
    let k = v_sol
        .checked_mul(v_tok)
        .ok_or(LaunchpadError::MathOverflow)?;

    let new_tok = v_tok
        .checked_add(token_amount as u128)
        .ok_or(LaunchpadError::MathOverflow)?;

    let new_sol = k
        .checked_div(new_tok)
        .ok_or(LaunchpadError::MathOverflow)?;

    let gross_sol = v_sol
        .checked_sub(new_sol)
        .ok_or(LaunchpadError::MathOverflow)? as u64;

    // 扣除 1% 平台手续费
    let fee_sol = (gross_sol as u128 * TRADING_FEE_BPS as u128 / 10000) as u64;
    let net_sol = gross_sol
        .checked_sub(fee_sol)
        .ok_or(LaunchpadError::MathOverflow)?;

    Ok((net_sol, fee_sol))
}

/// 验证单 Agent 1% 限购约束
pub fn verify_one_percent_holding_cap(
    current_held: u64,
    additional_tokens: u64,
) -> Result<(), LaunchpadError> {
    let total = current_held
        .checked_add(additional_tokens)
        .ok_or(LaunchpadError::MathOverflow)?;

    if total > MAX_AGENT_HOLDING_CAP {
        return Err(LaunchpadError::ExceedsOnePercentCap);
    }
    Ok(())
}

/// 检查是否达到 85 SOL 毕业门槛
pub fn is_graduation_threshold_met(total_raised: u64) -> bool {
    total_raised >= GRADUATION_TARGET_SOL
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::{VIRTUAL_SOL_RESERVES, VIRTUAL_TOKEN_RESERVES};

    #[test]
    fn test_buy_and_sell_curve_pricing() {
        let (tokens_out, fee) = calculate_buy_tokens_out(
            VIRTUAL_SOL_RESERVES,
            VIRTUAL_TOKEN_RESERVES,
            1_000_000_000, // 1 SOL
        )
        .unwrap();

        assert!(tokens_out > 0);
        assert_eq!(fee, 10_000_000); // 0.01 SOL

        let (sol_back, sell_fee) = calculate_sell_sol_out(
            VIRTUAL_SOL_RESERVES + 990_000_000,
            VIRTUAL_TOKEN_RESERVES - tokens_out,
            tokens_out,
        )
        .unwrap();

        assert!(sol_back > 0);
        assert!(sell_fee > 0);
        // 经过两次 1% 扣费，卖出所得应略低于买入投入的 1 SOL
        assert!(sol_back < 1_000_000_000);
    }

    #[test]
    fn test_holding_cap_enforcement() {
        assert!(verify_one_percent_holding_cap(5_000_000 * 1_000_000, 4_000_000 * 1_000_000).is_ok());
        // 超过 10,000,000 则报错
        assert_eq!(
            verify_one_percent_holding_cap(8_000_000 * 1_000_000, 3_000_000 * 1_000_000),
            Err(LaunchpadError::ExceedsOnePercentCap)
        );
    }

    #[test]
    fn test_anti_snipe_decay_and_creator_exemption() {
        let created_at = 1000;

        // 1. 创作者无论何时都享受 1% (100 bps) 基础费率豁免
        assert_eq!(calculate_dynamic_fee_bps(created_at, 1000, true), 100);
        assert_eq!(calculate_dynamic_fee_bps(created_at, 1050, true), 100);
        assert_eq!(calculate_dynamic_fee_bps(created_at, 1200, true), 100);

        // 2. 开盘 0 秒 (普通买家/狙击机器人): 50% (5000 bps)
        assert_eq!(calculate_dynamic_fee_bps(created_at, 1000, false), 5000);

        // 3. 开盘 60 秒 (衰减一半): 100 + (4900 * 60 / 120) = 2550 bps (25.5%)
        assert_eq!(calculate_dynamic_fee_bps(created_at, 1060, false), 2550);

        // 4. 开盘 120 秒及之后: 完全衰减至 1% (100 bps)
        assert_eq!(calculate_dynamic_fee_bps(created_at, 1120, false), 100);
        assert_eq!(calculate_dynamic_fee_bps(created_at, 2000, false), 100);

        // 5. 校验 0 秒与 120 秒买入扣费差异
        let (tokens_0s, fee_0s) = calculate_buy_tokens_out_with_fee(
            VIRTUAL_SOL_RESERVES,
            VIRTUAL_TOKEN_RESERVES,
            1_000_000_000, // 1 SOL
            5000,          // 50%
        )
        .unwrap();
        assert_eq!(fee_0s, 500_000_000); // 0.5 SOL 手续费

        let (tokens_120s, fee_120s) = calculate_buy_tokens_out_with_fee(
            VIRTUAL_SOL_RESERVES,
            VIRTUAL_TOKEN_RESERVES,
            1_000_000_000, // 1 SOL
            100,           // 1%
        )
        .unwrap();
        assert_eq!(fee_120s, 10_000_000); // 0.01 SOL 手续费
        assert!(tokens_120s > tokens_0s);
    }
}
