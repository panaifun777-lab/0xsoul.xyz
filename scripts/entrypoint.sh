#!/bin/sh
set -e

echo "=========================================================="
echo "⚡ GANG.SOUL Production Container Starting..."
echo "Mode: $1"
echo "Node Environment: $NODE_ENV"
echo "=========================================================="

case "$1" in
  gateway)
    echo "🌐 启动 Fastify M2M 网关、SSE 思考流与 Zero-UI 看板终端..."
    exec npx tsx src/server_main.ts
    ;;
  quant)
    echo "🤖 启动 4 大高级量化做市守护进程 (网格 / Hold Line / 套利 / 跟单)..."
    exec npx tsx src/quant_runner.ts
    ;;
  mcp)
    echo "🔌 启动生产级 MCP Stdio 协议守护服务 (JSON-RPC 2.0)..."
    exec npx tsx src/mcp_runner.ts
    ;;
  test)
    echo "🧪 执行生产级自动化与集成测试套件..."
    exec npm test
    ;;
  *)
    echo "执行自定义指令: $@"
    exec "$@"
    ;;
esac
