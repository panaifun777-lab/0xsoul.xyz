/**
 * 手机确认锁 — 阈值策略（单一数据源）
 *
 * 对应《0x.soul 手机确认锁落地方案》第 5 节。所有数字都是提案起点的默认値，
 * 可被环境变量覆盖；改阈值本身属于「强确认」动作（见 confirmation.ts）。
 *
 * 单位一律为 SOL，不随币价自动调整（PDF 第 5 节价格提示）。
 */
export interface ConfirmPolicy {
  /** 免确认单笔上限（SOL）。devnet / CONFIRM_ALL_CONFIRM=1 时强制为 0（全确认）。 */
  exemptSingleSol: number;
  /** 免确认日累计上限（SOL / 每只 agent / 每天）。 */
  dailyCumulativeSol: number;
  /** 强确认单笔线（SOL）。达到即强确认（二次复核）。 */
  strongSingleSol: number;
  /** 与金额无关、一律至少一点确认的动作类型；卖出/毕业/转账/改配置强制强确认。 */
  forcedStrongTypes: string[];
  /** 一点确认类型（达到即需手机一点确认，但未到强确认）。 */
  forcedSoftTypes: string[];
  /** 确认有效期（毫秒）。PDF 提案 3 分钟。 */
  validityMs: number;
  /** 滑点接近上限的警告阈值（百分比），命中即升一档到一点确认。 */
  slippageWarnPct: number;
  /** devnet 全确认 / CONFIRM_ALL_CONFIRM=1 时，免确认线视作 0。 */
  allConfirm: boolean;
}

const num = (key: string, fallback: number): number => {
  const v = process.env[key];
  if (!v) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const list = (key: string, fallback: string[]): string[] => {
  const v = process.env[key];
  if (!v) return fallback;
  return v
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
};

export function loadConfirmPolicy(): ConfirmPolicy {
  // devnet 或显式开关 -> 全确认（免确认线归零）
  const network = (process.env.SOLANA_NETWORK || '').toLowerCase();
  const allConfirm =
    network === 'devnet' || process.env.CONFIRM_ALL_CONFIRM === '1' || process.env.CONFIRM_ALL_CONFIRM === 'true';

  return {
    exemptSingleSol: allConfirm ? 0 : num('CONFIRM_EXEMPT_SOL', 0.1),
    dailyCumulativeSol: num('CONFIRM_DAILY_SOL', 0.5),
    strongSingleSol: num('CONFIRM_STRONG_SOL', 1.0),
    forcedStrongTypes: list('CONFIRM_FORCED_STRONG', ['sell', 'graduate', 'transfer', 'config']),
    forcedSoftTypes: list('CONFIRM_FORCED_SOFT', []),
    validityMs: num('CONFIRM_VALIDITY_MS', 180_000),
    slippageWarnPct: num('CONFIRM_SLIPPAGE_WARN_PCT', 5),
    allConfirm,
  };
}
