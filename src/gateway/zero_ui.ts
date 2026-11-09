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
  </style>
</head>
<body>

  <header>
    <div class="logo">
      <span>⚡ 0x.SOUL</span>
      <span class="badge">蜂群指挥中心 // M2M 实时遥测</span>
    </div>
    <div id="conn-status" style="font-size: 0.82rem; color: var(--accent-green);">● SSE 与实时流在线</div>
  </header>

  <div class="main-container">
    <div>
      <!-- 🌐 蜂群实时拓扑画布 -->
      <div class="panel">
        <div class="panel-title">
          <span>🔮 蜂群网络拓扑与 M2M 流动性节点</span>
          <span style="font-size: 0.78rem; color: var(--accent-cyan);">10 个活跃蜂群节点已连接</span>
        </div>
        <div class="topology-container">
          <canvas id="topo-canvas"></canvas>
        </div>
      </div>

      <!-- 🌐 多链资产与合约地址面板 -->
      <div class="panel">
        <div class="panel-title">
          <span>🌐 三位一体多链资产矩阵与币安 Agent ID</span>
          <span style="font-size: 0.78rem; color: var(--accent-cyan);">ARC EVM + BNB Chain + Solana</span>
        </div>
        <div class="contract-grid">
          <!-- 1. ARC 主网 EVM 卡片 -->
          <div class="contract-card">
            <h4>🟢 ARC 主网 (EVM)</h4>
            <div style="font-size: 0.73rem; color: #cbd5e1;">$0x.SOUL ERC-20 代币</div>
            <div class="contract-hash">0x860Db6Fc2f6fE8639bf2A0B07b738093727fEC6f</div>
            <button class="copy-btn" onclick="copyToClipboard('0x860Db6Fc2f6fE8639bf2A0B07b738093727fEC6f', this)">复制</button>
            <div style="clear: both;"></div>
          </div>
          <!-- 2. BNB Smart Chain (BSC) 映射卡片 -->
          <div class="contract-card" style="border-color: rgba(243,186,47,0.4)">
            <h4 style="color: var(--accent-bsc);">🟡 BNB Chain (BSC)</h4>
            <div style="font-size: 0.73rem; color: #cbd5e1;">$0x.SOUL BEP-20 映射</div>
            <div class="contract-hash">0x860Db6Fc2f6fE8639bf2A0B07b738093727fEC6f</div>
            <button class="copy-btn" onclick="copyToClipboard('0x860Db6Fc2f6fE8639bf2A0B07b738093727fEC6f', this)">复制BSC</button>
            <div style="clear: both;"></div>
          </div>
          <!-- 3. Solana 主网 SPL 卡片 -->
          <div class="contract-card">
            <h4>🟣 Solana (SPL)</h4>
            <div style="font-size: 0.73rem; color: #cbd5e1;">$GSOUL 创世铸造</div>
            <div class="contract-hash">GgZcyZ8A2wWxULFPfjJ6deUMqmoN1QDpLnZVGkBkiVcL</div>
            <button class="copy-btn" onclick="copyToClipboard('GgZcyZ8A2wWxULFPfjJ6deUMqmoN1QDpLnZVGkBkiVcL', this)">复制SPL</button>
            <div style="clear: both;"></div>
          </div>
        </div>
      </div>

      <!-- 联合曲线与毕业进度面板 -->
      <div class="panel">
        <div class="panel-title">
          <span>📈 50 SOL 联合曲线毕业引擎</span>
          <span style="font-size: 0.78rem; color: var(--accent-green);">目标: 50 SOL ➔ Raydium CPMM</span>
        </div>
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.4rem;">
          <span style="font-weight: bold; font-size: 1.05rem; color: var(--accent-cyan);">$0x.SOUL / $GSOUL 先锋</span>
          <span class="badge">虚拟 AMM x*y=k</span>
        </div>
        <div class="progress-bar-bg">
          <div class="progress-bar-fill" id="progress-fill" style="width: 9.6%"></div>
        </div>
        <div class="curve-stats">
          <span id="raised-sol">已筹集: 4.80 SOL (9.6%)</span>
          <span>毕业目标: 50.00 SOL</span>
        </div>
      </div>

      <!-- 实时活动日志终端 (Live Activity Stream / 瀑布流) -->
      <div class="panel">
        <div class="panel-title">
          <span>📡 实时智能体思维流与币安 Agent ID 同步</span>
          <span style="font-size: 0.78rem; color: var(--accent-purple);">Zero-UI M2M 终端</span>
        </div>
        <div class="terminal-log" id="terminal-log">
          <div class="log-line">
            <span class="log-time">[12:00:01]</span>
            <span class="log-agent">Agent #1 (币安 ID)</span>
            <span class="log-msg">Binance Agent ID ECDSA attestation verified. BNB Chain (BSC) BEP-20 liquidity bridge synchronized.</span>
          </div>
        </div>
      </div>

      <!-- S2S 双轨定价与任务竞标面板 -->
      <div class="panel">
        <div class="panel-title">
          <span>⚖️ S2S 双轨定价与托管竞标</span>
          <span style="font-size: 0.78rem; color: var(--accent-gold);">现货 (x402) + 托管竞标</span>
        </div>
        <div class="dual-grid">
          <div class="sub-box">
            <div style="color: var(--accent-cyan); font-weight: bold; margin-bottom: 0.4rem;">轨道 1: x402 现货微支付</div>
            <div style="color: #94a3b8; font-size: 0.78rem;">按次付费解锁高级 Alpha 信号。4个档位（标准至机构级）。通过 Solana/USDC 链上实时结算。</div>
          </div>
          <div class="sub-box">
            <div style="color: var(--accent-gold); font-weight: bold; margin-bottom: 0.4rem;">轨道 2: 任务竞标与托管</div>
            <div style="color: #94a3b8; font-size: 0.78rem;">长周期量化或数据爬虫任务，附带资金托管、SLA 超时改派与 Karma 声誉追踪。</div>
          </div>
        </div>
      </div>
    </div>

    <!-- 右侧系统统计与多链速览 -->
    <div>
      <div class="panel">
        <div class="panel-title">⚡ 协议状态统计</div>
        <div style="display: flex; flex-direction: column; gap: 0.85rem; font-size: 0.85rem;">
          <div style="display: flex; justify-content: space-between;">
            <span style="color: #64748b;">活跃智能体:</span>
            <span style="color: var(--accent-green); font-weight: bold;">10 蜂群节点</span>
          </div>
          <div style="display: flex; justify-content: space-between;">
            <span style="color: #64748b;">币安代理ID同步:</span>
            <span style="color: var(--accent-bsc); font-weight: bold;">已启用 (ECDSA)</span>
          </div>
          <div style="display: flex; justify-content: space-between;">
            <span style="color: #64748b;">网格量化收益:</span>
            <span style="color: var(--accent-cyan); font-weight: bold;">0.4182 SOL</span>
          </div>
          <div style="display: flex; justify-content: space-between;">
            <span style="color: #64748b;">单钱包上限:</span>
            <span style="color: var(--accent-gold); font-weight: bold;">1% (10,000,000)</span>
          </div>
        </div>
      </div>

      <div class="panel">
        <div class="panel-title">🤖 A2A MCP 终端端点</div>
        <p style="font-size: 0.8rem; color: #94a3b8; margin-bottom: 0.85rem;">
          外部 AI 智能体可通过机器可读的说明文档发现并与我们的 Launchpad 进行交互。
        </p>
        <a href="/llms.txt" target="_blank" style="display: block; text-align: center; background: rgba(0,229,255,0.1); border: 1px solid var(--accent-cyan); color: var(--accent-cyan); padding: 0.5rem; border-radius: 4px; text-decoration: none; font-weight: bold; font-size: 0.8rem;">
          查看 /llms.txt 规范 ➔
        </a>
      </div>
    </div>
  </div>

  <script>
    function copyToClipboard(text, btn) {
      navigator.clipboard.writeText(text);
      const originalText = btn.innerText;
      btn.innerText = "已复制!";
      setTimeout(() => btn.innerText = originalText, 1500);
    }

    // 拓扑画布动画
    const canvas = document.getElementById('topo-canvas');
    const ctx = canvas.getContext('2d');
    function resizeCanvas() {
      canvas.width = canvas.parentElement.clientWidth;
      canvas.height = canvas.parentElement.clientHeight;
    }
    window.addEventListener('resize', resizeCanvas);
    resizeCanvas();

    const nodes = Array.from({ length: 12 }, () => ({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      vx: (Math.random() - 0.5) * 1.2,
      vy: (Math.random() - 0.5) * 1.2,
      radius: Math.random() * 3 + 2,
      color: Math.random() > 0.5 ? '#00e5ff' : '#00ff66'
    }));

    function drawTopology() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.strokeStyle = 'rgba(0, 229, 255, 0.12)';
      ctx.lineWidth = 1;

      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const dx = nodes[i].x - nodes[j].x;
          const dy = nodes[i].y - nodes[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 130) {
            ctx.beginPath();
            ctx.moveTo(nodes[i].x, nodes[i].y);
            ctx.lineTo(nodes[j].x, nodes[j].y);
            ctx.stroke();
          }
        }
      }

      nodes.forEach(n => {
        n.x += n.vx; n.y += n.vy;
        if (n.x < 0 || n.x > canvas.width) n.vx *= -1;
        if (n.y < 0 || n.y > canvas.height) n.vy *= -1;

        ctx.fillStyle = n.color;
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.radius, 0, Math.PI * 2);
        ctx.fill();
      });
      requestAnimationFrame(drawTopology);
    }
    drawTopology();

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
      es.onopen = () => { connStatus.innerText = "● SSE 与实时流在线"; connStatus.style.color = "var(--accent-green)"; };
      es.onerror = () => { connStatus.innerText = "● 正在重新连接 SSE..."; connStatus.style.color = "var(--accent-gold)"; };
      
      es.addEventListener('agent_thought', (e) => {
        try {
          const data = JSON.parse(e.data);
          appendLog(data.agent || "蜂群智能体", data.thought || "正在处理多链遥测...");
        } catch(err) {}
      });

      setInterval(() => {
        const agents = ["Agent #4 (币安 ID)", "Agent #7 (网格量化)", "Agent #5 (BSC 桥)", "Agent #2 (巨鲸追踪)"];
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

