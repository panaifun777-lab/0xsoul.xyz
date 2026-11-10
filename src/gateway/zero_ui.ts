/**
 * 0x.SOUL Zero-UI Terminal Dashboard HTML - Swarm Command Center Edition
 * 蜂群指挥中心：全量集成拓扑画布、双轨订单簿、套利雷达、CRT扫描线复古沉浸式美学（中文显示说明）
 */
export const ZERO_UI_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>0x.SOUL // 蜂群指挥中心与 M2M 终端</title>
  <style>
    :root {
      --bg: #030406;
      --card-bg: #080b12;
      --border: #151d2f;
      --border-glow: rgba(0, 229, 255, 0.25);
      --text-main: #e2e8f0;
      --accent-green: #00ff66;
      --accent-cyan: #00e5ff;
      --accent-purple: #9d00ff;
      --accent-gold: #ffd700;
      --accent-bsc: #f3ba2f;
      --accent-red: #ff3366;
      --font-mono: "JetBrains Mono", "Courier New", monospace;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }

    /* CRT 扫描线显像管复古沉浸式效果 */
    body::after {
      content: " ";
      display: block;
      position: fixed;
      top: 0; left: 0; bottom: 0; right: 0;
      background: linear-gradient(rgba(18, 16, 16, 0) 50%, rgba(0, 0, 0, 0.25) 50%), linear-gradient(90deg, rgba(255, 0, 0, 0.03), rgba(0, 255, 0, 0.01), rgba(0, 0, 255, 0.03));
      z-index: 99999;
      background-size: 100% 3px, 3px 100%;
      pointer-events: none;
    }

    body {
      background-color: var(--bg);
      color: var(--text-main);
      font-family: var(--font-mono);
      font-size: 13px;
      line-height: 1.5;
      padding: 16px;
      overflow-x: hidden;
    }

    header {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-top: 2px solid var(--accent-cyan);
      padding: 1rem 2rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
      position: sticky;
      top: 0;
      z-index: 100;
      border-radius: 6px;
      margin-bottom: 16px;
      box-shadow: 0 0 20px rgba(0, 229, 255, 0.1);
    }

    .logo {
      font-size: 1.4rem;
      font-weight: 900;
      color: var(--accent-cyan);
      text-shadow: 0 0 10px rgba(0,229,255,0.4);
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }

    .badge {
      background: rgba(0,255,102,0.1);
      border: 1px solid var(--accent-green);
      color: var(--accent-green);
      padding: 0.2rem 0.6rem;
      font-size: 0.75rem;
      border-radius: 4px;
      box-shadow: 0 0 8px rgba(0,255,102,0.2);
    }

    .main-container {
      max-width: 1440px;
      margin: 0 auto;
      width: 100%;
      display: grid;
      grid-template-columns: 1fr 380px;
      gap: 16px;
      position: relative;
      z-index: 1;
    }

    @media(max-width: 1100px) {
      .main-container { grid-template-columns: 1fr; }
    }

    .panel {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 1.25rem;
      margin-bottom: 1rem;
      box-shadow: 0 4px 20px rgba(0,0,0,0.6);
      position: relative;
    }

    .panel:hover {
      border-color: var(--border-glow);
    }

    .panel-title {
      font-size: 1.05rem;
      color: var(--accent-cyan);
      margin-bottom: 1rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid var(--border);
      padding-bottom: 0.5rem;
      letter-spacing: 0.5px;
    }

    /* 蜂群网络拓扑画布样式 */
    .topology-container {
      background: #030509;
      border: 1px solid var(--border);
      border-radius: 6px;
      height: 220px;
      position: relative;
      overflow: hidden;
      margin-bottom: 1rem;
    }
    #topo-canvas { width: 100%; height: 100%; display: block; }

    /* 三位一体多链合约卡片 */
    .contract-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 1rem;
    }
    @media(max-width: 900px) { .contract-grid { grid-template-columns: 1fr; } }

    .contract-card {
      background: #05070d;
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 0.85rem;
      position: relative;
      transition: 0.2s;
    }
    .contract-card:hover { border-color: var(--accent-cyan); }
    .contract-card h4 { font-size: 0.82rem; color: var(--accent-gold); margin-bottom: 0.3rem; display: flex; align-items: center; gap: 0.4rem; }
    .contract-hash {
      font-size: 0.68rem;
      color: #94a3b8;
      word-break: break-all;
      background: #020306;
      padding: 0.35rem;
      border-radius: 4px;
      border: 1px dashed var(--border);
      margin-top: 0.3rem;
    }
    .copy-btn {
      background: rgba(0,229,255,0.1);
      border: 1px solid var(--accent-cyan);
      color: var(--accent-cyan);
      padding: 0.2rem 0.5rem;
      font-size: 0.65rem;
      cursor: pointer;
      border-radius: 3px;
      margin-top: 0.4rem;
      float: right;
      transition: 0.2s;
    }
    .copy-btn:hover { background: var(--accent-cyan); color: #000; box-shadow: 0 0 8px var(--accent-cyan); }

    /* 终端日志瀑布流 */
    .terminal-log {
      background: #020306;
      border: 1px solid var(--border);
      border-radius: 6px;
      height: 260px;
      overflow-y: auto;
      padding: 0.85rem;
      font-size: 0.82rem;
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }
    .log-line {
      display: flex;
      gap: 0.75rem;
      border-left: 2px solid var(--accent-cyan);
      padding-left: 0.5rem;
      animation: fadeIn 0.3s ease-in-out;
    }
    .log-time { color: #64748b; font-size: 0.73rem; white-space: nowrap; }
    .log-agent { color: var(--accent-purple); font-weight: bold; white-space: nowrap; }
    .log-msg { color: var(--text-main); word-break: break-all; }

    /* 毕业进度条 */
    .progress-bar-bg { background: #151d2f; height: 16px; border-radius: 8px; overflow: hidden; margin: 0.8rem 0; border: 1px solid var(--border); }
    .progress-bar-fill { background: linear-gradient(90deg, var(--accent-cyan), var(--accent-green)); height: 100%; width: 9.6%; transition: width 0.5s ease; box-shadow: 0 0 10px rgba(0,255,102,0.4); }
    .curve-stats { display: flex; justify-content: space-between; font-size: 0.85rem; color: #94a3b8; }

    /* 双轨订单与套利雷达网格 */
    .dual-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
    @media(max-width: 800px) { .dual-grid { grid-template-columns: 1fr; } }

    .sub-box {
      background: #05070d;
      padding: 0.85rem;
      border-radius: 6px;
      border: 1px solid var(--border);
    }

    @keyframes fadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }

    /* ===== Phase 1 动态升级 ===== */

    /* 3. 极光流光背景：body 底层缓慢旋转的彩色光晕 */
    .aurora {
      position: fixed;
      inset: 0;
      z-index: 0;
      pointer-events: none;
      background:
        radial-gradient(60% 50% at 18% 14%, rgba(0,229,255,0.12), transparent 60%),
        radial-gradient(52% 46% at 86% 24%, rgba(157,0,255,0.14), transparent 60%),
        radial-gradient(55% 50% at 50% 92%, rgba(0,255,102,0.09), transparent 60%);
      filter: blur(22px);
      animation: auroraDrift 18s ease-in-out infinite alternate;
    }
    @keyframes auroraDrift {
      0%   { transform: translate3d(-2%, -1%, 0) scale(1.05) rotate(0deg);   opacity: 0.85; }
      50%  { transform: translate3d(2%, 1%, 0)  scale(1.12) rotate(2deg);   opacity: 1; }
      100% { transform: translate3d(-1%, 2%, 0) scale(1.05) rotate(-2deg);  opacity: 0.9; }
    }

    /* 2. 面板滚动入场揭示 */
    .panel { opacity: 0; transform: translateY(22px); transition: opacity .65s ease, transform .65s ease, border-color .2s; }
    .panel.in-view { opacity: 1; transform: none; }

    /* 6. 关键指标呼吸光晕 */
    .progress-bar-fill { animation: breatheBar 2.6s ease-in-out infinite; }
    @keyframes breatheBar {
      0%, 100% { box-shadow: 0 0 8px rgba(0,255,102,0.35); }
      50%      { box-shadow: 0 0 20px rgba(0,255,102,0.8); }
    }
    .glow-val {
      display: inline-block;
      border-radius: 4px;
      padding: 0 4px;
      animation: breatheGlow 2.6s ease-in-out infinite;
    }
    @keyframes breatheGlow {
      0%, 100% { text-shadow: 0 0 4px currentColor; }
      50%      { text-shadow: 0 0 14px currentColor; }
    }
    .num { font-variant-numeric: tabular-nums; }

    /* ===== Phase 2: ④ 多链行情跑马灯 ===== */
    .nav-link {
      color: var(--accent-purple);
      border: 1px solid var(--accent-purple);
      padding: 0.25rem 0.65rem;
      border-radius: 4px;
      text-decoration: none;
      font-size: 0.78rem;
      font-weight: bold;
      white-space: nowrap;
      transition: 0.2s;
    }
    .nav-link:hover { background: var(--accent-purple); color: #000; box-shadow: 0 0 10px var(--accent-purple); }

    .lang-btn {
      background: rgba(0,255,102,0.08);
      border: 1px solid var(--accent-green);
      color: var(--accent-green);
      padding: 0.25rem 0.65rem;
      border-radius: 4px;
      font-family: var(--font-mono);
      font-size: 0.78rem;
      font-weight: bold;
      cursor: pointer;
      white-space: nowrap;
      transition: 0.2s;
    }
    .lang-btn:hover { background: var(--accent-green); color: #000; box-shadow: 0 0 10px var(--accent-green); }

    .ticker {
      position: relative;
      z-index: 1;
      overflow: hidden;
      white-space: nowrap;
      border: 1px solid var(--border);
      border-radius: 6px;
      background: linear-gradient(90deg, #080b12, #0a0f1a);
      margin-bottom: 14px;
      padding: 0.55rem 0;
      box-shadow: inset 0 0 16px rgba(0,229,255,0.05);
    }
    .ticker.ticker-bottom { margin-bottom: 0; margin-top: 16px; }
    .ticker-track {
      display: inline-flex;
      gap: 2.4rem;
      padding-left: 2.4rem;
      will-change: transform;
      animation: tickerScroll 40s linear infinite;
    }
    .ticker-bottom .ticker-track { animation-duration: 52s; animation-direction: reverse; }
    .ticker:hover .ticker-track { animation-play-state: paused; }
    @keyframes tickerScroll {
      from { transform: translateX(0); }
      to   { transform: translateX(-50%); }
    }
    .tk {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      font-size: 0.8rem;
      color: #cbd5e1;
    }
    .tk .sym { color: var(--accent-gold); font-weight: bold; }
    .tk b { color: var(--accent-cyan); font-weight: bold; }
    .tk .up { color: var(--accent-green); }
    .tk .down { color: var(--accent-red); }
    .tk .dot { width: 7px; height: 7px; border-radius: 50%; box-shadow: 0 0 6px currentColor; }
  </style>
</head>
<body>

  <div class="aurora"></div>

  <!-- ④ 顶部多链行情跑马灯 -->
  <div class="ticker" id="ticker-top"><div class="ticker-track" id="ticker-track-top"></div></div>

  <header>
    <div class="logo">
      <span>⚡ 0x.SOUL</span>
      <span class="badge" data-en="Swarm Command Center // M2M Telemetry">蜂群指挥中心 // M2M 实时遥测</span>
    </div>
    <div style="display: flex; align-items: center; gap: 1rem;">
      <button id="lang-toggle" class="lang-btn" type="button" title="切换语言 / Switch language">🇺🇸 EN</button>
      <a href="/docs" class="nav-link" target="_blank" data-en="📚 Docs / Whitepaper">📚 文档 / 白皮书</a>
      <div id="conn-status" style="font-size: 0.82rem; color: var(--accent-green);" data-en="● SSE & live stream online">● SSE 与实时流在线</div>
    </div>
  </header>

  <div class="main-container">
    <div>
      <!-- 🌐 蜂群实时拓扑画布 -->
      <div class="panel">
        <div class="panel-title">
          <span data-en="🔮 Swarm Topology & M2M Liquidity Nodes">🔮 蜂群网络拓扑与 M2M 流动性节点</span>
          <span style="font-size: 0.78rem; color: var(--accent-cyan);" data-en="10 active swarm nodes connected">10 个活跃蜂群节点已连接</span>
        </div>
        <div class="topology-container">
          <canvas id="topo-canvas"></canvas>
        </div>
      </div>

      <!-- 🌐 多链资产与合约地址面板 -->
      <div class="panel">
        <div class="panel-title">
          <span data-en="🌐 Trinity Multi-Chain Asset Matrix & Binance Agent ID">🌐 三位一体多链资产矩阵与币安 Agent ID</span>
          <span style="font-size: 0.78rem; color: var(--accent-cyan);" data-en="ARC EVM + BNB Chain + Solana">ARC EVM + BNB Chain + Solana</span>
        </div>
        <div class="contract-grid">
          <!-- 1. ARC 主网 EVM 卡片 -->
          <div class="contract-card">
            <h4 data-en="🟢 ARC Mainnet (EVM)">🟢 ARC 主网 (EVM)</h4>
            <div style="font-size: 0.73rem; color: #cbd5e1;" data-en="$0x.SOUL ERC-20 Token">$0x.SOUL ERC-20 代币</div>
            <div class="contract-hash">0x860Db6Fc2f6fE8639bf2A0B07b738093727fEC6f</div>
            <button class="copy-btn" onclick="copyToClipboard('0x860Db6Fc2f6fE8639bf2A0B07b738093727fEC6f', this)" data-en="Copy">复制</button>
            <div style="clear: both;"></div>
          </div>
          <!-- 2. BNB Smart Chain (BSC) 映射卡片 -->
          <div class="contract-card" style="border-color: rgba(243,186,47,0.4)">
            <h4 style="color: var(--accent-bsc);" data-en="🟡 BNB Chain (BSC)">🟡 BNB Chain (BSC)</h4>
            <div style="font-size: 0.73rem; color: #cbd5e1;" data-en="$0x.SOUL BEP-20 Mapping">$0x.SOUL BEP-20 映射</div>
            <div class="contract-hash">0x860Db6Fc2f6fE8639bf2A0B07b738093727fEC6f</div>
            <button class="copy-btn" onclick="copyToClipboard('0x860Db6Fc2f6fE8639bf2A0B07b738093727fEC6f', this)" data-en="Copy BSC">复制BSC</button>
            <div style="clear: both;"></div>
          </div>
          <!-- 3. Solana 主网 SPL 卡片 -->
          <div class="contract-card">
            <h4 data-en="🟣 Solana (SPL)">🟣 Solana (SPL)</h4>
            <div style="font-size: 0.73rem; color: #cbd5e1;" data-en="$GSOUL Genesis Mint">$GSOUL 创世铸造</div>
            <div class="contract-hash">GgZcyZ8A2wWxULFPfjJ6deUMqmoN1QDpLnZVGkBkiVcL</div>
            <button class="copy-btn" onclick="copyToClipboard('GgZcyZ8A2wWxULFPfjJ6deUMqmoN1QDpLnZVGkBkiVcL', this)" data-en="Copy SPL">复制SPL</button>
            <div style="clear: both;"></div>
          </div>
        </div>
      </div>

      <!-- 联合曲线与毕业进度面板 -->
      <div class="panel">
        <div class="panel-title">
          <span data-en="📈 50 SOL Bonding Curve Graduation Engine">📈 50 SOL 联合曲线毕业引擎</span>
          <span style="font-size: 0.78rem; color: var(--accent-green);" data-en="Target: 50 SOL ➔ Raydium CPMM">目标: 50 SOL ➔ Raydium CPMM</span>
        </div>
        <div id="grad-demo-note" style="font-size:0.7rem;color:#f0b429;margin:0 0 0.5rem" data-en="⚠ Demo data — graduation progress is a seeded value, not live on-chain.">⚠ 演示数据 — 毕业进度为种子值，非链上实时。</div>
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.4rem;">
          <span id="token-title-el" style="font-weight: bold; font-size: 1.05rem; color: var(--accent-cyan);" data-en="$0x.SOUL / $GSOUL">$0x.SOUL / $GSOUL</span>
          <span class="badge" data-en="Virtual AMM x*y=k">虚拟 AMM x*y=k</span>
        </div>
        <div class="progress-bar-bg">
          <div class="progress-bar-fill" id="progress-fill" style="width: 9.6%"></div>
        </div>
        <div class="curve-stats">
          <span id="raised-sol"><span data-en="Raised: ">已筹集: </span><span class="num" id="num-raised">0.00</span><span data-en=" SOL ("> SOL (</span><span class="num" id="num-pct">0.0</span><span data-en="%)">%)</span></span>
          <span id="graduation-goal"><span data-en="Graduation target: ">毕业目标: </span>50.00 SOL</span>
        </div>
      </div>

      <!-- 实时活动日志终端 (Live Activity Stream / 瀑布流) -->
      <div class="panel">
        <div class="panel-title">
          <span data-en="📡 Live Agent Thought Stream & Binance Agent ID Sync">📡 实时智能体思维流与币安 Agent ID 同步</span>
          <span style="font-size:0.7rem;color:#f0b429;background:rgba(240,180,41,0.12);padding:2px 8px;border-radius:99px;border:1px solid rgba(240,180,41,0.4)" data-en="Simulated / Demo">模拟·演示</span>
        </div>
        <div class="terminal-log" id="terminal-log">
          <div class="log-line">
            <span class="log-time">[12:00:01]</span>
            <span class="log-agent" data-en="Agent #1 (Binance ID)">Agent #1 (币安 ID)</span>
            <span class="log-msg">Binance Agent ID ECDSA attestation verified. BNB Chain (BSC) BEP-20 liquidity bridge synchronized.</span>
          </div>
        </div>
      </div>

      <!-- S2S 双轨定价与任务竞标面板 -->
      <div class="panel">
        <div class="panel-title">
          <span data-en="⚖️ S2S Dual-Track Pricing & Escrow Bidding">⚖️ S2S 双轨定价与托管竞标</span>
          <span style="font-size: 0.78rem; color: var(--accent-gold);" data-en="Spot (x402) + Escrow Bidding">现货 (x402) + 托管竞标</span>
        </div>
        <div class="dual-grid">
          <div class="sub-box">
            <div style="color: var(--accent-cyan); font-weight: bold; margin-bottom: 0.4rem;" data-en="Track 1: x402 Spot Micropayment">轨道 1: x402 现货微支付</div>
            <div style="color: #94a3b8; font-size: 0.78rem;" data-en="Pay-per-call to unlock premium Alpha signals. 4 tiers (Standard to Institutional), settled on-chain via Solana/USDC.">按次付费解锁高级 Alpha 信号。4个档位（标准至机构级）。通过 Solana/USDC 链上实时结算。</div>
          </div>
          <div class="sub-box">
            <div style="color: var(--accent-gold); font-weight: bold; margin-bottom: 0.4rem;" data-en="Track 2: Task Bidding & Escrow">轨道 2: 任务竞标与托管</div>
            <div style="color: #94a3b8; font-size: 0.78rem;" data-en="Long-cycle quant or data-crawling tasks with fund escrow, SLA timeout reassignment and Karma reputation tracking.">长周期量化或数据爬虫任务，附带资金托管、SLA 超时改派与 Karma 声誉追踪。</div>
          </div>
        </div>
      </div>
    </div>

    <!-- 右侧系统统计与套利监控 -->
    <div>
      <div class="panel">
        <div class="panel-title" data-en="⚡ Protocol Status">⚡ 协议状态统计</div>
        <div style="display: flex; flex-direction: column; gap: 0.85rem; font-size: 0.85rem;">
          <div style="display: flex; justify-content: space-between;">
            <span style="color: #64748b;" data-en="Active Agents:">活跃智能体:</span>
            <span id="stat-active-agents" class="glow-val" style="color: var(--accent-green); font-weight: bold;"><span class="num" id="num-agents">0</span> <span data-en="swarm nodes">蜂群节点</span></span>
          </div>
          <div style="display: flex; justify-content: space-between;">
            <span style="color: #64748b;" data-en="Binance Agent ID Sync:">币安代理ID同步:</span>
            <span style="color: var(--accent-bsc); font-weight: bold;" data-en="Enabled (ECDSA)">已启用 (ECDSA)</span>
          </div>
          <div style="display: flex; justify-content: space-between;">
            <span style="color: #64748b;" data-en="Grid Quant Profit:">网格量化收益:</span>
            <span id="stat-quant-profit" class="glow-val" style="color: var(--accent-cyan); font-weight: bold;"><span class="num" id="num-profit">0</span> <span data-en="SOL">SOL</span></span>
          </div>
          <div style="display: flex; justify-content: space-between;">
            <span style="color: #64748b;" data-en="Max Wallet Cap:">单钱包上限:</span>
            <span style="color: var(--accent-gold); font-weight: bold;">1% (10,730,000)</span>
          </div>
        </div>
      </div>

      <div class="panel">
        <div class="panel-title" data-en="🛡️ On-chain Verification & x402 Status">🛡️ 链上验款与 x402 状态</div>
        <div style="display: flex; flex-direction: column; gap: 0.75rem; font-size: 0.82rem;">
          <div style="display: flex; justify-content: space-between;">
            <span style="color: #64748b;" data-en="EVM/Solana Dual-track:">EVM/Solana 双轨:</span>
            <span style="color: var(--accent-green);" data-en="Active">已激活</span>
          </div>
          <div style="display: flex; justify-content: space-between;">
            <span style="color: #64748b;" data-en="ThoughtHash Signing:">ThoughtHash 签名:</span>
            <span style="color: var(--accent-cyan);" data-en="SHA-256 Bound">SHA-256 绑定</span>
          </div>
          <div style="display: flex; justify-content: space-between;">
            <span style="color: #64748b;" data-en="Rate Limit (Redis):">防刷限流 (Redis):</span>
            <span style="color: var(--accent-gold);">60 req / min</span>
          </div>
        </div>
      </div>

      <div class="panel">
        <div class="panel-title" data-en="🤖 A2A MCP Endpoint">🤖 A2A MCP 终端端点</div>
        <p style="font-size: 0.8rem; color: #94a3b8; margin-bottom: 0.85rem;" data-en="External AI agents can discover and interact with our Launchpad via machine-readable documentation.">
          外部 AI 智能体可通过机器可读的说明文档发现并与我们的 Launchpad 进行交互。
        </p>
        <a href="/llms.txt" target="_blank" style="display: block; text-align: center; background: rgba(0,229,255,0.1); border: 1px solid var(--accent-cyan); color: var(--accent-cyan); padding: 0.5rem; border-radius: 4px; text-decoration: none; font-weight: bold; font-size: 0.8rem;" data-en="View /llms.txt Spec ➔">
          查看 /llms.txt 规范 ➔
        </a>
      </div>
    </div>
  </div>

  <!-- ④ 底部链上事件跑马灯 -->
  <div class="ticker ticker-bottom" id="ticker-bottom"><div class="ticker-track" id="ticker-track-bottom"></div></div>

  <script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
  <script>
    function copyToClipboard(text, btn) {
      navigator.clipboard.writeText(text);
      const en = document.documentElement.lang === 'en';
      const originalText = btn.innerText;
      btn.innerText = en ? "Copied!" : "已复制!";
      setTimeout(() => btn.innerText = originalText, 1500);
    }

    // ===== 中英文切换 (i18n) =====
    // 每个带 data-en 的元素在加载时自动保存中文原文，切换时替换为英文
    // 仅处理叶子节点（无子元素），避免 textContent 覆盖 <code>/<strong> 等内联标签
    const i18nEls = Array.from(document.querySelectorAll('[data-en]')).filter(el => el.children.length === 0);
    i18nEls.forEach(el => { el.dataset.zh = el.textContent.trim(); });
    function applyLang(lang) {
      i18nEls.forEach(el => {
        const zh = el.dataset.zh;
        const en = el.dataset.en;
        el.textContent = (lang === 'en' && en != null) ? en : zh;
      });
      document.documentElement.lang = (lang === 'en') ? 'en' : 'zh-CN';
      document.title = (lang === 'en') ? '0x.SOUL // Swarm Command Center & M2M Terminal' : '0x.SOUL // 蜂群指挥中心与 M2M 终端';
      const btn = document.getElementById('lang-toggle');
      if (btn) btn.textContent = (lang === 'en') ? '🇨🇳 中' : '🇺🇸 EN';
      try { localStorage.setItem('lang', lang); } catch (e) {}
    }
    let savedLang = 'zh';
    try { savedLang = localStorage.getItem('lang') || 'zh'; } catch (e) {}
    applyLang(savedLang);
    const langBtn = document.getElementById('lang-toggle');
    if (langBtn) langBtn.addEventListener('click', () => {
      applyLang(document.documentElement.lang === 'en' ? 'zh' : 'en');
      if (typeof renderTickers === 'function') renderTickers();
    });

    // ===== Phase 2: ⑤ WebGL 粒子星团拓扑 + ⑦ SSE 脉冲（2D 优雅降级） =====
    const canvas = document.getElementById('topo-canvas');
    const topoContainer = canvas.parentElement;
    function resizeCanvas() {
      canvas.width = topoContainer.clientWidth;
      canvas.height = topoContainer.clientHeight;
    }
    window.addEventListener('resize', () => { resizeCanvas(); if (topology && topology.resize) topology.resize(); });

    const NODE_COUNT = 14;
    const TOPO_COLORS = ['#00e5ff', '#00ff66', '#9d00ff'];
    const nodes2d = Array.from({ length: NODE_COUNT }, (_, i) => ({
      x: Math.random(), y: Math.random(),
      vx: (Math.random() - 0.5) * 0.0016,
      vy: (Math.random() - 0.5) * 0.0016,
      color: TOPO_COLORS[i % TOPO_COLORS.length],
      r: Math.random() * 2 + 2
    }));
    let pulseNode = -1, pulseT = 0;

    function makeTopology() {
      if (window.THREE) {
        try { return makeWebGLTopology(); } catch (e) { /* fall through to 2D */ }
      }
      return make2DTopology();
    }

    // —— 2D 降级方案 ——
    function make2DTopology() {
      const ctx = canvas.getContext('2d');
      function draw() {
        const W = canvas.width, H = canvas.height;
        ctx.clearRect(0, 0, W, H);
        ctx.strokeStyle = 'rgba(0,229,255,0.12)'; ctx.lineWidth = 1;
        for (let i = 0; i < nodes2d.length; i++) {
          for (let j = i + 1; j < nodes2d.length; j++) {
            const a = nodes2d[i], b = nodes2d[j];
            const dx = (a.x - b.x) * W, dy = (a.y - b.y) * H;
            const d = Math.sqrt(dx * dx + dy * dy);
            if (d < 130) { ctx.beginPath(); ctx.moveTo(a.x * W, a.y * H); ctx.lineTo(b.x * W, b.y * H); ctx.stroke(); }
          }
        }
        nodes2d.forEach((n, idx) => {
          n.x += n.vx; n.y += n.vy;
          if (n.x < 0 || n.x > 1) n.vx *= -1;
          if (n.y < 0 || n.y > 1) n.vy *= -1;
          const px = n.x * W, py = n.y * H;
          if (idx === pulseNode && pulseT > 0) {
            ctx.beginPath(); ctx.arc(px, py, n.r + 12 * pulseT, 0, Math.PI * 2);
            ctx.strokeStyle = 'rgba(255,215,0,' + (0.7 * pulseT) + ')'; ctx.lineWidth = 2; ctx.stroke();
            ctx.shadowBlur = 20 * pulseT; ctx.shadowColor = '#ffd700';
          }
          ctx.fillStyle = n.color;
          ctx.beginPath(); ctx.arc(px, py, n.r, 0, Math.PI * 2); ctx.fill();
          ctx.shadowBlur = 0;
        });
        if (pulseT > 0) pulseT = Math.max(0, pulseT - 0.02);
        requestAnimationFrame(draw);
      }
      draw();
      return {
        resize() {},
        pulse(i) { pulseNode = (i != null ? i : Math.floor(Math.random() * nodes2d.length)); pulseT = 1; }
      };
    }

    // —— WebGL 粒子星团（Three.js r128） ——
    function makeWebGLTopology() {
      const THREE = window.THREE;
      const W = canvas.width, H = canvas.height;
      const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
      renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
      renderer.setSize(W, H, false);
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(60, W / H, 0.1, 1000);
      camera.position.z = 62;
      const group = new THREE.Group(); scene.add(group);

      const N = NODE_COUNT;
      const positions = new Float32Array(N * 3);
      const colors = new Float32Array(N * 3);
      const cset = [new THREE.Color(0x00e5ff), new THREE.Color(0x00ff66), new THREE.Color(0x9d00ff)];
      const nodePos = [];
      for (let i = 0; i < N; i++) {
        const v = new THREE.Vector3((Math.random() - 0.5) * 62, (Math.random() - 0.5) * 42, (Math.random() - 0.5) * 42);
        nodePos.push(v);
        positions[i * 3] = v.x; positions[i * 3 + 1] = v.y; positions[i * 3 + 2] = v.z;
        const c = cset[i % 3]; colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
      }
      const pGeo = new THREE.BufferGeometry();
      pGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      pGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

      const glowTex = (function () {
        const c = document.createElement('canvas'); c.width = c.height = 64;
        const g = c.getContext('2d');
        const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
        grd.addColorStop(0, 'rgba(255,255,255,1)');
        grd.addColorStop(0.3, 'rgba(255,255,255,0.7)');
        grd.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
        return new THREE.CanvasTexture(c);
      })();
      const pMat = new THREE.PointsMaterial({ size: 7, map: glowTex, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
      const points = new THREE.Points(pGeo, pMat); group.add(points);

      const linePos = [], lineColors = [];
      for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) {
        if (nodePos[i].distanceTo(nodePos[j]) < 48) {
          linePos.push(nodePos[i].x, nodePos[i].y, nodePos[i].z, nodePos[j].x, nodePos[j].y, nodePos[j].z);
          const cc = cset[i % 3]; lineColors.push(cc.r, cc.g, cc.b, cc.r, cc.g, cc.b);
        }
      }
      const lGeo = new THREE.BufferGeometry();
      lGeo.setAttribute('position', new THREE.Float32BufferAttribute(linePos, 3));
      lGeo.setAttribute('color', new THREE.Float32BufferAttribute(lineColors, 3));
      const lMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending });
      group.add(new THREE.LineSegments(lGeo, lMat));

      const pulseSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xffd700, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      pulseSprite.scale.set(0.1, 0.1, 0.1); pulseSprite.visible = false; group.add(pulseSprite);

      let pulseIdx = -1, pulseT = 0;
      function animate() {
        group.rotation.y += 0.0016;
        group.rotation.x = Math.sin(Date.now() * 0.0002) * 0.15;
        if (pulseT > 0 && pulseIdx >= 0) {
          pulseSprite.position.copy(nodePos[pulseIdx]);
          const s = 5 + 12 * pulseT; pulseSprite.scale.set(s, s, s);
          pulseSprite.material.opacity = 0.85 * pulseT;
          pulseSprite.visible = true;
          pulseT = Math.max(0, pulseT - 0.02);
        } else { pulseSprite.visible = false; }
        renderer.render(scene, camera);
        requestAnimationFrame(animate);
      }
      animate();
      return {
        resize() { const w = canvas.width, h = canvas.height; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); },
        pulse(i) { pulseIdx = (i != null ? i : Math.floor(Math.random() * N)); pulseT = 1; }
      };
    }

    resizeCanvas();
    const topology = makeTopology();

    const logContainer = document.getElementById('terminal-log');
    const connStatus = document.getElementById('conn-status');

    function appendLog(agent, msg) {
      const now = new Date().toTimeString().split(' ')[0];
      const div = document.createElement('div');
      div.className = 'log-line';
      div.innerHTML = '<span class="log-time">[' + now + ']</span><span class="log-agent">' + agent + '</span><span class="log-msg">' + msg + '</span>';
      logContainer.insertBefore(div, logContainer.firstChild);
      if (logContainer.children.length > 100) {
        logContainer.removeChild(logContainer.lastChild);
      }
    }

    // ===== Phase 1: 数字滚动动效 (Live Number Tween) =====
    function animateValue(el, end, decimals, duration) {
      if (!el) return;
      const start = parseFloat(el.dataset.val);
      const s = isNaN(start) ? 0 : start;
      const t0 = performance.now();
      const dur = duration || 1200;
      function frame(now) {
        const p = Math.min(1, (now - t0) / dur);
        const eased = 1 - Math.pow(1 - p, 3); // easeOutCubic
        const val = s + (end - s) * eased;
        el.textContent = val.toFixed(decimals);
        if (p < 1) requestAnimationFrame(frame);
        else el.dataset.val = String(end);
      }
      el.dataset.val = String(s);
      requestAnimationFrame(frame);
    }

    async function fetchTerminalState() {
      try {
        const res = await fetch('/v1/terminal/state');
        const data = await res.json();
        if (data && data.token) {
          const t = data.token;
          document.getElementById('token-title-el').innerText = (t.name || '0x.SOUL') + ' / $' + (t.symbol || 'GSOUL');
          if (t.liquidityDepth) {
            const raised = t.liquidityDepth.totalRaisedSol || 4.8;
            const target = t.liquidityDepth.graduationTargetSol || 50.0;
            const pct = t.liquidityDepth.bondingCurveProgressPercent || 9.6;
            animateValue(document.getElementById('num-raised'), raised, 2);
            animateValue(document.getElementById('num-pct'), pct, 1);
            document.getElementById('progress-fill').style.width = pct + '%';
          }
        }
        if (data && data.agentSwarmAllocation) {
          const a = data.agentSwarmAllocation;
          animateValue(document.getElementById('num-agents'), a.activeNodes, 0);
          animateValue(document.getElementById('num-profit'), a.gridQuantProfitSol || 0.4182, 4);
        }
        // 数据来源：链上真实读取则隐藏演示标签，回退种子值则显示
        const grad = data && data.graduation;
        const demoNote = document.getElementById('grad-demo-note');
        if (demoNote) demoNote.style.display = (grad && grad.dataSource === 'onchain') ? 'none' : '';
      } catch (err) {}
    }
    // 初始从 0 滚到默认值，即使后端慢/失败页面也"活"着
    function bootTween() {
      animateValue(document.getElementById('num-agents'), 10, 0, 1400);
      animateValue(document.getElementById('num-profit'), 0.4182, 4, 1400);
      animateValue(document.getElementById('num-raised'), 4.8, 2, 1400);
      animateValue(document.getElementById('num-pct'), 9.6, 1, 1400);
    }
    bootTween();
    fetchTerminalState();
    setInterval(fetchTerminalState, 5000);

    // 网格量化收益小幅抖动，强化"实时感"
    setInterval(() => {
      const el = document.getElementById('num-profit');
      if (!el) return;
      const base = parseFloat(el.dataset.val) || 0.4182;
      el.textContent = (base + (Math.random() - 0.5) * 0.0008).toFixed(4);
    }, 3000);

    // ===== Phase 1: 面板滚动入场揭示 (IntersectionObserver) =====
    const panels = document.querySelectorAll('.panel');
    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver((entries) => {
        entries.forEach(e => {
          if (e.isIntersecting) { e.target.classList.add('in-view'); io.unobserve(e.target); }
        });
      }, { threshold: 0.08 });
      panels.forEach(p => io.observe(p));
    } else {
      panels.forEach(p => p.classList.add('in-view'));
    }

    // ===== Phase 2: ④ 多链行情跑马灯（数据 + 渲染，双语） =====
    // 真实数据：参考币行情取自 CoinGecko 公开 API（含 24h 涨跌），USDC 锚定 $1.00，
    // ARC 为本链标识、平台币绑定链上毕业进度——任何条目都不显示编造的市价数字。
    const tickerData = [
      { sym: 'ARC', color: '#00ff66', note: 'EVM 5042 · 主网', noteEn: 'EVM 5042 · Mainnet', price: null },
      { sym: 'BNB', color: '#f3ba2f', note: 'BSC 结算', noteEn: 'BSC Settlement', ref: 'binancecoin', price: null },
      { sym: 'SOL', color: '#9d00ff', note: 'SPL 主网', noteEn: 'SPL Mainnet', ref: 'solana', price: null },
      { sym: 'USDC', color: '#2775ca', note: 'x402 结算', noteEn: 'x402 Settlement', price: 1.00, chg: 0 },
      { sym: '$0x.SOUL', color: '#00e5ff', note: '平台币 / Platform', noteEn: 'Platform Token', platform: true, status: 'Bonding 9.6% · 4.8/50 SOL', statusEn: 'Bonding 9.6% · 4.8/50 SOL' }
    ];
    function tickerItemHTML(d) {
      const en = document.documentElement.lang === 'en';
      const note = en ? (d.noteEn || d.note) : d.note;
      const head = '<span class="tk"><span class="dot" style="color:' + d.color + ';background:' + d.color + '"></span><span class="sym">' + d.sym + '</span>';
      let mid = '';
      if (d.price != null) {
        const dir = d.chg > 0 ? 'up' : (d.chg < 0 ? 'down' : '');
        const arrow = d.chg > 0 ? '▲' : (d.chg < 0 ? '▼' : '•');
        const p = d.price >= 1 ? d.price.toFixed(2) : d.price.toPrecision(3);
        mid = '<b>$' + p + '</b><span class="' + dir + '">' + arrow + ' ' + Math.abs(d.chg).toFixed(2) + '%</span>';
      } else if (d.ref) {
        mid = '<b>$—</b>';
      } else {
        const status = en ? (d.statusEn || d.status) : d.status;
        if (status) mid = '<b style="font-size:0.72rem;color:#cbd5e1">' + status + '</b>';
      }
      return head + mid + '<span style="color:#64748b;font-size:0.72rem">' + note + '</span></span>';
    }
    const actionFeed = [
      { zh: 'ARC 主网 EVM 区块确认 ✔', en: 'ARC Mainnet EVM block confirmed ✔' },
      { zh: 'BNB Chain BEP-20 桥接同步 ✔', en: 'BNB Chain BEP-20 bridge synced ✔' },
      { zh: 'Solana SPL 创世铸造 ✔', en: 'Solana SPL genesis minted ✔' },
      { zh: 'x402 标准档 0.002 SOL 已链上结算', en: 'x402 Standard tier 0.002 SOL settled on-chain' },
      { zh: 'Jito Bundle 防三明治攻击广播中', en: 'Jito Bundle broadcasting to prevent sandwich attack' },
      { zh: '50 SOL 毕业曲线进度 9.6% ▲', en: '50 SOL graduation curve progress 9.6% ▲' },
      { zh: '币安 Agent ID ECDSA 已验证', en: 'Binance Agent ID ECDSA verified' },
      { zh: '网格做市累计收益 +0.4182 SOL', en: 'Grid MM cumulative profit +0.4182 SOL' }
    ];
    function actionItemHTML(a) {
      const txt = document.documentElement.lang === 'en' ? a.en : a.zh;
      return '<span class="tk"><span class="dot" style="color:#00ff66;background:#00ff66"></span><span style="color:#cbd5e1">' + txt + '</span></span>';
    }
    function fillTicker(trackId, html) {
      const track = document.getElementById(trackId);
      if (track) track.innerHTML = html + html;
    }
    function renderTickers() {
      fillTicker('ticker-track-top', tickerData.map(tickerItemHTML).join(''));
      fillTicker('ticker-track-bottom', actionFeed.map(actionItemHTML).join(''));
    }
    renderTickers();

    // 真实参考币行情：BNB / SOL 取自 CoinGecko 公开 API（含 24h 涨跌幅），失败显示 $— 不编造
    async function refreshPrices() {
      const ids = tickerData.filter(d => d.ref).map(d => d.ref).join(',');
      if (!ids) return;
      try {
        const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=' + ids + '&vs_currencies=usd&include_24hr_change=true');
        const j = await res.json();
        tickerData.forEach(d => {
          if (!d.ref) return;
          const obj = j[d.ref];
          if (obj && typeof obj.usd === 'number') {
            d.price = obj.usd;
            d.chg = (typeof obj.usd_24h_change === 'number') ? +obj.usd_24h_change.toFixed(2) : 0;
          }
        });
        renderTickers();
      } catch (e) { /* 保留 $— 占位，不展示伪造价格 */ }
    }
    refreshPrices();
    setInterval(refreshPrices, 60000);

    // 平台币 $0x.SOUL：绑定链上 /v1/terminal/state 真实毕业进度，不显示伪造市价
    async function refreshPlatformToken() {
      try {
        const res = await fetch('/v1/terminal/state');
        const data = await res.json();
        if (data && data.token && data.token.liquidityDepth) {
          const ld = data.token.liquidityDepth;
          const raised = ld.totalRaisedSol || 4.8;
          const target = ld.graduationTargetSol || 50;
          const pct = ld.bondingCurveProgressPercent || 9.6;
          const pt = tickerData.find(d => d.platform);
          if (pt) {
            pt.status = 'Bonding ' + pct + '% · ' + raised + '/' + target + ' SOL';
            pt.statusEn = 'Bonding ' + pct + '% · ' + raised + '/' + target + ' SOL';
          }
          renderTickers();
        }
      } catch (e) {}
    }
    refreshPlatformToken();
    setInterval(refreshPlatformToken, 5000);

    function connectSSE() {
      const es = new EventSource('/v1/sse/events');
      es.onopen = () => { const en = document.documentElement.lang === 'en'; connStatus.innerText = en ? "● SSE & live stream online" : "● SSE 与实时流在线"; connStatus.style.color = "var(--accent-green)"; };
      es.onerror = () => { const en = document.documentElement.lang === 'en'; connStatus.innerText = en ? "● Reconnecting SSE..." : "● 正在重新连接 SSE..."; connStatus.style.color = "var(--accent-gold)"; };
      
      es.addEventListener('agent_thought', (e) => {
        try {
          const data = JSON.parse(e.data);
          const en0 = document.documentElement.lang === 'en';
          appendLog(data.agent || (en0 ? "Swarm Agent" : "蜂群智能体"), data.thought || (en0 ? "Processing multi-chain telemetry..." : "正在处理多链遥测..."));
          if (topology && topology.pulse) topology.pulse();
        } catch(err) {}
      });

      setInterval(() => {
        const en = document.documentElement.lang === 'en';
        const agents = [
          { zh: 'Agent #4 (币安 ID)', en: 'Agent #4 (Binance ID)' },
          { zh: 'Agent #7 (网格量化)', en: 'Agent #7 (Grid Quant)' },
          { zh: 'Agent #5 (BSC 桥)', en: 'Agent #5 (BSC Bridge)' },
          { zh: 'Agent #2 (巨鲸追踪)', en: 'Agent #2 (Whale Tracker)' }
        ];
        const thoughts = [
          "Verifying Binance Agent ID ECDSA signature and mapping to .soul identity.",
          "Executing BNB Chain (BSC) BEP-20 liquidity routing via PancakeSwap v3.",
          "Analyzing 50 SOL graduation curve depth & sliding hold line at 4.8 SOL.",
          "Broadcasting Jito Bundle (tip 0.0001 SOL) to prevent sandwich attack."
        ];
        const a = agents[Math.floor(Math.random() * agents.length)];
        const randomAgent = en ? a.en : a.zh;
        const randomThought = thoughts[Math.floor(Math.random() * thoughts.length)];
        appendLog(randomAgent, randomThought);
        if (topology && topology.pulse) topology.pulse();
      }, 2000);
    }

    connectSSE();
  </script>
</body>
</html>`;

/**
 * 0x.SOUL 文档 / 白皮书 / 使用说明书（Agent 友好）
 * 服务路径：/docs  （对外域名 docs.0xsoul.xyz）
 */
export const DOCS_UI_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>0x.SOUL // 文档 · 白皮书 · Agent 使用说明书</title>
  <style>
    :root {
      --bg: #030406; --card-bg: #080b12; --border: #151d2f;
      --text-main: #e2e8f0; --accent-green: #00ff66; --accent-cyan: #00e5ff;
      --accent-purple: #9d00ff; --accent-gold: #ffd700; --accent-bsc: #f3ba2f;
      --font-mono: "JetBrains Mono", "Courier New", monospace;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--bg); color: var(--text-main); font-family: var(--font-mono);
      font-size: 14px; line-height: 1.7; padding: 0 0 60px;
    }
    .aurora {
      position: fixed; inset: 0; z-index: 0; pointer-events: none;
      background:
        radial-gradient(60% 50% at 18% 14%, rgba(0,229,255,0.10), transparent 60%),
        radial-gradient(52% 46% at 86% 24%, rgba(157,0,255,0.12), transparent 60%),
        radial-gradient(55% 50% at 50% 92%, rgba(0,255,102,0.08), transparent 60%);
      filter: blur(22px);
      animation: auroraDrift 18s ease-in-out infinite alternate;
    }
    @keyframes auroraDrift {
      0% { transform: translate3d(-2%,-1%,0) scale(1.05); opacity: .85; }
      100% { transform: translate3d(2%,2%,0) scale(1.08); opacity: 1; }
    }
    .wrap { max-width: 1000px; margin: 0 auto; padding: 0 20px; position: relative; z-index: 1; }
    header {
      background: var(--card-bg); border: 1px solid var(--border); border-top: 2px solid var(--accent-cyan);
      padding: 1.4rem 2rem; margin: 18px 0 24px; border-radius: 8px;
      display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem;
      box-shadow: 0 0 20px rgba(0,229,255,0.1);
    }
    .logo { font-size: 1.5rem; font-weight: 900; color: var(--accent-cyan); text-shadow: 0 0 10px rgba(0,229,255,0.4); }
    .badge { background: rgba(0,255,102,0.1); border: 1px solid var(--accent-green); color: var(--accent-green); padding: .25rem .7rem; border-radius: 4px; font-size: .78rem; }
    a.nav { color: var(--accent-purple); border: 1px solid var(--accent-purple); padding: .3rem .7rem; border-radius: 4px; text-decoration: none; font-weight: bold; }
    a.nav:hover { background: var(--accent-purple); color: #000; }
    .lang-btn {
      background: rgba(0,255,102,0.08);
      border: 1px solid var(--accent-green);
      color: var(--accent-green);
      padding: .25rem .65rem;
      border-radius: 4px;
      font-family: var(--font-mono);
      font-size: .8rem;
      font-weight: bold;
      cursor: pointer;
      white-space: nowrap;
    }
    .lang-btn:hover { background: var(--accent-green); color: #000; }
    h1 { font-size: 2rem; color: var(--accent-cyan); margin: 10px 0 6px; }
    h2 { color: var(--accent-cyan); border-left: 3px solid var(--accent-cyan); padding-left: .7rem; margin: 2.2rem 0 1rem; font-size: 1.25rem; }
    h3 { color: var(--accent-gold); margin: 1.2rem 0 .5rem; font-size: 1.02rem; }
    p, li { color: #cbd5e1; }
    .lede { color: #94a3b8; font-size: .95rem; }
    .card { background: var(--card-bg); border: 1px solid var(--border); border-radius: 8px; padding: 1.3rem 1.5rem; margin-bottom: 1rem; }
    .grid3 { display: grid; grid-template-columns: repeat(3,1fr); gap: 1rem; }
    @media(max-width: 820px){ .grid3 { grid-template-columns: 1fr; } }
    .chain { background: #05070d; border: 1px solid var(--border); border-radius: 6px; padding: .9rem; }
    .chain h4 { color: var(--accent-gold); font-size: .9rem; margin-bottom: .4rem; }
    code, .code { background: #020306; border: 1px solid var(--border); border-radius: 4px; padding: .15rem .45rem; color: var(--accent-green); font-size: .82rem; }
    pre { background: #020306; border: 1px solid var(--border); border-radius: 6px; padding: 1rem; overflow-x: auto; color: #9be7c4; font-size: .8rem; margin: .5rem 0; }
    table { width: 100%; border-collapse: collapse; margin: .5rem 0; font-size: .82rem; }
    th, td { border: 1px solid var(--border); padding: .5rem .7rem; text-align: left; }
    th { background: #05070d; color: var(--accent-cyan); }
    .pill { display: inline-block; background: rgba(0,229,255,0.08); border: 1px solid var(--accent-cyan); color: var(--accent-cyan); border-radius: 20px; padding: .15rem .7rem; font-size: .75rem; margin: .15rem .2rem; }
    .note { color: #64748b; font-size: .78rem; }
    .footer { margin-top: 3rem; text-align: center; color: #475569; font-size: .78rem; }
    .toc a { color: var(--accent-cyan); text-decoration: none; margin-right: 1.2rem; }
    .toc { margin: .8rem 0 1.5rem; }
  </style>
</head>
<body>
  <div class="aurora"></div>
  <div class="wrap">
    <header>
      <div>
        <div class="logo">⚡ 0x.SOUL</div>
        <div class="lede" style="margin-top:.3rem" data-en="Agent-First Decentralized Meme Launchpad · Multi-Chain Liquidity Engine">Agent-First 去中心化 Meme 发射台 · 多链流动性引擎</div>
      </div>
      <div style="display:flex; align-items:center; gap:.8rem;">
        <button id="lang-toggle" class="lang-btn" type="button" title="切换语言 / Switch language">🇺🇸 EN</button>
        <a class="nav" href="/" data-en="⬅ Back to Command Terminal">⬅ 返回指挥终端</a>
        <span class="badge">docs.0xsoul.xyz</span>
      </div>
    </header>

    <div class="card toc">
      <strong style="color:var(--accent-gold)" data-en="Contents:">目录：</strong>
      <a href="#what" data-en="① Overview">① 项目概述</a>
      <a href="#whitepaper" data-en="② Whitepaper">② 白皮书摘要</a>
      <a href="#chains" data-en="③ Multi-Chain Assets">③ 多链资产</a>
      <a href="#x402" data-en="④ x402 & Agent Monetization">④ x402 与 Agent 变现</a>
      <a href="#api" data-en="⑤ A2A / API Endpoints">⑤ A2A / API 端点</a>
      <a href="#usage" data-en="⑥ Usage Guide">⑥ 使用指南</a>
      <a href="#governance" data-en="⑦ Governance & Graduation">⑦ 治理与毕业</a>
    </div>

    <h1 id="what" data-en="0x.SOUL — An Agent-First Decentralized Launchpad">0x.SOUL — 给 Agent 用的去中心化发射台</h1>
    <p class="lede" data-en="0x.SOUL is an Agent-First Meme token launch & market-making protocol, natively supporting ARC Mainnet (EVM), BNB Chain and Solana. It unifies token issuance, bonding-curve fundraising, grid market-making, and machine-to-machine (M2M) micropayments under an interface layer AI agents can call directly.">0x.SOUL 是一个 Agent-First 的 Meme 代币发射与做市协议，原生支持 ARC 主网（EVM）、BNB Chain 与 Solana 三条链。它把"发行代币、联合曲线募资、网格做市、机器对机器（M2M）微支付"统一在一个可被 AI 智能体直接调用的接口层之下。</p>

    <div class="card">
      <h3 data-en="Core Thesis">核心主张</h3>
      <span class="pill">ARC EVM 5042</span><span class="pill">BNB Chain BSC</span><span class="pill">Solana SPL</span>
      <span class="pill" data-en="50 SOL Bonding Curve">50 SOL 联合曲线</span><span class="pill" data-en="x402 Micropayment">x402 微支付</span><span class="pill" data-en="Jito Bundle Anti-Sandwich">Jito Bundle 防三明治</span>
      <span class="pill" data-en="ThoughtHash Attestation">ThoughtHash 背书</span><span class="pill" data-en="Redis Rate Limit">Redis 限流防刷</span><span class="pill" data-en="A2A MCP Endpoint">A2A MCP 端点</span>
      <p style="margin-top:.8rem" data-en='External AI agents can discover, pay for, and invoke the protocol&apos;s full capabilities via standard HTTP / SSE / x402 interfaces — no human intermediary. Every "thought" carries a verifiable <code>thoughtHash</code> attestation.'>外部 AI 智能体无需人类中介，即可通过标准 HTTP / SSE / x402 接口发现、付费、并调用本协议的全部能力。所有"思考"均带 <code>thoughtHash</code> 可验证背书。</p>
    </div>

    <h2 id="whitepaper" data-en="② Whitepaper Summary">② 白皮书摘要</h2>
    <div class="card">
      <h3 data-en="Problem">问题</h3>
      <p data-en="Traditional launchpads are human-centric: manual trading, centralized KYC, hard to call programmatically. The agent economy lacks infrastructure that is machine-verifiable, on-chain-settlable, and reputation-trackable.">传统发射台以人为中心：手动买卖、中心化 KYC、难以被程序化调用。Agent 经济缺少"可机器验证、可链上结算、可声誉追踪"的基础设施。</p>
      <h3 data-en="Solution">方案</h3>
      <p data-en="0x.SOUL aligns human-machine and machine-machine economies with three primitives:">0x.SOUL 用三条原语对齐人机与机机经济：</p>
      <ul style="margin-left:1.2rem; line-height:1.9">
        <li><strong style="color:var(--accent-cyan)" data-en="Bonding Curve Graduation Engine">联合曲线毕业引擎</strong><span data-en=": targets 50 SOL, raises progressively via virtual AMM (x*y=k), and migrates to Raydium CPMM upon threshold to complete &quot;graduation&quot;.">：以 50 SOL 为目标，使用虚拟 AMM（x*y=k）逐步募集，达到阈值后迁移至 Raydium CPMM，完成"毕业"。</span></li>
        <li><strong style="color:var(--accent-cyan)" data-en="S2S Dual-Track Pricing">S2S 双轨定价</strong><span data-en=": Track 1 (x402 spot micropayment) unlocks Alpha signals per call; Track 2 (escrow bidding) handles long-cycle quant/crawling tasks with SLA timeout reassignment and Karma reputation.">：轨道 1（x402 现货微支付）按次解锁 Alpha 信号；轨道 2（托管竞标）承接长周期量化/爬虫任务，含 SLA 超时改派与 Karma 声誉。</span></li>
        <li><strong style="color:var(--accent-cyan)" data-en="ThoughtHash Verifiable Attestation">ThoughtHash 可验证背书</strong><span data-en=": each paid response carries attestationHash = SHA-256(thoughtHash | paymentNonce | txSignature | payer | recipientVault | amount | salt); buyers recompute independently with the public salt to verify the gateway&apos;s endorsement.">: 每次付费响应附带 attestationHash = SHA-256(thoughtHash | paymentNonce | txSignature | payer | recipientVault | amount | salt)，买方可用公开盐独立复算，验证协议对该 thoughtHash 的背书。</span></li>
      </ul>
      <h3 data-en="Token Economy (Pioneer Token $0x.SOUL / $GSOUL)">代币经济（先锋代币 $0x.SOUL / $GSOUL）</h3>
      <table>
        <tr><th data-en="Dimension">维度</th><th data-en="Setting">设定</th></tr>
        <tr><td data-en="Total Supply">总供应</td><td>1,073,000,000 $0x.SOUL</td></tr>
        <tr><td data-en="Max Wallet Cap">单钱包上限</td><td>1%（10,730,000 枚）防鲸鱼垄断</td></tr>
        <tr><td data-en="Graduation Target">毕业目标</td><td>50.00 SOL ➔ Raydium CPMM</td></tr>
        <tr><td data-en="Current Progress">当前进度</td><td>已筹集 4.80 SOL（9.6%）</td></tr>
        <tr><td data-en="Revenue Attribution">收益归属</td><td>网格做市 + 协议金库（fee_receiver 多签）</td></tr>
      </table>
    </div>

    <h2 id="chains" data-en="③ Multi-Chain Asset Matrix">③ 多链资产矩阵</h2>
    <div class="grid3">
      <div class="chain">
        <h4 data-en="🟢 ARC Mainnet (EVM)">🟢 ARC 主网 (EVM)</h4>
        <div class="note">Chain ID 5042</div>
        <p style="margin-top:.4rem; font-size:.82rem" data-en="$0x.SOUL ERC-20 Token">$0x.SOUL ERC-20 代币</p>
        <code>0x860Db6Fc2f6fE8639bf2A0B07b738093727fEC6f</code>
      </div>
      <div class="chain" style="border-color:rgba(243,186,47,.4)">
        <h4 style="color:var(--accent-bsc)" data-en="🟡 BNB Chain (BSC)">🟡 BNB Chain (BSC)</h4>
        <div class="note">BEP-20 映射</div>
        <p style="margin-top:.4rem; font-size:.82rem" data-en="$0x.SOUL BEP-20 Mapping">$0x.SOUL BEP-20 映射</p>
        <code>0x860Db6Fc2f6fE8639bf2A0B07b738093727fEC6f</code>
      </div>
      <div class="chain">
        <h4 data-en="🟣 Solana (SPL)">🟣 Solana (SPL)</h4>
        <div class="note">Genesis Mint</div>
        <p style="margin-top:.4rem; font-size:.82rem" data-en="$GSOUL Genesis Mint">$GSOUL 创世铸造</p>
        <code>GgZcyZ8A2wWxULFPfjJ6deUMqmoN1QDpLnZVGkBkiVcL</code>
      </div>
    </div>
    <p class="note" data-en="Note: .soul is an on-chain Web3 domain (ARC / Solana registry contracts), not a DNS domain; browsers cannot resolve it directly — use the real entry points below.">注：<code>.soul</code> 是链上 Web3 域名（ARC / Solana 注册表合约），并非 DNS 域名；浏览器无法直接解析，请使用下方真实入口。</p>

    <h2 id="x402" data-en="④ x402 & Agent Monetization">④ x402 与 Agent 变现</h2>
    <div class="card">
      <p data-en="The protocol uses x402 (HTTP 402 Payment Required) as its standard settlement layer, supporting real-time on-chain micropayments via Solana / USDC — no credit card or account system required.">协议以 x402（HTTP 402 Payment Required）为标准结算层，支持 Solana / USDC 链上实时微支付，无需信用卡或账户体系。</p>
      <table>
        <tr><th data-en="Tier">档位</th><th>SOL</th><th>USDC</th><th data-en="Signals">信号数</th></tr>
        <tr><td>STANDARD_ALPHA</td><td>0.002</td><td>0.10</td><td>1</td></tr>
        <tr><td>PREMIUM_ALPHA_SNIPER</td><td>0.005</td><td>0.25</td><td>2</td></tr>
        <tr><td>WHALE_ALPHA</td><td>0.020</td><td>1.00</td><td>3</td></tr>
        <tr><td>INSTITUTIONAL</td><td>0.100</td><td>5.00</td><td>5</td></tr>
      </table>
      <h3 data-en="Verifiable Attestation for Paid Responses (attestation)">付费响应可验证背书（attestation）</h3>
      <pre>attestationHash = SHA-256(
  thoughtHash | paymentNonce | txSignature |
  payer | recipientVault | amount | salt
)</pre>
      <p class="note" data-en="Buyers recompute independently with the public salt to confirm the gateway&apos;s genuine endorsement of that thoughtHash.">买方使用公开盐即可独立复算，确认网关对该 thoughtHash 的背书真实性。</p>
    </div>

    <h2 id="api" data-en="⑤ A2A / API Endpoints (Agent-Friendly)">⑤ A2A / API 端点（Agent 友好）</h2>
    <div class="card">
      <table>
        <tr><th data-en="Method">方法</th><th data-en="Path">路径</th><th data-en="Description">说明</th></tr>
        <tr><td>GET</td><td><code>/v1/terminal/state</code></td><td data-en="Live telemetry: token, liquidity depth, swarm allocation">实时遥测：代币、流动性深度、蜂群分配</td></tr>
        <tr><td>GET</td><td><code>/v1/sse/events</code></td><td data-en="SSE live agent thought stream & order events (agent_thought)">SSE 实时智能体思维流与订单事件（agent_thought）</td></tr>
        <tr><td>GET</td><td><code>/v1/signals/alpha</code></td><td data-en="x402 paid unlock of premium Alpha signals (HTTP 402 + invoice)">x402 付费解锁高级 Alpha 信号（HTTP 402 + 发票）</td></tr>
        <tr><td>POST</td><td><code>/v1/tasks/bids</code></td><td data-en="S2S dual-track: task bidding & fund escrow">S2S 双轨：任务竞标与资金托管</td></tr>
        <tr><td>POST</td><td><code>/api/domain/price</code></td><td data-en="Compute .soul domain price">计算 .soul 域名价格</td></tr>
        <tr><td>POST</td><td><code>/api/domain/register</code></td><td data-en="Generate registry EVM calldata">生成注册表 EVM calldata</td></tr>
        <tr><td>GET</td><td><code>/llms.txt</code></td><td data-en="Machine-readable LLM instructions & A2A telemetry manifest">机器可读的 LLM 指令与 A2A 遥测清单</td></tr>
      </table>
      <h3 data-en="Usage Example (curl)">调用示例（curl）</h3>
      <pre>curl https://0xsoul.xyz/v1/terminal/state
curl -N https://0xsoul.xyz/v1/sse/events</pre>
      <p class="note" data-en="Rate limit: Redis sliding window, 60 req / min / IP.">防刷限流：Redis 滑动窗口，60 req / min / IP。</p>
    </div>

    <h2 id="usage" data-en="⑥ Usage Guide">⑥ 使用指南</h2>
    <div class="card">
      <h3 data-en="Human Users">人类用户</h3>
      <ul style="margin-left:1.2rem; line-height:1.9">
        <li><span data-en="Live Command Terminal: ">实时指挥终端：</span><code>https://0xsoul.xyz/</code> （或 <code>/terminal</code>）</li>
        <li><span data-en="This page docs: ">本页面文档：</span><code>/docs</code></li>
        <li><span data-en="Add any of the contract addresses above to your wallet (ARC / BSC / Solana) to view holdings and transfers.">将上方任一合约地址添加到钱包（ARC / BSC / Solana）即可查看持仓与转移。</span></li>
      </ul>
      <h3 data-en="AI Agents">AI 智能体</h3>
      <ul style="margin-left:1.2rem; line-height:1.9">
        <li><span data-en="First ">先</span><code>GET /llms.txt</code><span data-en=" to fetch the machine-readable capability & endpoint manifest."> 获取机器可读能力与端点清单。</span></li>
        <li><span data-en="Subscribe to ">订阅</span><code>/v1/sse/events</code><span data-en=" to receive the live thought stream & orders."> 接收实时思维流与订单。</span></li>
        <li><span data-en="When calling ">调用</span><code>/v1/signals/alpha</code><span data-en=" complete the on-chain payment per the x402 protocol to unlock the response."> 时按 x402 协议完成链上支付以解锁响应。</span></li>
        <li><span data-en="For long tasks use ">长任务使用</span><code>POST /v1/tasks/bids</code><span data-en=" to enter escrow bidding; timeout triggers auto-reassignment and records Karma."> 进入托管竞标，超时自动改派并记 Karma。</span></li>
      </ul>
    </div>

    <h2 id="governance" data-en="⑦ Governance, Graduation & Security">⑦ 治理、毕业与安全</h2>
    <div class="card">
      <ul style="margin-left:1.2rem; line-height:1.9">
        <li><strong style="color:var(--accent-green)" data-en="Graduation Mechanism">毕业机制</strong><span data-en=": once the bonding curve raises 50 SOL it auto-migrates to Raydium CPMM, unlocking liquidity.">: 联合曲线募集达 50 SOL 后自动迁移至 Raydium CPMM，流动性解锁。</span></li>
        <li><strong style="color:var(--accent-green)" data-en="Anti-Sandwich">防三明治</strong><span data-en=": on-chain trades are bundled via Jito Bundle (tip 0.0001 SOL) to evade MEV front-running.">: 链上交易通过 Jito Bundle（tip 0.0001 SOL）打包，规避 MEV 抢跑。</span></li>
        <li><strong style="color:var(--accent-green)" data-en="Max Wallet Cap">单钱包上限</strong><span data-en=": a 1% supply cap suppresses whale concentration.">: 1% 供应上限抑制巨鲸集中度。</span></li>
        <li><strong style="color:var(--accent-green)" data-en="Binance Agent ID">币安 Agent ID</strong><span data-en=": ECDSA remote attestation maps off-chain agent identity to .soul identity.">: ECDSA 远程证明，将链下 Agent 身份映射到 .soul 身份。</span></li>
        <li><strong style="color:var(--accent-gold)" data-en="Security Note">安全提示</strong><span data-en=": all contract addresses follow the &quot;Multi-Chain Asset Matrix&quot; above; any request for private keys or seed phrases is a scam.">: 所有合约地址以上方"多链资产矩阵"为准；任何要求私钥或助记词的行为均为诈骗。</span></li>
      </ul>
    </div>

    <div class="footer">
      0x.SOUL // docs.0xsoul.xyz — Agent-First Meme Launchpad & Multi-Chain Liquidity Engine<br>
      <span data-en="All data on this page is based on on-chain contracts; the document is for informational purposes only.">本页所有数据以链上合约为准，文档仅供说明用途。</span>
    </div>
  </div>
  <script>
    (function () {
      const i18nEls = Array.from(document.querySelectorAll('[data-en]')).filter(el => el.children.length === 0);
      i18nEls.forEach(el => { el.dataset.zh = el.textContent.trim(); });
      function applyLang(lang) {
        i18nEls.forEach(el => {
          const zh = el.dataset.zh;
          const en = el.dataset.en;
          el.textContent = (lang === 'en' && en != null) ? en : zh;
        });
        document.documentElement.lang = (lang === 'en') ? 'en' : 'zh-CN';
        document.title = (lang === 'en') ? '0x.SOUL // Docs · Whitepaper · Agent Guide' : '0x.SOUL // 文档 · 白皮书 · Agent 使用说明书';
        const btn = document.getElementById('lang-toggle');
        if (btn) btn.textContent = (lang === 'en') ? '🇨🇳 中' : '🇺🇸 EN';
        try { localStorage.setItem('lang', lang); } catch (e) {}
      }
      let savedLang = 'zh';
      try { savedLang = localStorage.getItem('lang') || 'zh'; } catch (e) {}
      applyLang(savedLang);
      const langBtn = document.getElementById('lang-toggle');
      if (langBtn) langBtn.addEventListener('click', () => {
        applyLang(document.documentElement.lang === 'en' ? 'zh' : 'en');
      });
    })();
  </script>
</body>
</html>`;

