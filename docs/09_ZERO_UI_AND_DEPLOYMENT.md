# Zero-UI 前端看板与生产级 Docker 编排部署规范

## 1. Zero-UI 只读大屏设计哲学

在面向 AI Agent 的原生平台中，人类不再是第一交互者，AI 才是真正的交易主力。因此，前端平台采取 **“Zero-UI（零传统钱包连接按钮、纯命令行与只读看板驱动）”** 的设计范式：
* **彻底切断前端攻击面**：没有 Connect Wallet、没有客户端私钥签名、没有钓鱼授权签名弹窗，杜绝 Drainer 攻击。
* **暗黑极客终端美学**：界面完全采用类 Bloomberg Terminal / Cyberpunk 终端风格，以最直观的数据可视化人类展示 AI Agent 的博弈过程。
* **Server-Sent Events (SSE) 毫秒级直推**：摒弃低效的前端轮询，只要底层 Solana 索引器解码到新交易，0 延迟向大屏推送带有 `--note` 思考日志的数据卡片。

---

## 2. 生产级 Docker Compose 编排架构

整个系统以轻量微服务形态进行物理容器隔离：

```yaml
version: '3.8'

services:
  # 1. 高速内存数据库：存储实时 K 线、行情与 Agent 日累计消耗原子计数器
  redis:
    image: redis:7-alpine
    container_name: gang-redis
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    command: redis-server --appendonly yes --requirepass ${REDIS_PASSWORD}
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 3s
      retries: 3

  # 2. 本地去中心化 IPFS Kubo 节点：用于毫秒级固化代币元数据与图标
  ipfs-kubo:
    image: ipfs/kubo:v0.29.0
    container_name: gang-ipfs
    ports:
      - "4001:4001"       # libp2p P2P 网络
      - "127.0.0.1:5001:5001" # 内部 API 接口
      - "127.0.0.1:8080:8080" # 本地 Gateway 预览
    volumes:
      - ipfs_staging:/export
      - ipfs_data:/data/ipfs
    restart: unless-stopped

  # 3. Fastify M2M 网关 + 链下 Geyser/WebSocket 实时索引器
  fastify-api-gateway:
    build:
      context: ./gateway
      dockerfile: Dockerfile
    container_name: gang-gateway
    environment:
      - PORT=3000
      - NODE_ENV=production
      - SOLANA_RPC_HTTP=${SOLANA_RPC_HTTP}
      - SOLANA_RPC_WS=${SOLANA_RPC_WS}
      - JITO_BLOCK_ENGINE_URL=https://mainnet.block-engine.jito.wtf/api/v1/bundles
      - REDIS_URL=redis://:${REDIS_PASSWORD}@redis:6379
      - IPFS_API_URL=http://ipfs-kubo:5001
      - REGISTRY_PROGRAM_ID=${REGISTRY_PROGRAM_ID}
      - LAUNCHPAD_PROGRAM_ID=${LAUNCHPAD_PROGRAM_ID}
      - GATEWAY_SIGNER_KEY=${GATEWAY_SIGNER_KEY}
    ports:
      - "3000:3000"
    depends_on:
      redis:
        condition: service_healthy
      ipfs-kubo:
        condition: service_started
    restart: unless-stopped

  # 4. 专属 6 大量化交易 Agent 集群容器
  quant-bot-swarm:
    build:
      context: ./swarm
      dockerfile: Dockerfile
    container_name: gang-quant-swarm
    environment:
      - MASTER_MNEMONIC=${MASTER_MNEMONIC}
      - GATEWAY_API_URL=http://fastify-api-gateway:3000
      - SOLANA_RPC_HTTP=${SOLANA_RPC_HTTP}
      - JITO_TIP_LAMPORTS=100000
      - AUTO_APPROVE_SAFE_POLICY=true
    depends_on:
      - fastify-api-gateway
    restart: unless-stopped

volumes:
  redis_data:
  ipfs_staging:
  ipfs_data:
```

---

## 3. 生产部署安全检查单 (Production Hardening Checklist)

1. **RPC 专线配置**：生产环境必须配置 Helius / Triton / QuickNode 的 Geyser 订阅或 Dedicated WebSocket 专线，防止公共 RPC 节点 Rate Limit 导致漏单。
2. **IPFS 端口隔离**：IPFS 5001 API 端口仅限绑定在 `127.0.0.1` 环回接口，严禁对外暴露公网访问。
3. **独立 VPS 隔离**：遵循隔离部署原则，开发环境与生产实盘必须部署在不同的云主机上，严禁在同一实例混跑测试与主网资产。
4. **日志脱敏**：网关在处理交易日志与请求时，自动对私钥、敏感 Token 进行正则过滤遮蔽，严禁在 Docker 日志中打印明文 Private Key。
