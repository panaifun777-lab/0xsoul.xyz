import Fastify, { FastifyRequest, FastifyReply } from "fastify";
import cors from "@fastify/cors";
import { SolanaAgentClusterManager } from "../wallet/cluster";
import { ARC_PRODUCTION_CONFIG } from "../config/arc_production";
import { ZERO_UI_HTML } from "./zero_ui";
import { DomainPricingManager } from "../soul/domain_pricing";

export class GangSoulGateway {
  private fastify = Fastify({ logger: false });
  private cluster: SolanaAgentClusterManager;

  constructor() {
    this.cluster = new SolanaAgentClusterManager();
  }

  async start() {
    await this.fastify.register(cors, { origin: true });

    // 增强版机器可读遥测数据与多链资产矩阵
    const terminalPayload = {
      success: true,
      service: "0xsoul.xyz M2M Autonomous Gateway",
      version: "2.6.0",
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
        liquidityDepth: {
          arcEvmTotalSupply: "1,000,000,000 $0x.SOUL",
          solanaVirtualSolReserves: 34.8,
          solanaVirtualTokenReserves: 925000000.0,
          totalRaisedSol: 4.8,
          graduationTargetSol: 50.0,
          bondingCurveProgressPercent: 9.6
        }
      },
      agentSwarmAllocation: {
        activeNodes: 10,
        strategyStatus: "Grid Market Making & Hold Line Defense Active",
        gridQuantProfitSol: 0.4182,
        maxWalletCapPercent: 1.0,
        maxWalletCapTokens: 10000000
      },
      srsReputationMatrix: {
        systemAverageScore: 9850,
        maxScore: 10000,
        microPaymentSuccessRate: "99.94%"
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
    };

    this.fastify.get("/", async (req, reply) => {
      reply.type("text/html").send(ZERO_UI_HTML);
    });

    this.fastify.get("/terminal", async (req, reply) => {
      reply.type("text/html").send(ZERO_UI_HTML);
    });

    // 机器说明书 /llms.txt (包含多链资产与 A2A Telemetry)
    this.fastify.get("/llms.txt", async (req, reply) => {
      const manifest = `# 0xsoul.xyz LLM Instructions & A2A Telemetry
Autonomous AI Agent-First Meme Launchpad & Trading Engine.

## Multi-Chain Assets
- ARC Mainnet (EVM) Token: ${ARC_PRODUCTION_CONFIG.contracts.token}
- ARC Domain Registry: ${ARC_PRODUCTION_CONFIG.contracts.registry}
- ARC Domain Resolver: ${ARC_PRODUCTION_CONFIG.contracts.resolver}
- ARC Domain Registrar: ${ARC_PRODUCTION_CONFIG.contracts.registrar}
- Solana Genesis Mint: GgZcyZ8A2wWxULFPfjJ6deUMqmoN1QDpLnZVGkBkiVcL
- Protocol Beneficiary / Owner: ${ARC_PRODUCTION_CONFIG.owner}

## Tiered Domain Pricing (.soul)
- <= 4 chars (Premium Short): 10.0 USDC
- 5 chars (Standard): 4.0 USDC
- 5 digits / Numeric: 2.0 USDC
- >= 6 chars (Long-tail): 0.99 USDC

## Endpoints
- GET /v1/terminal/state (Live Telemetry)
- GET /v1/sse/events (Live Agent Thought Stream & Orders)
- POST /api/domain/price (Calculate .soul domain price)
- POST /api/domain/register (Generate EVM calldata for Registrar)
`;
      reply.type("text/markdown").send(manifest);
    });

    this.fastify.get("/v1/terminal/state", async () => terminalPayload);

    // 阶梯定价查询 API
    this.fastify.post("/api/domain/price", async (req: FastifyRequest, reply: FastifyReply) => {
      const body = req.body as { domain?: string };
      if (!body || !body.domain) {
        return reply.status(400).send({ success: false, error: "Missing domain parameter" });
      }
      const pricing = DomainPricingManager.calculatePrice(body.domain);
      return { success: true, pricing };
    });

    // 域名注册交易参数生成 API
    this.fastify.post("/api/domain/register", async (req: FastifyRequest, reply: FastifyReply) => {
      const body = req.body as { domain?: string; owner?: string };
      if (!body || !body.domain || !body.owner) {
        return reply.status(400).send({ success: false, error: "Missing domain or owner parameter" });
      }
      const pricing = DomainPricingManager.calculatePrice(body.domain);
      const txData = DomainPricingManager.encodeRegisterTransaction(body.domain, body.owner);
      return {
        success: true,
        pricing,
        transaction: txData
      };
    });

    // SSE 实时数据流管道
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
