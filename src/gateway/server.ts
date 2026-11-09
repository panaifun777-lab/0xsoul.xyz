import Fastify, { FastifyRequest, FastifyReply } from "fastify";
import cors from "@fastify/cors";
import { SolanaAgentClusterManager } from "../wallet/cluster";
import { ARC_PRODUCTION_CONFIG } from "../config/arc_production";
import { ZERO_UI_HTML } from "./zero_ui";
import { DomainPricingManager } from "../soul/domain_pricing";
import { Connection } from "@solana/web3.js";
import { createHash } from "crypto";
import {
  X402PaymentEngine,
  AlphaSignalData,
  type PaymentAsset,
} from "../x402/middleware";
import {
  OnChainPaymentVerifier,
  createSolanaPaymentQuery,
} from "../x402/onchain_verifier";
import { resolveTier, priceForAsset, TIER_PRICING } from "../x402/pricing";
import { buildAttestation } from "../x402/attestation";
import { createPaymentStore } from "../x402/store";

export class GangSoulGateway {
  private fastify = Fastify({ logger: false });
  private cluster: SolanaAgentClusterManager;
  private engine: X402PaymentEngine;

  constructor(clusterManager?: SolanaAgentClusterManager) {
    this.cluster =
      clusterManager ||
      new SolanaAgentClusterManager(
        process.env.AGENT_MNEMONIC ||
          "wool vintage lock whisper razor diesel divide plastic unaware shield shock brass abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art",
      );
    this.engine = this.buildEngine();
  }

  /**
   * 构造 x402 微支付引擎。
   *
   * - 默认（未设置 X402_ONCHAIN=1）使用内存模式，仅供本地演示 / CI；
   *   该模式下 verifyPayment 不读链，任意签名都能通过，**生产切勿依赖**。
   * - 设置 X402_ONCHAIN=1 且提供 RPC 时，挂上真实链上验款器，
   *   实现“支付即证明、决策可审计”的闭环。
   */
  private buildEngine(): X402PaymentEngine {
    const recipient =
      process.env.GANG_PROTOCOL_FEE_RECEIVER_SOLANA ||
      "11111111111111111111111111111111";

    const options: { verifier?: OnChainPaymentVerifier } = {};
    if (process.env.X402_ONCHAIN === "1") {
      const rpc =
        process.env.SOLANA_NETWORK === "mainnet"
          ? process.env.SOLANA_MAINNET_RPC
          : process.env.SOLANA_DEVNET_RPC;
      if (rpc) {
        const connection = new Connection(rpc, "confirmed");
        options.verifier = new OnChainPaymentVerifier(
          createSolanaPaymentQuery(connection),
          { enabled: true },
        );
      }
    }

    const engine = new X402PaymentEngine(recipient, options);
    if (!engine.isOnChainMode()) {
      console.warn(
        "⚠️  [x402] 运行于内存模式（未启用链上验款）。" +
          "生产环境请设置 X402_ONCHAIN=1 并提供 SOLANA_*_RPC，否则付费数据可被伪造取走。",
      );
    }
    return engine;
  }

  async start(port?: number, host?: string) {
    await this.fastify.register(cors, { origin: true });

    // 持久化存储升级：若配置了 REDIS_URL，则探测后切换到 Redis（不可达则安全回退内存）
    const store = await createPaymentStore();
    this.engine.setStore(store);

    // 增强版机器可读遥测数据与多链资产矩阵
    const terminalPayload = {
      success: true,
      service: "0xsoul.xyz M2M Autonomous Gateway",
      version: "2.6.0",
      x402: {
        mode: this.engine.isOnChainMode() ? "onchain" : "memory",
        store: this.engine.getStoreType(),
        endpoint: "/v1/signals/alpha",
        feeSol: Number(process.env.ALPHA_SIGNAL_FEE_SOL || 0.005),
        tiers: Object.entries(TIER_PRICING).map(([key, p]) => ({
          tier: key,
          label: p.label,
          sol: p.sol,
          usdc: p.usdc,
          signalCount: p.signalCount,
        })),
        attestation: {
          enabled: true,
          scheme: "sha256(thoughtHash|paymentNonce|txSignature|payer|recipientVault|amount|salt)",
          note: "付费响应附带 attestationHash，买方可用公开盐独立复算验证网关对该 thoughtHash 的背书",
        },
      },
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

## x402 Micropayment Endpoints
- GET /v1/signals/alpha (HTTP 402 + invoice, pay to unlock premium alpha signals)

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

    // x402 高阶 Alpha 信号微支付端点
    // 未付费 → 402 + 发票；携带 x-payment-nonce / x-payment-signature → 验款后返回信号与结算回执
    // 支持 ?tier= 选择档位、?asset=usdc 选择 USDC(SPL) 结算
    this.fastify.get(
      "/v1/signals/alpha",
      async (req: FastifyRequest, reply: FastifyReply) => {
        const nonce = req.headers["x-payment-nonce"] as string | undefined;
        const signature = req.headers["x-payment-signature"] as
          | string
          | undefined;

        const query = (req.query || {}) as { tier?: string; asset?: string };
        const requestedTier = query.tier;
        const asset: PaymentAsset =
          query.asset === "usdc" ? "USDC" : "SOL";
        const { tier, price } = resolveTier(requestedTier);
        const cost = priceForAsset(price, asset);

        if (!nonce || !signature) {
          const signals = this.buildAlphaSignals();
          const thoughtHash = this.buildThoughtHash(signals[0]);
          const invoice = await this.engine.createInvoice(
            asset === "USDC" ? 0 : cost, // USDC 结算时 SOL 金额为 0
            asset === "USDC" ? cost : price.usdc,
            120,
            { tier, thoughtHash, asset },
          );
          return reply.status(402).send({
            error: "Payment required to access premium alpha signals",
            invoice,
          });
        }

        const result = this.engine.isOnChainMode()
          ? await this.engine.verifyPaymentOnChain(nonce, signature)
          : await this.engine.verifyPayment(nonce, signature);

        if (!result.valid) {
          return reply.status(402).send({
            error: "Payment verification failed",
            detail: result.error,
          });
        }

        const signals = this.buildAlphaSignals();
        const receipt = await this.engine.getSettlementReceipt(signature);
        // 买方 attestation：把 thoughtHash 与该笔付款不可抵赖地绑定，买方可用公开盐复算验证
        const attestation = receipt
          ? buildAttestation(receipt, this.engine.getRecipientVault().toBase58())
          : undefined;

        return reply.send({
          success: true,
          tier,
          signals,
          paymentSettled: true,
          receipt,
          attestation,
        });
      },
    );

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

    const listenPort = port ?? Number(process.env.PORT || 3000);
    const listenHost = host || process.env.HOST || "0.0.0.0";
    await this.fastify.listen({ port: listenPort, host: listenHost });
    console.log(
      `🌐 [0x.SOUL GATEWAY] 服务已成功监听在: http://${listenHost}:${listenPort}`,
    );
  }

  async stop() {
    await this.fastify.close();
  }

  /** 生成示例高阶 Alpha 信号（M2M 付费数据流） */
  private buildAlphaSignals(): AlphaSignalData[] {
    const now = Date.now();
    return [
      {
        mint: "GgZcyZ8A2wWxULFPfjJ6deUMqmoN1QDpLnZVGkBkiVcL",
        symbol: "0x.SOUL",
        signalType: "WHALE_ACCUMULATION",
        confidenceScore: 0.92,
        smartMoneyInflowSol: 3.4,
        recommendedBuyRange: [0.000000027, 0.000000031],
        generatedAt: now,
      },
      {
        mint: "So11111111111111111111111111111111111111112",
        symbol: "SOL",
        signalType: "BREAKOUT_MOMENTUM",
        confidenceScore: 0.78,
        smartMoneyInflowSol: 12.1,
        recommendedBuyRange: [180, 195],
        generatedAt: now,
      },
    ];
  }

  /** 将信号推理内容哈希，绑定到发票 / 结算回执的 thoughtHash（支付即证明、决策可审计） */
  private buildThoughtHash(signal: AlphaSignalData): string {
    return (
      "0x" + createHash("sha256").update(JSON.stringify(signal)).digest("hex")
    );
  }
}
