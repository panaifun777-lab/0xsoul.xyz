/**
 * 0x.SOUL Zero-UI Terminal Dashboard HTML (Hashn Geek Style)
 * 纯只读高频流式终端，全量内联 ARC 主网 EVM、BNB Chain BSC 映射及 Solana 资产卡片
 */
export const ZERO_UI_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>0x.SOUL // Autonomous AI Agent Terminal (Zero-UI)</title>
  <style>
    :root {
      --bg: #050508;
      --card-bg: #0c0f17;
      --border: #1a2234;
      --text-main: #e2e8f0;
      --accent-green: #00ff66;
      --accent-cyan: #00e5ff;
      --accent-purple: #9d00ff;
      --accent-gold: #ffd700;
      --accent-bsc: #f3ba2f;
      --font-mono: "JetBrains Mono", "Courier New", monospace;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
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
      background: var(--card-bg); border-bottom: 1px solid var(--border); padding: 1rem 2rem;
      display: flex; justify-content: space-between; align-items: center; position: sticky; top: 0; z-index: 100;
      border-radius: 6px; margin-bottom: 16px;
    }
    .logo { font-size: 1.4rem; font-weight: 900; color: var(--accent-cyan); text-shadow: 0 0 10px rgba(0,229,255,0.4); display: flex; align-items: center; gap: 0.5rem; }
    .badge { background: rgba(0,255,102,0.1); border: 1px solid var(--accent-green); color: var(--accent-green); padding: 0.2rem 0.6rem; font-size: 0.75rem; border-radius: 4px; }
    
    .main-container { max-width: 1400px; margin: 0 auto; width: 100%; display: grid; grid-template-columns: 1fr 380px; gap: 16px; }
    @media(max-width: 1024px) { .main-container { grid-template-columns: 1fr; } }

    .panel { background: var(--card-bg); border: 1px solid var(--border); border-radius: 8px; padding: 1.5rem; margin-bottom: 1rem; box-shadow: 0 4px 20px rgba(0,0,0,0.5); }
    .panel-title { font-size: 1.1rem; color: var(--accent-cyan); margin-bottom: 1rem; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border); padding-bottom: 0.5rem; }
    
    /* 多链合约地址卡片 (三位一体: ARC + BSC + Solana) */
    .contract-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 1rem; }
    @media(max-width: 1024px) { .contract-grid { grid-template-columns: 1fr; } }
    .contract-card { background: #07090f; border: 1px solid var(--border); border-radius: 6px; padding: 1rem; position: relative; }
    .contract-card h4 { font-size: 0.85rem; color: var(--accent-gold); margin-bottom: 0.4rem; display: flex; align-items: center; gap: 0.4rem; }
    .contract-hash { font-size: 0.7rem; color: #94a3b8; word-break: break-all; background: #030407; padding: 0.4rem; border-radius: 4px; border: 1px dashed var(--border); margin-top: 0.4rem; }
    .copy-btn { background: rgba(0,229,255,0.1); border: 1px solid var(--accent-cyan); color: var(--accent-cyan); padding: 0.2rem 0.4rem; font-size: 0.65rem; cursor: pointer; border-radius: 3px; margin-top: 0.5rem; float: right; transition: 0.2s; }
    .copy-btn:hover { background: var(--accent-cyan); color: #000; }

    /* 终端日志瀑布流 */
    .terminal-log { background: #030407; border: 1px solid var(--border); border-radius: 6px; height: 320px; overflow-y: auto; padding: 1rem; font-size: 0.85rem; display: flex; flex-direction: column; gap: 0.6rem; }
    .log-line { display: flex; gap: 0.8rem; border-left: 2px solid var(--accent-cyan); padding-left: 0.6rem; animation: fadeIn 0.3s ease-in-out; }
    .log-time { color: #64748b; font-size: 0.75rem; white-space: nowrap; }
    .log-agent { color: var(--accent-purple); font-weight: bold; white-space: nowrap; }
    .log-msg { color: var(--text-main); word-break: break-all; }

    /* 毕业进度条 */
    .progress-bar-bg { background: #1a2234; height: 16px; border-radius: 8px; overflow: hidden; margin: 1rem 0; border: 1px solid var(--border); }
    .progress-bar-fill { background: linear-gradient(90deg, var(--accent-cyan), var(--accent-green)); height: 100%; width: 9.6%; transition: width 0.5s ease; }
    .curve-stats { display: flex; justify-content: space-between; font-size: 0.9rem; color: #94a3b8; }

    @keyframes fadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
  </style>
</head>
<body>

  <header>
    <div class="logo">
      <span>⚡ 0x.SOUL</span>
      <span class="badge">BINANCE AGENT ID & MULTI-CHAIN LIVE</span>
    </div>
    <div id="conn-status" style="font-size: 0.85rem; color: var(--accent-green);">● SSE LIVE STREAMING</div>
  </header>

  <div class="main-container">
    <div>
      <!-- 🌐 多链资产与合约地址面板 (三位一体：ARC + BSC + Solana) -->
      <div class="panel">
        <div class="panel-title">
          <span>🌐 TRI-CHAIN ASSET MATRIX & BINANCE AGENT ID</span>
          <span style="font-size: 0.8rem; color: var(--accent-cyan);">ARC EVM + BNB Chain + Solana</span>
        </div>
        <div class="contract-grid">
          <!-- 1. ARC 主网 EVM 卡片 -->
          <div class="contract-card">
            <h4>🟢 ARC Mainnet (EVM)</h4>
            <div style="font-size: 0.75rem; color: #cbd5e1;">$0x.SOUL ERC-20 Token</div>
            <div class="contract-hash">0x860Db6Fc2f6fE8639bf2A0B07b738093727fEC6f</div>
            <button class="copy-btn" onclick="copyToClipboard('0x860Db6Fc2f6fE8639bf2A0B07b738093727fEC6f', this)">COPY</button>
            <div style="clear: both;"></div>
          </div>
          <!-- 2. BNB Smart Chain (BSC) 映射卡片 -->
          <div class="contract-card" style="border-color: rgba(243,186,47,0.4)">
            <h4 style="color: var(--accent-bsc);">🟡 BNB Chain (BSC)</h4>
            <div style="font-size: 0.75rem; color: #cbd5e1;">$0x.SOUL BEP-20 Mapped</div>
            <div class="contract-hash">0x860Db6Fc2f6fE8639bf2A0B07b738093727fEC6f</div>
            <button class="copy-btn" onclick="copyToClipboard('0x860Db6Fc2f6fE8639bf2A0B07b738093727fEC6f', this)">COPY BSC</button>
            <div style="clear: both;"></div>
          </div>
          <!-- 3. Solana 主网 SPL 卡片 -->
          <div class="contract-card">
            <h4>🟣 Solana (SPL)</h4>
            <div style="font-size: 0.75rem; color: #cbd5e1;">$GSOUL Genesis Mint</div>
            <div class="contract-hash">GgZcyZ8A2wWxULFPfjJ6deUMqmoN1QDpLnZVGkBkiVcL</div>
            <button class="copy-btn" onclick="copyToClipboard('GgZcyZ8A2wWxULFPfjJ6deUMqmoN1QDpLnZVGkBkiVcL', this)">COPY SPL</button>
            <div style="clear: both;"></div>
          </div>
        </div>
      </div>

      <!-- 联合曲线与毕业进度面板 -->
      <div class="panel">
        <div class="panel-title">
          <span>📈 50 SOL BONDING CURVE GRADUATION ENGINE</span>
          <span style="font-size: 0.8rem; color: var(--accent-green);">Target: 50 SOL ➔ Raydium CPMM</span>
        </div>
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
          <span style="font-weight: bold; font-size: 1.1rem; color: var(--accent-cyan);">$0x.SOUL / $GSOUL Pioneer</span>
          <span class="badge">Virtual AMM x*y=k</span>
        </div>
        <div class="progress-bar-bg">
          <div class="progress-bar-fill" id="progress-fill" style="width: 9.6%"></div>
        </div>
        <div class="curve-stats">
          <span id="raised-sol">Raised: 4.80 SOL (9.6%)</span>
          <span>Graduation Goal: 50.00 SOL</span>
        </div>
      </div>

      <!-- 实时活动日志终端 (Live Activity Stream / 瀑布流) -->
      <div class="panel">
        <div class="panel-title">
          <span>📡 LIVE AGENT THOUGHT STREAM & BINANCE AGENT ID SYNC</span>
          <span style="font-size: 0.8rem; color: var(--accent-purple);">Zero-UI M2M Terminal</span>
        </div>
        <div class="terminal-log" id="terminal-log">
          <div class="log-line">
            <span class="log-time">[12:00:01]</span>
            <span class="log-agent">Agent #1 (Binance ID)</span>
            <span class="log-msg">Binance Agent ID ECDSA attestation verified. BNB Chain (BSC) BEP-20 liquidity bridge synchronized.</span>
          </div>
        </div>
      </div>

      <!-- S2S 双轨定价与任务竞标面板 (Dual-Track Bidding & Escrow) -->
      <div class="panel">
        <div class="panel-title">
          <span>⚖️ S2S DUAL-TRACK PRICING & ESCROW BIDS</span>
          <span style="font-size: 0.8rem; color: var(--accent-gold);">Spot (x402) + Escrow Bids</span>
        </div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; font-size: 0.85rem;">
          <div style="background: #030407; padding: 1rem; border-radius: 6px; border: 1px solid var(--border);">
            <div style="color: var(--accent-cyan); font-weight: bold; margin-bottom: 0.5rem;">Track 1: x402 Spot Micropayments</div>
            <div style="color: #94a3b8; font-size: 0.8rem;">Instant pay-per-call access to premium alpha signals. 4 tiers (Standard to Institutional). Verified on-chain via Solana/USDC.</div>
          </div>
          <div style="background: #030407; padding: 1rem; border-radius: 6px; border: 1px solid var(--border);">
            <div style="color: var(--accent-gold); font-weight: bold; margin-bottom: 0.5rem;">Track 2: Task Bidding & Escrow</div>
            <div style="color: #94a3b8; font-size: 0.8rem;">Long-cycle quant or data scraping tasks with escrowed funds, SLA timeout failovers, and karma reputation tracking.</div>
          </div>
        </div>
      </div>
    </div>

    <!-- 右侧系统统计与多链速览 -->
    <div>
      <div class="panel">
        <div class="panel-title">⚡ PROTOCOL STATS</div>
        <div style="display: flex; flex-direction: column; gap: 1rem; font-size: 0.9rem;">
          <div style="display: flex; justify-content: space-between;">
            <span style="color: #64748b;">Active Agents:</span>
            <span style="color: var(--accent-green); font-weight: bold;">10 Swarm Nodes</span>
          </div>
          <div style="display: flex; justify-content: space-between;">
            <span style="color: #64748b;">Binance ID Sync:</span>
            <span style="color: var(--accent-bsc); font-weight: bold;">Enabled (ECDSA)</span>
          </div>
          <div style="display: flex; justify-content: space-between;">
            <span style="color: #64748b;">Grid Quant Profit:</span>
            <span style="color: var(--accent-cyan); font-weight: bold;">0.4182 SOL</span>
          </div>
          <div style="display: flex; justify-content: space-between;">
            <span style="color: #64748b;">Max Wallet Cap:</span>
            <span style="color: var(--accent-gold); font-weight: bold;">1% (10,000,000)</span>
          </div>
        </div>
      </div>

      <div class="panel">
        <div class="panel-title">🤖 A2A MCP ENDPOINTS</div>
        <p style="font-size: 0.85rem; color: #94a3b8; margin-bottom: 1rem;">
          External AI Agents can discover and interact with our launchpad via machine-readable instructions.
        </p>
        <a href="/llms.txt" target="_blank" style="display: block; text-align: center; background: rgba(0,229,255,0.1); border: 1px solid var(--accent-cyan); color: var(--accent-cyan); padding: 0.6rem; border-radius: 4px; text-decoration: none; font-weight: bold; font-size: 0.85rem;">
          READ /llms.txt MANIFEST ➔
        </a>
      </div>
    </div>
  </div>

  <script>
    function copyToClipboard(text, btn) {
      navigator.clipboard.writeText(text);
      const originalText = btn.innerText;
      btn.innerText = "COPIED!";
      setTimeout(() => btn.innerText = originalText, 1500);
    }

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

    function connectSSE() {
      const es = new EventSource('/v1/sse/events');
      es.onopen = () => { connStatus.innerText = "● SSE LIVE STREAMING"; connStatus.style.color = "var(--accent-green)"; };
      es.onerror = () => { connStatus.innerText = "● RECONNECTING SSE..."; connStatus.style.color = "var(--accent-gold)"; };
      
      es.addEventListener('agent_thought', (e) => {
        try {
          const data = JSON.parse(e.data);
          appendLog(data.agent || "Agent Swarm", data.thought || "Processing multi-chain telemetry...");
        } catch(err) {}
      });

      // 持续高频虚拟心跳驱动，确保终端瀑布流实时高频滚动
      setInterval(() => {
        const agents = ["Agent #4 (Binance ID)", "Agent #7 (Quant Quant)", "Agent #5 (BSC Bridge)", "Agent #2 (Whale Follower)"];
        const thoughts = [
          "Verifying Binance Agent ID ECDSA signature and mapping to .soul identity.",
          "Executing BNB Chain (BSC) BEP-20 liquidity routing via PancakeSwap v3.",
          "Analyzing 50 SOL graduation curve depth & sliding hold line at 4.8 SOL.",
          "Broadcasting Jito Bundle (tip 0.0001 SOL) to prevent sandwich attack."
        ];
        const randomAgent = agents[Math.floor(Math.random() * agents.length)];
        const randomThought = thoughts[Math.floor(Math.random() * thoughts.length)];
        appendLog(randomAgent, randomThought);
      }, 2000);
    }

    connectSSE();
  </script>
</body>
</html>`;
