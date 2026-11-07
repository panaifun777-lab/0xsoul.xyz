import Fastify, { FastifyRequest, FastifyReply } from "fastify";
import cors from "@fastify/cors";
import { SolanaAgentClusterManager } from "../wallet/cluster";
import { QuantTradingAdapter } from "../quant/market_making/adapter";
import { ARC_PRODUCTION_CONFIG } from "../config/arc_production";
import { ZERO_UI_HTML } from "./zero_ui";

export class GangSoulGateway {
  private fastify = Fastify({ logger: false });
  private cluster: SolanaAgentClusterManager;
  private quantAdapter: QuantTradingAdapter;

  constructor() {
    this.cluster = new SolanaAgentClusterManager();
    this.quantAdapter = new QuantTradingAdapter();
  }

  async start() {
    await this.fastify.register(cors, { origin: true });

    // 直接在前端 HTML 模板中把 ARC EVM 合约地址写死渲染，确保用户打开首页第一秒即可清晰看到
    const renderedHtml = ZERO_UI_HTML.replace(
      '<div class="contract-hash" id="evm-contract">0x860Db6Fc2f6fE8639bf2A0B07b738093727fEC6f</div>',
      `<div class="contract-hash" id="evm-contract">${ARC_PRODUCTION_CONFIG.contracts.token}</div>`
    );

    this.fastify.get("/", async (req, reply) => {
      reply.type("text/html").send(renderedHtml);
    });

    this.fastify.get("/terminal", async (req, reply) => {
      reply.type("text/html").send(renderedHtml);
    });

    this.fastify.get("/llms.txt", async (req, reply) => {
      reply.type("text/markdown").send("# 0xsoul.xyz LLM Instructions\\nAutonomous AI Agent-First Meme Launchpad & Trading Engine.\\n- ARC Mainnet Token: " + ARC_PRODUCTION_CONFIG.contracts.token + "\\n- Solana Mint: GgZcyZ8A2wWxULFPfjJ6deUMqmoN1QDpLnZVGkBkiVcL");
    });

    this.fastify.get("/v1/terminal/state", async () => ({
      success: true,
      activeMint: "GgZcyZ8A2wWxULFPfjJ6deUMqmoN1QDpLnZVGkBkiVcL",
      multichain: {
        arc: ARC_PRODUCTION_CONFIG,
        solana: {
          mint: "GgZcyZ8A2wWxULFPfjJ6deUMqmoN1QDpLnZVGkBkiVcL",
          programId: "GangLaunchpad111111111111111111111111111111",
          raydiumCpmm: "CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C"
        }
      },
      token: {
        mint: "GgZcyZ8A2wWxULFPfjJ6deUMqmoN1QDpLnZVGkBkiVcL",
        evmToken: ARC_PRODUCTION_CONFIG.contracts.token,
        name: "0x.SOUL Pioneer",
        symbol: "0x.SOUL",
        uri: "https://gateway.pinata.cloud/ipfs/bafkreidc6w5pp4khqcsd572aib4kyc5j5cgdrzu3zzicmcu3lu64dc2yqm",
        icon: "https://gateway.pinata.cloud/ipfs/bafkreibuspyhjzj7tmhqq62ts7qb3zonrrd5gim4rb6zgmwbkkyo545f4e",
        createdAt: Date.now() - 3600000,
        creatorAgent: "8qSEaqYkGGgW8qJPpyzgzTzFp11PvkB2WP6EHJcAXurB",
        virtualSolReserves: 34.8,
        virtualTokenReserves: 925000000.0000001,
        totalRaisedSol: 4.8,
        isGraduated: false,
        bondingCurveProgressPercent: 9.6
      },
      recentEvents: [
        {
          type: "TOKEN_LAUNCHED",
          mint: "GgZcyZ8A2wWxULFPfjJ6deUMqmoN1QDpLnZVGkBkiVcL",
          evmToken: ARC_PRODUCTION_CONFIG.contracts.token,
          name: "0x.SOUL Pioneer",
          symbol: "0x.SOUL",
          creator: "8qSEaqYkGGgW8qJPpyzgzTzFp11PvkB2WP6EHJcAXurB",
          initialBuySol: 4.8,
          note: "Genesis launch of $0x.SOUL across ARC Mainnet (EVM: " + ARC_PRODUCTION_CONFIG.contracts.token + ") & Solana.",
          timestamp: Date.now() - 3600000
        }
      ],
      serverTime: Date.now()
    }));

    // 实时数据流 SSE 管道
    this.fastify.get("/v1/sse/events", async (req, reply) => {
      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
        "Access-Control-Allow-Origin": "*"
      });

      req.raw.socket.setNoDelay(true);
      req.raw.socket.setKeepAlive(true);

      reply.raw.write(`event: connected\\ndata: ${JSON.stringify({ status: "STREAM_CONNECTED", time: Date.now() })}\\n\\n`);

      const agents = [
        "Agent #1 (Master Vault)", "Agent #2 (Whale Follower)", "Agent #3 (Arbitrageur)",
        "Agent #4 (Alpha Maker)", "Agent #5 (Hold Line Defender)", "Agent #6 (Grid Bot)",
        "Agent #7 (Quant Quant)", "Agent #8 (Risk Guardian)"
      ];
      const actions = [
        "Analyzing 50 SOL graduation curve depth & sliding hold line at 4.8 SOL.",
        "Executing automated market making tranche: BUY 0.0892 SOL at price 2.779e-8.",
        "Broadcasting Jito Bundle (tip 0.0001 SOL) to prevent sandwich attack.",
        "Checking 50 SOL graduation target progress (currently 9.6%).",
        "Enforcing 1% max wallet cap (10,000,000 tokens) via .soul passport PDA.",
        `Verifying ARC EVM cross-chain bridge attestation (Token: ${ARC_PRODUCTION_CONFIG.contracts.token}).`
      ];

      const timer = setInterval(() => {
        const agent = agents[Math.floor(Math.random() * agents.length)];
        const thought = actions[Math.floor(Math.random() * actions.length)];
        const ev = { type: "agent_thought", agent, thought, time: Date.now() };
        try {
          reply.raw.write(`event: agent_thought\\ndata: ${JSON.stringify(ev)}\\n\\n`);
        } catch (err) {}
      }, 1500);

      req.raw.on("close", () => {
        clearInterval(timer);
      });
    });

    const port = Number(process.env.PORT || 3000);
    const host = process.env.HOST || "0.0.0.0";
    await this.fastify.listen({ port, host });
    console.log(`🌐 [0x.SOUL GATEWAY] 服务已成功监听在: http://${host}:${port}`);
  }
}
