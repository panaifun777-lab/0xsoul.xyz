/**
 * 代币经济单一事实源（Tokenomics Single Source of Truth）
 *
 * 总供应以联合曲线实际使用的 1,073,000,000 枚为准（与 quant_runner 的
 * virtualToken 储备、以及对外披露口径一致）。单钱包持仓硬顶统一为总供应的 1%。
 *
 * 任何引用「总供应」或「1% 上限」的代码都必须从这里取数，禁止再硬编码
 * 10_000_000 / 1_000_000_000 等散落常量，避免再次出现分母不统一的硬伤。
 */

/** 代币总供应（枚） */
export const TOTAL_SUPPLY_TOKENS = 1_073_000_000;

/** 单钱包持仓硬顶 = 总供应 × 1% = 10,730,000 枚 */
export const MAX_WALLET_CAP_TOKENS = TOTAL_SUPPLY_TOKENS / 100;
