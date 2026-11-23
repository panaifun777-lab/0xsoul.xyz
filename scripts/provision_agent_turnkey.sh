#!/bin/sh
# Step 1 · 用 tk CLI 建受限 agent user + policy + 交易钱包
# 基于 tk 官方 skill: provisioning-agent-identity / managing-policies
# 在 VPS 上运行：sh scripts/provision_agent_turnkey.sh
#
# 前提：root profile `0xsoul-user` 已 login（tk whoami 显示 Root user）
# 安全：root 只建 tag/user/DENY/policy 然后停手；agent 凭据在独立 profile，验收用 agent 凭据。
# 注意：官方要求 agent key 在 agent host 生成；本环境 root 与 agent 同 VPS，
#       用独立 profile + 独立凭据文件做逻辑隔离（已标注偏差）。

set -eu
ROOT=0xsoul-user
AGENT=0xsoul-agent
ORG=93557e8d-54a3-49e8-949d-ec9769df3a30
J='--message-format json'

echo "=== 1) 确保 agent tag ==="
TAGS=$(tk --profile $ROOT $J user tag list 2>/dev/null)
AGENT_TAG=$(echo "$TAGS" | grep -o '"userTagId":"[^"]*"' | head -1 | cut -d'"' -f4 || true)
if [ -z "$AGENT_TAG" ]; then
  # 尝试从 name=agent 的条目里取 id（不同版本字段名可能是 id/userTagId）
  AGENT_TAG=$(echo "$TAGS" | tr '}' '\n' | grep '"name":"agent"' | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4 || true)
fi
if [ -z "$AGENT_TAG" ]; then
  echo "创建 agent tag..."
  tk --profile $ROOT $J user tag create --name agent 2>&1
  TAGS=$(tk --profile $ROOT $J user tag list 2>/dev/null)
  AGENT_TAG=$(echo "$TAGS" | grep -o '"userTagId":"[^"]*"' | head -1 | cut -d'"' -f4 || true)
  [ -z "$AGENT_TAG" ] && AGENT_TAG=$(echo "$TAGS" | tr '}' '\n' | grep '"name":"agent"' | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4 || true)
fi
echo "AGENT_TAG=$AGENT_TAG"

echo "=== 2) agent profile 生成密钥对（私钥只在本地凭据文件）==="
PUBJSON=$(tk --organization-id $ORG $J profile create --profile-name $AGENT 2>&1)
echo "$PUBJSON"
PUB_KEY=$(echo "$PUBJSON" | grep -o '"publicKey":"[^"]*"' | head -1 | cut -d'"' -f4)
echo "AGENT_PUBLIC_KEY=$PUB_KEY"

echo "=== 3) root 建带 tag 的 agent user（无 --expires-in = 永久 key）==="
UJSON=$(tk --profile $ROOT $J user create --user-name 0xsoul-agent --tag-name agent --public-key "$PUB_KEY" 2>&1)
echo "$UJSON"
AGENT_USER_ID=$(echo "$UJSON" | grep -o '"userIds":\["[^"]*"' | head -1 | sed 's/.*\["//' || true)
echo "AGENT_USER_ID=$AGENT_USER_ID"

echo "=== 4) root 建 DENY：禁止 agent 自改凭据 ==="
if ! tk --profile $ROOT $J policy list 2>/dev/null | grep -q 'agents-no-credentials'; then
  tk --profile $ROOT $J policy create --name agents-no-credentials --effect deny \
    --consensus "approvers.any(user, user.tags.contains('${AGENT_TAG}'))" \
    --condition "activity.resource == 'CREDENTIAL'" 2>&1
else
  echo "agents-no-credentials 已存在，跳过"
fi

echo "=== 5) agent login + 身份核验 ==="
tk $J login --profile-name $AGENT 2>&1
tk --profile $AGENT $J whoami 2>&1

echo "=== 6) 验收：agent 自注册 key 必须被拒 ==="
tk --profile $AGENT $J api-key register --input-json "{\"userId\":\"${AGENT_USER_ID}\",\"apiKeys\":[{\"apiKeyName\":\"escape\",\"publicKey\":\"${PUB_KEY}\",\"curveType\":\"API_KEY_CURVE_P256\"}]}" 2>&1 || echo "（预期：unauthorized 403，DENY 生效）"

echo "=== DONE: 把上面输出抄给助手，继续写 SIGN_TRANSACTION policy ==="
