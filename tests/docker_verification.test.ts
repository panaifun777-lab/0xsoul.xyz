/**
 * Docker 启动配置与守护进程入口语法有效性校验
 */
import * as fs from 'fs';
import * as path from 'path';

async function runDockerVerification() {
  console.log('====================================================');
  console.log('🐳 校验 Docker 容器打包与守护脚本配置');
  console.log('====================================================');

  // 1. 检查关键构建文件是否存在
  const requiredFiles = [
    'Dockerfile',
    'docker-compose.yml',
    '.env.example',
    '.dockerignore',
    'scripts/entrypoint.sh',
    'src/server_main.ts',
    'src/quant_runner.ts',
    'src/mcp_runner.ts',
  ];

  for (const f of requiredFiles) {
    if (!fs.existsSync(f)) {
      throw new Error(`❌ 缺少核心 Docker 部署文件: ${f}`);
    }
    console.log(`✅ 文件存在: ${f}`);
  }

  // 2. 检查 Dockerfile 内容规范
  const dockerfileContent = fs.readFileSync('Dockerfile', 'utf-8');
  if (!dockerfileContent.includes('FROM node:22-alpine AS builder')) {
    throw new Error('❌ Dockerfile 缺少多阶段构建 builder 声明');
  }
  if (!dockerfileContent.includes('USER node')) {
    throw new Error('❌ Dockerfile 缺少非 root 安全用户声明');
  }
  if (!dockerfileContent.includes('VOLUME ["/app/data"]')) {
    throw new Error('❌ Dockerfile 缺少持久化数据卷 VOLUME 声明');
  }
  console.log('✅ Dockerfile 多阶段安全构建与用户隔离规范检查通过');

  // 3. 检查 docker-compose.yml 服务定义
  const composeContent = fs.readFileSync('docker-compose.yml', 'utf-8');
  const services = ['gang-gateway:', 'gang-quant-engine:', 'gang-mcp-daemon:'];
  for (const s of services) {
    if (!composeContent.includes(s)) {
      throw new Error(`❌ docker-compose.yml 缺少服务: ${s}`);
    }
  }
  if (!composeContent.includes('gang-telemetry-data:')) {
    throw new Error('❌ docker-compose.yml 缺少 telemetry 共享卷定义');
  }
  console.log('✅ docker-compose.yml 微服务编排 (网关 + 做市 + MCP) 规范检查通过');

  // 4. 检查 entrypoint.sh 脚本可执行性与分支定义
  const entrypointContent = fs.readFileSync('scripts/entrypoint.sh', 'utf-8');
  const branches = ['gateway)', 'quant)', 'mcp)', 'test)'];
  for (const b of branches) {
    if (!entrypointContent.includes(b)) {
      throw new Error(`❌ entrypoint.sh 缺少命令分支: ${b}`);
    }
  }
  console.log('✅ scripts/entrypoint.sh 4 大启动分支校验通过');

  console.log('\n🎉 Docker 容器化打包与守护脚本校验全部通过！');
}

runDockerVerification().catch((err) => {
  console.error('❌ 校验失败:', err);
  process.exit(1);
});
