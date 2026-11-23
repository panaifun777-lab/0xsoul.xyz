#!/bin/sh
# ============================================================================
# scripts/setup_spl_policy.sh  ——  【骨架 / 未执行】
# ============================================================================
# 用途：用 tk CLI 创建「Jupiter/SPL 买币」ALLOW 策略（create-batch）。
# 状态：只产出骨架，未执行、未上传、未碰真实密钥、未改生产。运行前必须人工评审。
#
# 已验证的基线（来自 agent-sol-transfer-guarded-v1 实测）：
#   - consensus 必须用 approvers.filter(...).count() >= N 的标准多签写法；
#     用两个 count 做 && 会在「提交」这一步就被拒。
#   - condition 可用 solana.tx.* 字段。
#
# 关键警告（详见 scripts/SPL_POLICY_NOTES.md）：
#   - solana.tx 语言里【没有】滑点字段，也没有 min-out / quote / price / deadline 字段。
#     「滑点受控」无法写进 Turnkey 策略，只能靠网关层（Jupiter quote + minOut 校验）。
#   - mint 只在 TransferChecked / TransferCheckedWithFee 指令里暴露；
#     简单 Transfer 的 token_mint 为空。Jupiter swap 的代币流多发生在 CPI 内部，
#     top-level spl_transfers 可能为空或只含 wSOL —— mint allowlist 对 swap 不可靠。
#   - && / || 不会短路，所有分支都会被求值；不要在给 V0 swap 用的策略里
#     访问 V1-only 字段（priority_fee_lamports / compute_unit_limit 等），否则求值报错。
#
# 占位符（运行前必须替换，本文件不替你替换）：
#   {{MINT}}                 目标代币 mint
#   {{AGENT_USER_ID}}        agent user id（提交方一票）
#   {{OWNER_USER_ID}}        owner user id（批准方一票）
#   {{WALLET_ID}}            Turnkey wallet id
#   {{AGENT_WALLET_ADDRESS}} agent 钱包地址（transfer.from 约束，可选但推荐）
#   {{TK_PROFILE}}           有建策略权限的 profile（root/quorum，不是 agent profile）
# ============================================================================

set -eu

TK_BIN="${TK_BIN:-tk}"
PROFILE="${TK_PROFILE:-{{TK_PROFILE}}}"
J='--message-format json'
OUT_DIR="${OUT_DIR:-$(pwd)}"
INPUT_FILE="${OUT_DIR}/spl_policy_input.json"

echo "=== 生成策略输入 JSON（模板，含占位符）==="
# 说明：create-batch 的 input-file 结构按官方 CreatePoliciesIntent 构造：
#   { "policies": [ { policyName, effect, condition, consensus, notes } ] }
# 该 CLI 子命令的 input-file 精确格式未在公开 CLI 文档出现，
# 上线前请在 VPS 上先跑 `tk policy create-batch --help` 核对（本脚本不会执行）。
cat > "$INPUT_FILE" <<'JSON'
{
  "policies": [
    {
      "policyName": "agent-spl-jupiter-buy-guarded-v1",
      "effect": "EFFECT_ALLOW",
      "notes": "SKELETON - 未验证。program allowlist + 粗粒度金额上限 + 尽力而为 mint 约束 + 2-of-N 多签；滑点不在此策略表达能力内，必须由网关层保证。",
      "consensus": "approvers.filter(user, user.id in ['{{AGENT_USER_ID}}', '{{OWNER_USER_ID}}']).count() >= 2",
      "condition": "wallet.id == '{{WALLET_ID}}' && solana.tx.program_keys.all(p, p in ['11111111111111111111111111111111', 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb', 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL', 'ComputeBudget111111111111111111111111111111', 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4']) && solana.tx.transfers.count() <= 1 && solana.tx.transfers.all(t, t.from == '{{AGENT_WALLET_ADDRESS}}' && t.amount > 0 && t.amount <= 1500000000) && solana.tx.spl_transfers.count() > 0 && solana.tx.spl_transfers.all(t, t.token_mint == '{{MINT}}' || t.token_mint == '')"
    }
  ]
}
JSON

echo "已写入 $INPUT_FILE"

echo "=== 占位符守卫：未替换完则拒绝提交 ==="
if grep -q '{{' "$INPUT_FILE"; then
  echo "ERROR: $INPUT_FILE 仍含 {{...}} 占位符；请先人工替换 {{MINT}} / {{AGENT_USER_ID}} / {{OWNER_USER_ID}} / {{WALLET_ID}} / {{AGENT_WALLET_ADDRESS}} / {{TK_PROFILE}}。" >&2
  exit 1
fi

# 更严格（但 Jupiter swap 几乎必然不满足）的 mint 变体，仅供对照，不要直接启用：
#   ... && solana.tx.instructions.count() == solana.tx.spl_transfers.count()
#       && solana.tx.spl_transfers.all(t, t.token_mint == '{{MINT}}')
# 原因：swap 有 ComputeBudget/ATA/Jupiter route 等非 SPL-transfer 指令，
#       instructions.count() 不会等于 spl_transfers.count()。

# 滑点：solana.tx 无对应字段。若要「尽量贴近」，唯一可调的是用 instructions[i].instruction_data_hex
# 锁定某一条已报价交易的 hex —— 但报价每次不同，等价于把策略绑死到单笔交易，不可作为通用方案。
# 不要在此处伪造 slippage / minOut 字段：策略引擎不认识它们，会直接编译/求值失败。

echo "=== 提交前 dry-run（人工确认后再解除注释）==="
# "$TK_BIN" --profile "$PROFILE" $J policy list
# "$TK_BIN" --profile "$PROFILE" $J policy create-batch --input-file "$INPUT_FILE"
echo "骨架完成：未执行 tk create-batch。请替换占位符、核对 --help、在 devnet 用真实 swap 验证后再考虑启用。"
