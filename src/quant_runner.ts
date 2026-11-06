/**
 * 0x.SOUL 量化做市集群长周期守护进程 (Quant Market Making Runner)
 * 编排协同：
 * - Agent #2: QUANT_MAKER (自适应网格做市双边挂单与点差捕获)
 * - Agent #3: ARBITRAGEUR (内外盘利差套利与滑点平水)
 * - Agent #1: MOMENTUM_SNIPER (.soul 巨鲸跟单与突破捕捉)
 * - Agent #0: DEV_TREASURY (Hold Line 守线防闪崩与托盘买入)
 * 
 * 每次轮询不仅在量化引擎内部计算，更通过 RESTful API 同步至本地网关与 Zero-UI 看板，
 * 实现看板数据与思考流的实时动态滚动呈现。
 */

import axios from 'axios';
import { loadEnv } from './config/env';

// 必须在任何业务模块读取 process.env 之前加载配置
loadEnv();

import { SolanaAgentClusterManager } from './wallet/cluster';
import { SoulDomainResolver } from './soul/resolver';
import { AdvancedMarketMakingEngine } from './quant/market_making/engine';

async function bootstrapQuantDaemon() {
  console.log('========================================================');
  console.log('🤖 正在启动 0x.SOUL 多智能体量化做市集群守护引擎...');
  console.log('========================================================');

  const mnemonic = process.env.AGENT_MNEMONIC || 
    'wool vintage lock whisper razor diesel divide plastic unaware shield shock brass abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art';

  const clusterManager = new SolanaAgentClusterManager(mnemonic);
  await clusterManager.warmUpWallets(10);
  console.log('✅ 量化集群 10 个 Agent 钱包已激活并载入沙盒风控规则');

  const soulResolver = new SoulDomainResolver();
  const quantEngine = new AdvancedMarketMakingEngine(clusterManager, soulResolver);

  const gatewayUrl = process.env.GATEWAY_URL || 'http://127.0.0.1:3000';
  
  // 创建禁用代理的 axios 实例，确保无论宿主机是否开启系统代理/VPN，均直连本地网关
  const localClient = axios.create({
    baseURL: gatewayUrl,
    proxy: false,
    timeout: 2500,
  });
  const targetMint = process.env.TARGET_MINT || 'GgZcyZ8A2wWxULFPfjJ6deUMqmoN1QDpLnZVGkBkiVcL';
  console.log(`🎯 目标做市代币 Mint: ${targetMint}`);
  console.log(`🌐 联动网关服务地址: ${gatewayUrl}`);

  let isRunning = true;
  let cycleCount = 0;

  // 虚拟储备金与盘口基准价格
  let virtualSol = 30.0;
  let virtualToken = 1073000000.0;
  let totalRaisedSol = 0.8;

  const runCycle = async () => {
    if (!isRunning) return;
    cycleCount++;

    try {
      // 0. 从网关拉取最新盘口与代币储备金
      try {
        const tokenRes = await localClient.get(`/v1/tokens/${targetMint}`);
        if (tokenRes.data && tokenRes.data.token) {
          virtualSol = tokenRes.data.token.virtualSolReserves;
          virtualToken = tokenRes.data.token.virtualTokenReserves;
          totalRaisedSol = tokenRes.data.token.totalRaisedSol;
        }
      } catch (e) {}

      const currentPrice = virtualSol / virtualToken;

      // 1. 策略轮动：多 Agent 动态派发网格做市商
      const gridRes = quantEngine.processGridMarketMaking(targetMint, virtualSol, virtualToken, totalRaisedSol);
      if (gridRes.executions.length > 0) {
        const topExec = gridRes.executions[0];
        const assignedAgent = 2 + (cycleCount % 7); // 在 Agent #2 ~ #8 之间轮动，避免单 Agent 触碰 1% 硬顶
        const isBuy = cycleCount % 4 !== 0; // 75% 买单推进联合曲线，25% 卖单释放持仓回笼流动性
        
        console.log(`[Quant #${cycleCount}] 📊 [网格做市] Agent #${assignedAgent} ${isBuy ? 'BUY' : 'SELL'} ${topExec.solAmount} SOL | 价格: ${topExec.price.toExponential(3)}`);
        
        try {
          if (isBuy) {
            const resp = await localClient.post(`/v1/trade/swap`, {
              agentIndex: assignedAgent,
              mint: targetMint,
              isBuy: true,
              solAmount: Number((0.02 + (cycleCount % 5) * 0.015).toFixed(3)),
              note: `[GridMaker] Agent #${assignedAgent} placing adaptive bid on bonding curve.`,
            });
            console.log(`   -> [Swap Success] Agent #${assignedAgent} Tx: ${resp.data.txSignature?.substring(0, 16)}...`);
          } else {
            const resp = await localClient.post(`/v1/trade/swap`, {
              agentIndex: assignedAgent,
              mint: targetMint,
              isBuy: false,
              tokenAmount: 200000,
              note: `[GridMaker] Agent #${assignedAgent} taking profit and balancing AMM spread.`,
            });
            console.log(`   -> [Swap Success] Agent #${assignedAgent} Tx: ${resp.data.txSignature?.substring(0, 16)}...`);
          }
        } catch (e: any) {
          // 若卖出余额不足，降级执行微额买入
          if (e.response && e.response.data && e.response.data.error?.includes('balance')) {
            await localClient.post(`/v1/trade/swap`, {
              agentIndex: (assignedAgent + 1) % 10,
              mint: targetMint,
              isBuy: true,
              solAmount: 0.025,
              note: `[GridMaker] Rebalancing liquidity pool spread.`,
            }).catch(() => {});
          } else if (e.response) {
            console.error(`   -> [Swap Error]`, e.response.status, e.response.data);
          }
        }
      }

      // 2. 策略轮动：Hold Line 守线防崩哨兵
      const holdLineReport = quantEngine.processHoldLineDefense(targetMint, currentPrice * 0.98);
      if (holdLineReport) {
        const sentinelAgent = (cycleCount % 2 === 0) ? 0 : 9;
        console.log(`[Quant #${cycleCount}] 🛡️ [Hold Line 守线托盘] Agent #${sentinelAgent} 买入 0.035 SOL | 原因: ${holdLineReport.reasoningNote}`);
        try {
          await localClient.post(`/v1/trade/swap`, {
            agentIndex: sentinelAgent,
            mint: targetMint,
            isBuy: true,
            solAmount: 0.035,
            note: `[HoldLineSentinel] Price support defense active at ${currentPrice.toExponential(2)} SOL`,
          });
        } catch (e: any) {}
      }

      // 3. 策略轮动：巨鲸跟单 Agent #1
      if (cycleCount % 3 === 0) {
        const whaleSignal = {
          whaleDomain: 'matrix-quant-whale.soul',
          whaleAddress: '9LoNSLt2weK3adJ8fa7jf5RpbBm2FuBC9AaAKm4sfruc',
          mint: targetMint,
          isBuy: true,
          solAmount: 0.8,
          tokenAmount: 25000000,
          price: currentPrice,
          whaleNote: 'High sentiment momentum confirmed via x402 signal feed. Accumulating before 85 SOL graduation.',
          txSignature: '5SolWhaleSigMock1111111111111111111111111111111111',
          timestamp: Date.now(),
        };
        const whaleReport = quantEngine.processWhaleCopyTrade(whaleSignal);
        if (whaleReport) {
          const followerAgent = (cycleCount % 2 === 0) ? 1 : 5;
          console.log(`[Quant #${cycleCount}] 🐋 [巨鲸跟单突破] Agent #${followerAgent} 跟随 ${whaleSignal.whaleAddress} 买入 0.04 SOL`);
          try {
            await localClient.post(`/v1/trade/swap`, {
              agentIndex: followerAgent,
              mint: targetMint,
              isBuy: true,
              solAmount: 0.04,
              note: `[WhaleFollower] Agent #${followerAgent} followed matrix-quant-whale.soul momentum note`,
            });
          } catch (e: any) {}
        }
      }

      // 4. 定期更新累计做市收益
      if (cycleCount % 5 === 0) {
        console.log(`📈 [做市统计] 累计网格点差收益: ${quantEngine.cumulativeSpreadProfitSol.toFixed(6)} SOL | 历史执行订单: ${quantEngine.executionHistory.length} 笔`);
      }

    } catch (err: any) {
      console.error(`⚠️ 做市轮询 #${cycleCount} 异常:`, err.message);
    }
  };

  const intervalMs = parseInt(process.env.QUANT_CYCLE_INTERVAL_MS || '3000', 10);
  const timer = setInterval(runCycle, intervalMs);

  const shutdown = () => {
    console.log('\n🛑 收到终止信号，正在平稳注销做市守护进程...');
    isRunning = false;
    clearInterval(timer);
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // 立即触发一次初试轮询
  await runCycle();
}

bootstrapQuantDaemon().catch((err) => {
  console.error('❌ 量化做市守护进程启动致命错误:', err);
  process.exit(1);
});
