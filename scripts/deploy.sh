#!/usr/bin/env bash
# ============================================================================
# GANG.SOUL 一键链上部署脚本 (Devnet / Mainnet)
#
# 功能：
#   1. 检测并引导安装 Solana CLI / Anchor CLI
#   2. 构建真实 BPF 字节码（本地工具链优先，回退 Docker）
#   3. 部署合约到指定集群
#   4. 初始化 GlobalConfig PDA 并登记 fee_receiver
#   5. 输出可复制的验证命令
#
# 用法：
#   ./scripts/deploy.sh devnet              # 部署到 Devnet
#   ./scripts/deploy.sh mainnet             # 部署到 Mainnet（需确认）
#   ./scripts/deploy.sh devnet --skip-build # 跳过构建，直接用已有 .so
#
# 前置要求：
#   - 一个已充值 SOL 的钱包（Devnet 可空投，Mainnet 需真实资金）
#   - 构建需 Solana CLI 或 Docker
# ============================================================================

set -euo pipefail

CLUSTER="${1:-devnet}"
SKIP_BUILD="${2:-}"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

log_info()  { echo -e "${CYAN}[INFO]${NC} $*"; }
log_ok()    { echo -e "${GREEN}[ OK ]${NC} $*"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
log_err()   { echo -e "${RED}[FAIL]${NC} $*"; }

# ---------------------------------------------------------------------------
# 0. 参数校验
# ---------------------------------------------------------------------------
case "$CLUSTER" in
  devnet|mainnet|mainnet-beta|localnet) ;;
  *) log_err "未知集群: $CLUSTER（可选：devnet / mainnet / localnet）"; exit 1 ;;
esac

if [ "$CLUSTER" = "mainnet" ] || [ "$CLUSTER" = "mainnet-beta" ]; then
  log_warn "════════════════════════════════════════════════════════"
  log_warn "  即将部署到 MAINNET，将消耗真实 SOL 且不可撤销"
  log_warn "════════════════════════════════════════════════════════"
  read -r -p "确认继续？输入 YES 大写确认: " CONFIRM
  [ "$CONFIRM" = "YES" ] || { log_err "已取消"; exit 1; }
fi

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

PROGRAM_DIR="programs/gang_launchpad"
SO_PATH="target/deploy/gang_launchpad.so"

echo "============================================================"
echo "  GANG.SOUL 链上部署流水线"
echo "  集群: $CLUSTER"
echo "  工作目录: $PROJECT_ROOT"
echo "============================================================"

# ---------------------------------------------------------------------------
# 1. 工具链检测
# ---------------------------------------------------------------------------
log_info "步骤 1/6：检测工具链..."

HAS_SOLANA=false
HAS_ANCHOR=false
HAS_DOCKER=false
HAS_SBF=false

command -v solana        >/dev/null 2>&1 && HAS_SOLANA=true
command -v anchor        >/dev/null 2>&1 && HAS_ANCHOR=true
command -v docker        >/dev/null 2>&1 && HAS_DOCKER=true
command -v cargo-build-sbf >/dev/null 2>&1 && HAS_SBF=true

$HAS_SOLANA && log_ok "Solana CLI: $(solana --version 2>&1 | head -1)" \
             || log_warn "Solana CLI 未安装"
$HAS_ANCHOR && log_ok "Anchor CLI: $(anchor --version 2>&1 | head -1)" \
             || log_warn "Anchor CLI 未安装"
$HAS_DOCKER && log_ok "Docker: $(docker --version)" \
             || log_warn "Docker 未安装（无法容器化构建）"
$HAS_SBF    && log_ok "cargo-build-sbf 可用" \
             || log_warn "cargo-build-sbf 未安装"

if ! $HAS_SOLANA; then
  cat <<'EOF'

────────────────────────────────────────────────────────────
  未检测到 Solana CLI，请按以下方式安装：

  【Windows (PowerShell，需管理员）】
    cmd /c "curl -sSfL https://release.anza.xyz/stable/install | sh"

  【Linux / macOS】
    sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"

  安装后重开终端，再运行本脚本。
────────────────────────────────────────────────────────────
EOF
  exit 1
fi

# ---------------------------------------------------------------------------
# 2. 钱包与余额检查
# ---------------------------------------------------------------------------
log_info "步骤 2/6：检查部署钱包..."

if [ -n "${ANCHOR_WALLET:-}" ]; then
  WALLET="$ANCHOR_WALLET"
elif [ -f "$HOME/.config/solana/id.json" ]; then
  WALLET="$HOME/.config/solana/id.json"
else
  log_warn "未找到默认钱包，正在生成新钱包..."
  solana-keygen new --no-bip39-passphrase --silent -o "$HOME/.config/solana/id.json"
  WALLET="$HOME/.config/solana/id.json"
fi

if [ ! -f "$WALLET" ]; then
  log_err "钱包文件不存在: $WALLET"
  exit 1
fi

DEPLOYER_PUBKEY=$(solana-keygen pubkey "$WALLET")
log_ok "部署钱包: $DEPLOYER_PUBKEY"

solana config set --url "$CLUSTER" >/dev/null 2>&1 || true

BALANCE_LAMPORTS=$(solana balance "$DEPLOYER_PUBKEY" --url "$CLUSTER" 2>/dev/null | awk '{print $1}' || echo "0")
BALANCE_SOL=$(echo "$BALANCE_LAMPORTS" | awk '{printf "%.4f", $1}')
log_info "当前余额: ${BALANCE_SOL} SOL"

REQUIRED_SOL=5
if awk "BEGIN {exit !($BALANCE_SOL < $REQUIRED_SOL)}"; then
  if [ "$CLUSTER" = "devnet" ]; then
    log_warn "余额不足（需 ≥ ${REQUIRED_SOL} SOL），正在申请 Devnet 空投..."
    solana airdrop 2 "$DEPLOYER_PUBKEY" --url devnet || log_warn "空投失败（可能已限流，请稍后重试）"
    sleep 2
    BALANCE_SOL=$(solana balance "$DEPLOYER_PUBKEY" --url "$CLUSTER" 2>/dev/null | awk '{printf "%.4f", $1}')
    log_info "空投后余额: ${BALANCE_SOL} SOL"
  else
    log_err "Mainnet 余额不足，需至少 ${REQUIRED_SOL} SOL。请先向 $DEPLOYER_PUBKEY 充值。"
    exit 1
  fi
fi

# ---------------------------------------------------------------------------
# 3. 构建 BPF
# ---------------------------------------------------------------------------
log_info "步骤 3/6：构建 BPF 字节码..."

if [ "$SKIP_BUILD" = "--skip-build" ] && [ -f "$SO_PATH" ]; then
  log_ok "跳过构建，使用已有产物: $SO_PATH"
else
  mkdir -p target/deploy

  if $HAS_SBF; then
    log_info "使用本地 cargo-build-sbf 构建..."
    cargo build-sbf --manifest-path "${PROGRAM_DIR}/Cargo.toml" --sbf-out-dir target/deploy
  elif $HAS_ANCHOR; then
    log_info "使用 Anchor 构建..."
    anchor build
  elif $HAS_DOCKER; then
    log_info "使用 Docker 官方镜像构建（首次需拉取镜像，约 1-2 GB）..."
    docker run --rm \
      -v "$PROJECT_ROOT:/work" \
      -w /work \
      backpackapp/build:v0.29.0 \
      cargo build-sbf --manifest-path "${PROGRAM_DIR}/Cargo.toml" --sbf-out-dir /work/target/deploy
  else
    log_err "无可用的 BPF 构建工具链（需要 cargo-build-sbf / anchor / docker 之一）"
    exit 1
  fi
fi

if [ ! -f "$SO_PATH" ]; then
  log_err "构建产物缺失: $SO_PATH"
  exit 1
fi

SO_SIZE=$(stat -c%s "$SO_PATH" 2>/dev/null || stat -f%z "$SO_PATH" 2>/dev/null || echo 0)
if [ "$SO_SIZE" -lt 10000 ]; then
  log_err "构建产物过小（${SO_SIZE} 字节），不是有效的 BPF 程序。可能构建失败。"
  exit 1
fi
log_ok "BPF 产物就绪: $SO_PATH ($(echo "scale=1; $SO_SIZE/1024" | bc 2>/dev/null || echo "$SO_SIZE") KB)"

# ---------------------------------------------------------------------------
# 4. 部署
# ---------------------------------------------------------------------------
log_info "步骤 4/6：部署合约到 $CLUSTER..."

if $HAS_ANCHOR; then
  log_info "通过 Anchor 部署..."
  anchor deploy --provider.cluster "$CLUSTER" --provider.wallet "$WALLET"
else
  log_info "通过 Solana CLI 部署..."
  PROGRAM_ID=$(grep -A2 '\[programs.devnet\]' Anchor.toml | grep gang_launchpad | cut -d'"' -f2)
  solana program deploy "$SO_PATH" \
    --program-id "$PROGRAM_ID" \
    --url "$CLUSTER" \
    --keypair "$WALLET" \
    --upgrade-authority "$WALLET"
fi

log_ok "合约部署完成"

# ---------------------------------------------------------------------------
# 5. 初始化曲线并登记收款地址
# ---------------------------------------------------------------------------
log_info "步骤 5/6：初始化配置..."

FEE_RECEIVER="${GANG_PROTOCOL_FEE_RECEIVER_SOLANA:-}"
if [ -z "$FEE_RECEIVER" ]; then
  log_warn "未设置 GANG_PROTOCOL_FEE_RECEIVER_SOLANA，跳过 fee_receiver 登记"
  log_warn "请先执行: export GANG_PROTOCOL_FEE_RECEIVER_SOLANA=<你的钱包地址>"
else
  log_ok "协议收款地址: $FEE_RECEIVER"
fi

if [ -f "scripts/init_curve.ts" ]; then
  npx tsx scripts/init_curve.ts --cluster "$CLUSTER" || log_warn "曲线初始化失败（可稍后手动执行）"
else
  log_warn "scripts/init_curve.ts 不存在，跳过自动初始化"
fi

# ---------------------------------------------------------------------------
# 6. 验证
# ---------------------------------------------------------------------------
log_info "步骤 6/6：验证部署结果..."

PROGRAM_ID=$(grep -A2 '\[programs.devnet\]' Anchor.toml 2>/dev/null | grep gang_launchpad | cut -d'"' -f2 || echo "")
if [ -n "$PROGRAM_ID" ]; then
  if solana program show "$PROGRAM_ID" --url "$CLUSTER" >/dev/null 2>&1; then
    log_ok "Program ID: $PROGRAM_ID"
    solana program show "$PROGRAM_ID" --url "$CLUSTER" | head -12
  else
    log_warn "无法查询到程序 $PROGRAM_ID，请检查部署日志"
  fi
fi

cat <<EOF

============================================================
  ✅ 部署流程结束
============================================================
  集群:       $CLUSTER
  部署钱包:   $DEPLOYER_PUBKEY
  收款地址:   ${FEE_RECEIVER:-<未设置>}

  后续步骤：
    1. 为每个新代币调用 init_curve 指令（tag=6）登记 fee_receiver
    2. 启动网关:  npm run start:server
    3. 启动做市:  npm run start:quant
    4. 查看收益:  curl http://127.0.0.1:3000/v1/economy/revenue
============================================================
EOF
