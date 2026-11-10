# ========================================================
# GANG.SOUL 生产级多阶段容器构建 Dockerfile
# ========================================================

# 阶段 1: 依赖构建与缓存
FROM node:22-alpine AS builder

WORKDIR /app

# 安装构建所需工具
RUN apk add --no-cache python3 make g++

# 先复制依赖声明，最大化 Docker 镜像层缓存
COPY package.json package-lock.json ./
RUN npm ci

# 复制源码并进行静态检查与预编译
COPY tsconfig.json ./
COPY src/ ./src/
COPY public/ ./public/

# 阶段 2: 生产精简运行环境
FROM node:22-alpine AS runner

WORKDIR /app

# 设置生产环境变量
ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

# 创建非 root 用户 node 运行目录
RUN mkdir -p /app/data && chown -R node:node /app

# 从构建阶段复制必要模块
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/tsconfig.json ./tsconfig.json
COPY --from=builder /app/src ./src
COPY --from=builder /app/public ./public
COPY scripts/entrypoint.sh ./scripts/entrypoint.sh
COPY bin/ ./bin/

# 授权执行权限
RUN chmod +x ./scripts/entrypoint.sh && chown -R node:node /app

# 切换至非特权安全用户
USER node

# 默认暴露出 RESTful API、SSE 与 Zero-UI 终端端口
EXPOSE 3000

# 挂载数据卷存储延迟遥测日志 (data/latency.jsonl)
VOLUME ["/app/data"]

# 默认容器入口
ENTRYPOINT ["./scripts/entrypoint.sh"]
CMD ["gateway"]
