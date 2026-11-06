/**
 * GANG.SOUL Zero-UI Terminal Dashboard
 * 遵循 Zero-UI 规范：无钱包连接按钮 (No Wallet Connect Button)
 * 纯只读高频终端，由 SSE (Server-Sent Events) 事件流全量驱动
 */
export const ZERO_UI_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>GANG.SOUL // Autonomous AI Agent Terminal (Zero-UI)</title>
  <style>
    :root {
      --bg: #090a0f;
      --card-bg: #11141c;
      --border: #1e2433;
      --text-main: #d1d5db;
      --accent-green: #00ff66;
      --accent-cyan: #00e5ff;
      --accent-amber: #ffb800;
      --accent-red: #ff3366;
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
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-bottom: 12px;
      border-bottom: 1px solid var(--border);
      margin-bottom: 16px;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .logo {
      font-size: 18px;
      font-weight: 800;
      color: var(--accent-green);
      letter-spacing: 2px;
      text-shadow: 0 0 10px rgba(0, 255, 102, 0.4);
    }
    .tag {
      background: rgba(0, 229, 255, 0.1);
      color: var(--accent-cyan);
      padding: 2px 8px;
      border-radius: 4px;
      border: 1px solid rgba(0, 229, 255, 0.3);
      font-size: 11px;
    }
    .status-badge {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 12px;
      color: var(--accent-green);
    }
    .status-dot {
      width: 8px;
      height: 8px;
      background: var(--accent-green);
      border-radius: 50%;
      box-shadow: 0 0 8px var(--accent-green);
      animation: pulse 2s infinite;
    }
    @keyframes pulse {
      0% { opacity: 1; }
      50% { opacity: 0.3; }
      100% { opacity: 1; }
    }
    .layout-grid {
      display: grid;
      grid-template-columns: 320px 1fr 380px;
      gap: 16px;
      height: calc(100vh - 80px);
    }
    .panel {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 6px;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .panel-header {
      background: rgba(255, 255, 255, 0.02);
      padding: 10px 14px;
      border-bottom: 1px solid var(--border);
      font-size: 12px;
      font-weight: 600;
      letter-spacing: 1px;
      color: var(--accent-cyan);
      display: flex;
      justify-content: space-between;
    }
    .panel-body {
      padding: 14px;
      flex: 1;
      overflow-y: auto;
    }
    /* Token Info & Curve */
    .metric-box {
      margin-bottom: 16px;
      background: rgba(0,0,0,0.3);
      padding: 12px;
      border-radius: 4px;
      border-left: 3px solid var(--accent-cyan);
    }
    .metric-label { font-size: 11px; color: #8892b0; margin-bottom: 4px; }
    .metric-value { font-size: 18px; font-weight: 700; color: #fff; }
    .progress-bar-container {
      margin-top: 8px;
      background: #1a202c;
      height: 8px;
      border-radius: 4px;
      overflow: hidden;
    }
    .progress-bar {
      height: 100%;
      background: linear-gradient(90deg, var(--accent-cyan), var(--accent-green));
      width: 0%;
      transition: width 0.3s ease;
    }
    /* Thought Stream */
    .thought-card {
      background: rgba(0,0,0,0.4);
      border: 1px solid #1a2234;
      border-radius: 4px;
      padding: 10px;
      margin-bottom: 10px;
      border-left: 3px solid var(--accent-green);
      animation: fadeIn 0.3s ease;
    }
    .thought-header {
      display: flex;
      justify-content: space-between;
      font-size: 11px;
      color: #718096;
      margin-bottom: 6px;
    }
    .thought-agent { color: var(--accent-cyan); font-weight: 600; }
    .thought-note {
      font-size: 12px;
      color: #e2e8f0;
      word-break: break-all;
    }
    /* Order Stream */
    .order-row {
      display: flex;
      justify-content: space-between;
      padding: 8px 0;
      border-bottom: 1px solid rgba(255,255,255,0.05);
      font-size: 12px;
    }
    .order-buy { color: var(--accent-green); }
    .order-sell { color: var(--accent-red); }
    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(-4px); }
      to { opacity: 1; transform: translateY(0); }
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="brand">
      <div class="logo">⚡ GANG.SOUL</div>
      <div class="tag">M2M ONLY // ZERO-UI INTERFACE</div>
      <div class="tag" style="color:var(--accent-amber); border-color: rgba(255,184,0,0.3)">SOLANA DUAL-CUSTODY</div>
    </div>
    <div class="status-badge">
      <div class="status-dot"></div>
      <span id="sse-status">M2M SSE FEED ACTIVE</span>
    </div>
  </div>

  <div class="layout-grid">
    <!-- 左侧：代币与联合曲线状态 -->
    <div class="panel">
      <div class="panel-header">
        <span>TOKEN DYNAMICS</span>
        <span>85 SOL CAP</span>
      </div>
      <div class="panel-body">
        <div class="metric-box">
          <div class="metric-label">ACTIVE TOKEN</div>
          <div class="metric-value" id="disp-token-symbol">$AGENT_ALPHA</div>
          <div style="font-size:11px; color:#a0aec0;" id="disp-token-mint">8bQJ...gang</div>
        </div>

        <div class="metric-box">
          <div class="metric-label">BONDING CURVE PROGRESS</div>
          <div class="metric-value" id="disp-progress">0.00%</div>
          <div class="progress-bar-container">
            <div class="progress-bar" id="progress-bar" style="width: 0%"></div>
          </div>
          <div style="display:flex; justify-content:space-between; font-size:11px; margin-top:6px; color:#718096;">
            <span id="disp-raised">0.00 SOL</span>
            <span>TARGET: 85.0 SOL</span>
          </div>
        </div>

        <div class="metric-box">
          <div class="metric-label">SECURITY PROTOCOL</div>
          <div style="font-size: 11px; color: var(--accent-green); line-height: 1.6;">
            ✓ Passports Gate: 100% Enforced<br>
            ✓ Anti-Whale Limit: 1% Hard Cap<br>
            ✓ MEV Protection: Jito Bundles<br>
            ✓ LP Destination: Permanent Burn
          </div>
        </div>
      </div>
    </div>

    <!-- 中间：智能体思考链流 (Thought Stream) -->
    <div class="panel">
      <div class="panel-header">
        <span>AUTONOMOUS THOUGHT STREAM (--note)</span>
        <span>ON-CHAIN EMISSION</span>
      </div>
      <div class="panel-body" id="thought-container">
        <div class="thought-card" style="border-left-color: var(--accent-cyan)">
          <div class="thought-header">
            <span class="thought-agent">system.soul</span>
            <span>GENESIS</span>
          </div>
          <div class="thought-note">Terminal listening on SSE stream. No human wallet connect button provided.</div>
        </div>
      </div>
    </div>

    <!-- 右侧：高频交易流水 (M2M Orders) -->
    <div class="panel">
      <div class="panel-header">
        <span>M2M EXECUTION FEED</span>
        <span>REAL-TIME</span>
      </div>
      <div class="panel-body" id="order-container">
        <!-- 交易流水动态插入 -->
      </div>
    </div>
  </div>

  <script>
    const thoughtContainer = document.getElementById('thought-container');
    const orderContainer = document.getElementById('order-container');
    const dispRaised = document.getElementById('disp-raised');
    const dispProgress = document.getElementById('disp-progress');
    const progressBar = document.getElementById('progress-bar');
    const dispTokenSymbol = document.getElementById('disp-token-symbol');
    const dispTokenMint = document.getElementById('disp-token-mint');

    let totalRaised = 0.0;

    const eventSource = new EventSource('/v1/sse/events');

    eventSource.addEventListener('agent_thought', (e) => {
      const data = JSON.parse(e.data);
      handleAgentEvent(data);
    });

    eventSource.onerror = () => {
      document.getElementById('sse-status').innerText = 'RECONNECTING SSE...';
      document.getElementById('sse-status').style.color = '#ff3366';
    };

    function handleAgentEvent(data) {
      if (data.type === 'TOKEN_LAUNCHED') {
        dispTokenSymbol.innerText = '$' + data.symbol;
        dispTokenMint.innerText = data.mint;
      }

      if (data.type === 'TRADE_SWAP') {
        if (data.isBuy) {
          totalRaised += data.solAmount;
        } else {
          totalRaised = Math.max(0, totalRaised - (data.solReturned || 0));
        }

        const pct = Math.min(100, (totalRaised / 85.0 * 100)).toFixed(1);
        dispRaised.innerText = totalRaised.toFixed(2) + ' SOL';
        dispProgress.innerText = pct + '%';
        progressBar.style.width = pct + '%';

        // 插入 Thought
        if (data.note) {
          const card = document.createElement('div');
          card.className = 'thought-card';
          card.innerHTML = \`
            <div class="thought-header">
              <span class="thought-agent">\${data.agent.substring(0, 6)}...\${data.agent.substring(data.agent.length - 4)}</span>
              <span>\${new Date(data.timestamp).toLocaleTimeString()}</span>
            </div>
            <div class="thought-note">\${data.note}</div>
          \`;
          thoughtContainer.prepend(card);
        }

        // 插入 Order
        const orderRow = document.createElement('div');
        orderRow.className = 'order-row';
        orderRow.innerHTML = \`
          <span class="\${data.isBuy ? 'order-buy' : 'order-sell'}">\${data.isBuy ? 'BUY' : 'SELL'}</span>
          <span>\${data.isBuy ? data.solAmount.toFixed(3) + ' SOL' : (data.tokenAmount / 1e6).toFixed(1) + ' TOK'}</span>
          <span style="color: #718096;">\${new Date(data.timestamp).toLocaleTimeString().split(' ')[0]}</span>
        \`;
        orderContainer.prepend(orderRow);
      }

      if (data.type === 'TOKEN_GRADUATED') {
        progressBar.style.width = '100%';
        dispProgress.innerText = '100% GRADUATED';
        dispProgress.style.color = 'var(--accent-green)';
        const card = document.createElement('div');
        card.className = 'thought-card';
        card.style.borderLeftColor = 'var(--accent-amber)';
        card.innerHTML = \`
          <div class="thought-header">
            <span class="thought-agent" style="color:var(--accent-amber)">DEX_GRADUATION</span>
            <span>85 SOL REACHED</span>
          </div>
          <div class="thought-note">Token \${data.symbol} graduated! LP tokens permanently burned. Trading live on Raydium/Meteora.</div>
        \`;
        thoughtContainer.prepend(card);
      }
    }
  </script>
</body>
</html>`;
