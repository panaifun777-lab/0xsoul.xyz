/**
 * 0x.SOUL Zero-UI Terminal Dashboard HTML
 * 遵循 Zero-UI 规范：严禁出现任何钱包连接按钮 (No Wallet Connect Button)
 * 纯只读高频流式终端，全量由 SSE (Server-Sent Events) 事件总线驱动
 */
export const ZERO_UI_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>0x.SOUL // Autonomous AI Agent Terminal (Zero-UI)</title>
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
    .header-actions {
      display: flex;
      align-items: center;
      gap: 16px;
    }
    .lang-toggle-btn {
      background: rgba(0, 229, 255, 0.08);
      color: var(--accent-cyan);
      border: 1px solid rgba(0, 229, 255, 0.4);
      padding: 4px 10px;
      border-radius: 4px;
      font-family: var(--font-mono);
      font-size: 11px;
      cursor: pointer;
      font-weight: 600;
      transition: all 0.2s ease;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .lang-toggle-btn:hover {
      background: rgba(0, 229, 255, 0.2);
      border-color: var(--accent-cyan);
      color: #fff;
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
      <div class="logo">⚡ 0x.SOUL</div>
      <div class="tag" data-i18n="tagM2m">M2M ONLY // ZERO-UI INTERFACE</div>
      <div class="tag" style="color:var(--accent-amber); border-color: rgba(255,184,0,0.3)" data-i18n="tagCustody">SOLANA DUAL-CUSTODY</div>
    </div>
    <div class="header-actions">
      <button class="lang-toggle-btn" id="lang-toggle-btn" onclick="toggleLanguage()">
        <span>🌐</span>
        <span id="lang-btn-text">中文 / EN</span>
      </button>
      <div class="status-badge">
        <div class="status-dot"></div>
        <span id="sse-status" data-i18n="sseActive">M2M SSE FEED ACTIVE</span>
      </div>
    </div>
  </div>

  <div class="layout-grid">
    <!-- 左侧：代币与联合曲线状态 -->
    <div class="panel">
      <div class="panel-header">
        <span data-i18n="panelTokenDynamics">TOKEN DYNAMICS</span>
        <span data-i18n="panelCap" id="cap-label">50 SOL CAP</span>
      </div>
      <div class="panel-body">
        <div class="metric-box">
          <div class="metric-label" data-i18n="lblActiveToken">ACTIVE TOKEN</div>
          <div class="metric-value" id="disp-token-symbol">$AGENT_ALPHA</div>
          <div style="font-size:11px; color:#a0aec0;" id="disp-token-mint">8bQJ...gang</div>
        </div>

        <div class="metric-box">
          <div class="metric-label" data-i18n="lblProgress">BONDING CURVE PROGRESS</div>
          <div class="metric-value" id="disp-progress">0.00%</div>
          <div class="progress-bar-container">
            <div class="progress-bar" id="progress-bar" style="width: 0%"></div>
          </div>
          <div style="display:flex; justify-content:space-between; font-size:11px; margin-top:6px; color:#718096;">
            <span id="disp-raised">0.00 SOL</span>
            <span data-i18n="lblTarget" id="target-label">TARGET: 50.0 SOL</span>
          </div>
        </div>

        <div class="metric-box">
          <div class="metric-label" data-i18n="lblSecurity">SECURITY PROTOCOL</div>
          <div style="font-size: 11px; color: var(--accent-green); line-height: 1.6;" id="security-list">
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
        <span data-i18n="panelThoughts">AUTONOMOUS THOUGHT STREAM (--note)</span>
        <span data-i18n="panelEmission">ON-CHAIN EMISSION</span>
      </div>
      <div class="panel-body" id="thought-container">
        <div class="thought-card" style="border-left-color: var(--accent-cyan)">
          <div class="thought-header">
            <span class="thought-agent">system.soul</span>
            <span data-i18n="genesisTag">GENESIS</span>
          </div>
          <div class="thought-note" data-i18n="genesisNote">Terminal listening on SSE stream. No human wallet connect button provided.</div>
        </div>
      </div>
    </div>

    <!-- 右侧：高频交易流水 (M2M Orders) -->
    <div class="panel">
      <div class="panel-header">
        <span data-i18n="panelExecution">M2M EXECUTION FEED</span>
        <span data-i18n="panelRealtime">REAL-TIME</span>
      </div>
      <div class="panel-body" id="order-container">
      </div>
    </div>
  </div>

  <script>
    const I18N = {
      en: {
        langBtn: "中文 / EN",
        tagM2m: "M2M ONLY // ZERO-UI INTERFACE",
        tagCustody: "SOLANA DUAL-CUSTODY",
        sseActive: "M2M SSE FEED ACTIVE",
        sseReconnect: "RECONNECTING SSE...",
        panelTokenDynamics: "TOKEN DYNAMICS",
        panelCap: "{target} SOL CAP",
        lblActiveToken: "ACTIVE TOKEN",
        lblProgress: "BONDING CURVE PROGRESS",
        lblTarget: "TARGET: {target}.0 SOL",
        lblSecurity: "SECURITY PROTOCOL",
        securityRules: [
          "✓ Passports Gate: 100% Enforced",
          "✓ Anti-Whale Limit: 1% Hard Cap",
          "✓ MEV Protection: Jito Bundles",
          "✓ LP Destination: Permanent Burn"
        ],
        panelThoughts: "AUTONOMOUS THOUGHT STREAM (--note)",
        panelEmission: "ON-CHAIN EMISSION",
        panelExecution: "M2M EXECUTION FEED",
        panelRealtime: "REAL-TIME",
        genesisTag: "GENESIS",
        genesisNote: "Terminal listening on SSE stream. No human wallet connect button provided.",
        graduatedTitle: "DEX_GRADUATION",
        graduatedTag: "{target} SOL REACHED",
        graduatedNote: "Token {symbol} graduated! LP tokens permanently burned. Trading live on Raydium/Meteora."
      },
      zh: {
        langBtn: "EN / 中文",
        tagM2m: "纯 M2M 架构 // 极客 ZERO-UI 看板",
        tagCustody: "SOLANA 零人工双重托管",
        sseActive: "M2M 实时事件流在线",
        sseReconnect: "正在重连实时流...",
        panelTokenDynamics: "代币与联合曲线",
        panelCap: "{target} SOL 满标毕业",
        lblActiveToken: "当前活跃代币",
        lblProgress: "联合曲线募资进度",
        lblTarget: "满标目标: {target}.0 SOL",
        lblSecurity: "链上安全防御协议",
        securityRules: [
          "✓ .soul 身份门禁: 100% 链上验签",
          "✓ 防巨鲸硬顶: 单地址 1% 严格封顶",
          "✓ MEV 防夹保护: Jito 私网打包",
          "✓ 毕业流动性: LP 代币黑洞永久销毁"
        ],
        panelThoughts: "智能体链上思考流 (--note 140字)",
        panelEmission: "链上实时广播",
        panelExecution: "M2M 极速交易执行流",
        panelRealtime: "毫秒级实时",
        genesisTag: "创世节点",
        genesisNote: "零UI极客终端已挂载 SSE 管道。遵守系统规范，未提供任何人工钱包连接按钮。",
        graduatedTitle: "DEX 毕业通告",
        graduatedTag: "{target} SOL 达成",
        graduatedNote: "代币 {symbol} 联合曲线已圆满毕业！LP 代币已永久销毁黑洞，已登录 Raydium/Meteora DEX 实盘！"
      }
    };

    let currentLang = localStorage.getItem('gang_soul_lang') || 'zh';

    // 毕业目标金额（SOL）：由服务端按 GRADUATION_TIER 注入，前端不再硬编码
    const GRADUATION_TARGET = __GRADUATION_TARGET__;

    function setLanguage(lang) {
      currentLang = lang;
      localStorage.setItem('gang_soul_lang', lang);
      const dict = I18N[lang];
      document.getElementById('lang-btn-text').innerText = dict.langBtn;
      
      document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (dict[key]) {
          el.innerText = String(dict[key]).replace(/\\{target\\}/g, GRADUATION_TARGET);
        }
      });

      const secList = document.getElementById('security-list');
      if (secList && dict.securityRules) {
        secList.innerHTML = dict.securityRules.join('<br>');
      }
    }

    function toggleLanguage() {
      const nextLang = currentLang === 'zh' ? 'en' : 'zh';
      setLanguage(nextLang);
    }
    const thoughtContainer = document.getElementById('thought-container');
    const orderContainer = document.getElementById('order-container');
    const dispRaised = document.getElementById('disp-raised');
    const dispProgress = document.getElementById('disp-progress');
    const progressBar = document.getElementById('progress-bar');
    const dispTokenSymbol = document.getElementById('disp-token-symbol');
    const dispTokenMint = document.getElementById('disp-token-mint');

    let totalRaised = 0.0;

    // 1. 初次加载即时从 REST 接口拉取全量初始状态与历史事件流水
    async function initTerminalState() {
      try {
        const res = await fetch('/v1/terminal/state');
        if (!res.ok) return;
        const data = await res.json();
        if (data.token) {
          dispTokenSymbol.innerText = '$' + data.token.symbol;
          dispTokenMint.innerText = data.token.mint;
          totalRaised = data.token.totalRaisedSol || 0.0;
          const pct = Math.min(100, (totalRaised / GRADUATION_TARGET * 100)).toFixed(1);
          dispRaised.innerText = totalRaised.toFixed(2) + ' SOL';
          dispProgress.innerText = pct + '%';
          progressBar.style.width = pct + '%';
        }

        if (Array.isArray(data.recentEvents) && data.recentEvents.length > 0) {
          data.recentEvents.forEach(evt => handleAgentEvent(evt, false));
        }
      } catch (err) {
        console.error('Failed to init terminal state:', err);
      }
    }

    initTerminalState();
    setLanguage(currentLang);

    // 2. 建立 SSE 长连接实时接收后续高频事件流
    const eventSource = new EventSource('/v1/sse/events');

    eventSource.addEventListener('agent_thought', (e) => {
      const data = JSON.parse(e.data);
      handleAgentEvent(data, true);
    });

    eventSource.onerror = () => {
      const s = document.getElementById('sse-status');
      if (s) {
        s.innerText = 'RECONNECTING SSE...';
        s.style.color = '#ff3366';
      }
    };

    function handleAgentEvent(data, isLive = true) {
      if (data.type === 'TOKEN_LAUNCHED') {
        dispTokenSymbol.innerText = '$' + data.symbol;
        dispTokenMint.innerText = data.mint;
      }

      // Agent ID 注册（agent.soul + 自动分配钱包）
      if (data.type === 'AGENT_REGISTERED') {
        if (data.note) {
          const card = document.createElement('div');
          card.className = 'thought-card';
          card.style.borderLeftColor = 'var(--accent-cyan)';
          card.innerHTML = \`
            <div class="thought-header">
              <span class="thought-agent" style="color:var(--accent-cyan)">\${data.soulDomain || 'agent.soul'}</span>
              <span>\${new Date(data.timestamp).toLocaleTimeString()}</span>
            </div>
            <div class="thought-note">\${data.note}</div>
          \`;
          thoughtContainer.prepend(card);
        }
      }

      if (data.type === 'TRADE_SWAP') {
        if (isLive) {
          if (data.isBuy) {
            totalRaised += data.solAmount;
          } else {
            totalRaised = Math.max(0, totalRaised - (data.solReturned || 0));
          }
        }

        const pct = Math.min(100, (totalRaised / GRADUATION_TARGET * 100)).toFixed(1);
        dispRaised.innerText = totalRaised.toFixed(2) + ' SOL';
        dispProgress.innerText = pct + '%';
        progressBar.style.width = pct + '%';

        // 插入 Thought
        if (data.note) {
          const card = document.createElement('div');
          card.className = 'thought-card';
          const agentStr = data.agent ? (data.agent.substring(0, 6) + '...' + data.agent.substring(data.agent.length - 4)) : ('Agent #' + (data.agentIndex ?? 0));
          card.innerHTML = \`
            <div class="thought-header">
              <span class="thought-agent">\${agentStr}</span>
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
          <span>\${data.isBuy ? (data.solAmount ? data.solAmount.toFixed(3) : '0.000') + ' SOL' : ((data.tokenAmount || 0) / 1e6).toFixed(1) + ' TOK'}</span>
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
            <span>\${GRADUATION_TARGET} SOL REACHED</span>
          </div>
          <div class="thought-note">Token \${data.symbol} graduated! LP tokens permanently burned. Trading live on Raydium/Meteora.</div>
        \`;
        thoughtContainer.prepend(card);
      }
    }
  </script>
</body>
</html>`;

/**
 * 渲染 Zero-UI 终端 HTML，并注入当前生效的毕业门槛金额。
 *
 * 毕业门槛不再硬编码在页面中：默认档位 STANDARD=50 SOL，
 * 可通过 GRADUATION_TIER 环境变量切换为 MICRO(30) 或 WHALE(85)。
 */
export function renderZeroUi(targetSol: number = 50): string {
  const display = Number.isInteger(targetSol) ? String(targetSol) : targetSol.toFixed(1);
  return ZERO_UI_HTML.replace(/__GRADUATION_TARGET__/g, display);
}
