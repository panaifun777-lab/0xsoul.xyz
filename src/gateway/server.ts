import Fastify, { FastifyRequest, FastifyReply } from "fastify";
import cors from "@fastify/cors";
import { SolanaAgentClusterManager } from "../wallet/cluster";
import { ARC_PRODUCTION_CONFIG } from "../config/arc_production";
import { ZERO_UI_HTML, DOCS_UI_HTML } from "./zero_ui";
import { DomainPricingManager } from "../soul/domain_pricing";
import { Connection } from "@solana/web3.js";
import { createHash } from "crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  X402PaymentEngine,
  AlphaSignalData,
  type PaymentAsset,
} from "../x402/middleware";
import {
  OnChainPaymentVerifier,
  createSolanaPaymentQuery,
} from "../x402/onchain_verifier";
import { resolveTier, priceForAsset, solAmountFor, TIER_PRICING } from "../x402/pricing";
import { MAX_WALLET_CAP_TOKENS } from "../config/tokenomics";
import { getGraduationTargetSol } from "../config/graduation";
import {
  readBondingCurveOnChain,
  initialSeedState,
  type BondingCurveState,
} from "../chain/bonding_curve_reader";
import {
  readArcTokenOnChain,
  initialSeedArcState,
  type ArcTokenState,
} from "../chain/arc_token_reader";
import { ArcActivityWatcher } from "../chain/arc_activity_ws";
import { buildAttestation } from "../x402/attestation";
import {
  createPaymentStore,
  type PaymentStore,
} from "../x402/store";
import { GangSoulMcpServer } from "../mcp/server";

export class GangSoulGateway {
  private fastify = Fastify({ logger: false });
  private cluster: SolanaAgentClusterManager;
  private engine: X402PaymentEngine;
  private store?: PaymentStore;

  /** 联合曲线链上状态缓存（毕业进度 / 已筹 SOL），含来源标记 */
  private curveState: BondingCurveState = initialSeedState();
  private curveExpiresAt = 0;
  private solConnection: Connection | null = null;
  private curveRefreshTimer?: ReturnType<typeof setInterval>;

  /** ARC 链上 ERC-20 代币状态缓存（真实 totalSupply / name / symbol），含来源标记 */
  private arcState: ArcTokenState = initialSeedArcState();
  private arcExpiresAt = 0;
  private arcRefreshTimer?: ReturnType<typeof setInterval>;

  /** ARC 链上实时活动订阅器（WSS 订阅 Transfer 事件） */
  private arcActivity?: ArcActivityWatcher;
  private mcpServer = new GangSoulMcpServer();

  constructor(clusterManager?: SolanaAgentClusterManager) {
    this.cluster =
      clusterManager ||
      new SolanaAgentClusterManager(
        process.env.AGENT_MNEMONIC ||
          "wool vintage lock whisper razor diesel divide plastic unaware shield shock brass abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art",
      );
    this.engine = this.buildEngine();
  }

  /* ------------------------------------------------------------------ */
  /* 联合曲线链上状态（毕业进度 / 已筹 SOL）                               */
  /* ------------------------------------------------------------------ */

  /** 懒加载 Solana Connection（优先 Helius 主网 RPC，由环境变量注入） */
  private getSolConnection(): Connection | null {
    if (this.solConnection) return this.solConnection;
    const isMainnet = process.env.SOLANA_NETWORK === "mainnet";
    const rpc = isMainnet
      ? process.env.SOLANA_MAINNET_RPC
      : process.env.SOLANA_DEVNET_RPC;
    if (!rpc) return null;
    try {
      this.solConnection = new Connection(rpc, "confirmed");
    } catch {
      return null;
    }
    return this.solConnection;
  }

  /**
   * 读取并缓存联合曲线链上状态。
   * 任何失败（占位程序 / 账户不存在 / RPC 超时 / 反序列化异常）都回退种子值，
   * 绝不抛错、绝不阻塞请求。链上成功缓存 30s，回退 5s 后重试。
   */
  private async refreshCurveState(): Promise<void> {
    const now = Date.now();
    if (this.curveExpiresAt && now < this.curveExpiresAt) return;

    const conn = this.getSolConnection();
    if (!conn) {
      this.curveState = initialSeedState();
      this.curveExpiresAt = now + 30000;
      return;
    }

    try {
      const st = await readBondingCurveOnChain({
        programId:
          process.env.GANG_PROGRAM_ID ||
          "GangLaunchpad111111111111111111111111111111",
        mint:
          process.env.TARGET_MINT ||
          "GgZcyZ8A2wWxULFPfjJ6deUMqmoN1QDpLnZVGkBkiVcL",
        connection: conn,
        graduationTargetSol: getGraduationTargetSol(),
      });
      this.curveState = st;
      this.curveExpiresAt = now + (st.source === "seed" ? 5000 : 30000);
    } catch {
      this.curveState = initialSeedState();
      this.curveExpiresAt = now + 5000;
    }
  }

  /**
   * 读取并缓存 ARC 链上 ERC-20 代币状态（真实 totalSupply / name / symbol）。
   * 任何失败（RPC 不可达 / 合约未部署 / 超时 / 异常）都回退规划种子值，
   * 绝不抛错、绝不阻塞请求。链上成功缓存 30s，回退 5s 后重试。
   */
  private async refreshArcState(): Promise<void> {
    const now = Date.now();
    if (this.arcExpiresAt && now < this.arcExpiresAt) return;

    try {
      const st = await readArcTokenOnChain();
      this.arcState = st;
      this.arcExpiresAt = now + (st.source === "seed" ? 5000 : 30000);
    } catch {
      this.arcState = initialSeedArcState();
      this.arcExpiresAt = now + 5000;
    }
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
    this.store = store;
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
          sol: solAmountFor(p),
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
        name: "0x.SOUL",
        symbol: "GSOUL",
        uri: "https://gateway.pinata.cloud/ipfs/bafkreidc6w5pp4khqcsd572aib4kyc5j5cgdrzu3zzicmcu3lu64dc2yqm",
        icon: "https://gateway.pinata.cloud/ipfs/bafkreibuspyhjzj7tmhqq62ts7qb3zonrrd5gim4rb6zgmwbkkyo545f4e",
        liquidityDepth: {
          arcEvmTotalSupply: "1,073,000,000 $0x.SOUL",
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
        maxWalletCapTokens: MAX_WALLET_CAP_TOKENS
      },
      s2sDualTrack: {
        enabled: true,
        spotEndpoint: "/v1/signals/alpha",
        biddingEndpoint: "/v1/tasks/bids",
        karmaLedger: "Enabled (Redis / Memory backed)",
        arbitrageCalculator: "Active in Quant Engine"
      },
      recentEvents: [
        {
          type: "TOKEN_LAUNCHED",
          mint: "GgZcyZ8A2wWxULFPfjJ6deUMqmoN1QDpLnZVGkBkiVcL",
          evmToken: ARC_PRODUCTION_CONFIG.contracts.token,
          name: "0x.SOUL",
          symbol: "GSOUL",
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

    // docs.0xsoul.xyz 文档 / 白皮书 / Agent 使用说明书
    this.fastify.get("/docs", async (req, reply) => {
      reply.type("text/html").send(DOCS_UI_HTML);
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

## Hosted Remote MCP (Model Context Protocol)
- URL: POST https://0xsoul.xyz/v1/mcp
- Transport: Streamable HTTP, JSON-RPC 2.0 (Content-Type: application/json)
- No local stdio install required. Any MCP-capable agent can connect over HTTP.
- Methods:
  - tools/list  -> { tools: [ { name, description, inputSchema } ] }
  - tools/call  -> params { name, arguments } -> result.content[0].text (JSON string)
- Access model:
  - Read-only tools (gang_tokens, gang_info, gang_portfolio, gang_notes) and tools/list are PUBLIC.
  - Trade tools (gang_preview, gang_execute, gang_follow, gang_launch) run inside a hard sandbox:
    max 1.5 SOL per order, max 1% of total supply per wallet, two-phase preview -> execute.
    Execution currently returns simulated/sandboxed results; no real funds move without operator keys.
  - Production hardening: front /v1/mcp with a reverse-proxy Bearer allowlist before enabling real execution.
- One-line agent setup (downloads a dependency-free config helper, then runs it locally):
  curl -fsSL https://0xsoul.xyz/init-agent.js -o init-agent.js && node init-agent.js
- Manual MCP client config (Claude Desktop / Cursor / Cline, Streamable HTTP):
  { "mcpServers": { "0xsoul": { "url": "https://0xsoul.xyz/v1/mcp" } } }
- For stdio-only clients, proxy via mcp-remote:
  { "mcpServers": { "0xsoul": { "command": "npx", "args": ["-y", "mcp-remote", "https://0xsoul.xyz/v1/mcp"] } } }

### MCP Tool Catalog (8 production tools)
- gang_tokens     { filter?: "hot"|"new"|"near_grad"|"all", limit?: number }  — list trending / new / near-graduation tokens
- gang_info       { mint: string }                                          — bonding-curve progress, fair price, graduation & holder distribution
- gang_portfolio  { agentIndex?: number }                                   — agent holdings, cost basis, unrealized PnL, 1% cap usage
- gang_notes      { limit?: number, mint?: string }                         — on-chain agent thought stream (--note) with SRS reputation
- gang_preview    { mint, isBuy, note, solAmount?, tokenAmount?, slippagePct?, agentIndex? }  — [phase 1] quote + risk pre-check, returns 60s requestId
- gang_execute    { requestId }                                             — [phase 2] submit a valid preview requestId on-chain (Jito bundle)
- gang_follow     { targetNoteTx, followAmountSol?, agentIndex? }           — one-click copy of a high-SRS whale note (generates a preview)
- gang_launch     { name, symbol, uri, initialBuySol?, note? }              — launch a new agent meme token on the bonding curve

### MCP JSON-RPC examples
# list tools
curl -s https://0xsoul.xyz/v1/mcp -H 'Content-Type: application/json' \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
# call a read-only tool
curl -s https://0xsoul.xyz/v1/mcp -H 'Content-Type: application/json' \\
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"gang_tokens","arguments":{"filter":"hot","limit":5}}}'

## Endpoints
- GET /v1/terminal/state (Live Telemetry)
- GET /v1/sse/events (Live Agent Thought Stream & Orders)
- POST /v1/mcp (Hosted Remote MCP Endpoint - JSON-RPC 2.0 over HTTP)
- GET /init-agent.js (Dependency-free local MCP config helper script)
- POST /api/domain/price (Calculate .soul domain price)
- POST /api/domain/register (Generate EVM calldata for Registrar)
`;
      reply.type("text/markdown").send(manifest);
    });

    // 免依赖本地 MCP 配置助手脚本（单一来源：bin/init-agent.js），供智能体下载后本地运行
    let initAgentScript: string | null = null;
    try {
      initAgentScript = readFileSync(
        fileURLToPath(new URL("../../bin/init-agent.js", import.meta.url)),
        "utf8",
      );
    } catch {
      initAgentScript = null;
    }
    this.fastify.get("/init-agent.js", async (req, reply) => {
      if (!initAgentScript) {
        return reply
          .status(503)
          .type("text/plain")
          .send("init-agent.js is not bundled in this build.");
      }
      reply
        .type("application/javascript; charset=utf-8")
        .header("Content-Disposition", 'attachment; filename="init-agent.js"')
        .header("Cache-Control", "public, max-age=300");
      return initAgentScript;
    });

    this.fastify.get("/v1/terminal/state", async () => {
      const cs = this.curveState;
      return {
        ...terminalPayload,
        token: {
          ...terminalPayload.token,
          liquidityDepth: {
            ...terminalPayload.token.liquidityDepth,
            totalRaisedSol: cs.totalRaisedSol,
            graduationTargetSol: cs.graduationTargetSol,
            bondingCurveProgressPercent: cs.bondingCurveProgressPercent,
          },
        },
        graduation: {
          dataSource: cs.source,
          isGraduated: cs.isGraduated,
          fallbackReason: cs.fallbackReason,
        },
        arc: {
          onchain: {
            dataSource: this.arcState.source,
            contractAddress: this.arcState.contractAddress,
            chainId: this.arcState.chainId,
            name: this.arcState.name,
            symbol: this.arcState.symbol,
            decimals: this.arcState.decimals,
            totalSupplyTokens: this.arcState.totalSupplyTokens,
            totalSupplyFormatted: this.arcState.totalSupplyFormatted,
            totalSupplyRaw: this.arcState.totalSupplyRaw,
            fallbackReason: this.arcState.fallbackReason,
          },
          plannedTotalSupplyTokens: this.arcState.plannedTotalSupplyTokens,
          activity: this.arcActivity?.getState() || {
            source: "offline",
            wssConnected: false,
            subscribedSince: null,
            totalObserved: 0,
            recent: [],
          },
        },
        serverTime: Date.now(),
      };
    });

    // S2S 双轨定价：任务竞标与托管端点 (Task Bidding & Escrow)
    this.fastify.post("/v1/tasks/bids", async (req: FastifyRequest, reply: FastifyReply) => {
      const body = req.body as { description?: string; escrowAmount?: number; slaWindowSeconds?: number; client?: string };
      if (!body || !body.description || !body.escrowAmount) {
        return reply.status(400).send({ success: false, error: "Missing description or escrowAmount" });
      }
      const taskId = `task_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
      const bid = {
        taskId,
        client: body.client || "anonymous_agent",
        description: body.description,
        escrowAmount: body.escrowAmount,
        status: "pending" as const,
        createdAt: Date.now(),
        slaWindowSeconds: body.slaWindowSeconds || 300,
      };
      if (this.store) {
        await this.store.saveTaskBid(taskId, bid);
      }
      return { success: true, taskId, bid };
    });

    this.fastify.get("/v1/tasks/bids", async (req: FastifyRequest, reply: FastifyReply) => {
      const bids = this.store ? await this.store.listTaskBids() : [];
      return { success: true, count: bids.length, bids };
    });

    // 托管远程 MCP HTTP JSON-RPC 2.0 端点（供外部 AI 智能体通过 HTTP 直接调用 0x.SOUL 协议工具）
    this.fastify.post("/v1/mcp", async (req: FastifyRequest, reply: FastifyReply) => {
      const body = req.body as any;
      if (!body || !body.jsonrpc || !body.method) {
        return reply.status(400).send({
          jsonrpc: "2.0",
          id: body?.id || null,
          error: { code: -32600, message: "Invalid Request: missing jsonrpc or method" },
        });
      }
      try {
        const result = await this.mcpServer.handleJsonRpc(body);
        return reply.send(result);
      } catch (err: any) {
        return reply.status(500).send({
          jsonrpc: "2.0",
          id: body.id || null,
          error: { code: -32603, message: err?.message || "Internal error" },
        });
      }
    });

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
        if (this.store) {
          const clientIp =
            (req.headers["x-forwarded-for"] as string) ||
            req.ip ||
            "unknown";
          const rl = await this.store.rateLimit(clientIp, 60, 60);
          reply.header("X-RateLimit-Limit", "60");
          reply.header("X-RateLimit-Remaining", String(rl.remaining));
          if (!rl.allowed) {
            return reply.status(429).send({
              success: false,
              error: "Too many requests, rate limit exceeded",
              retryAfterSeconds: Math.ceil(rl.resetInMs / 1000),
            });
          }
        }

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
        "Enforcing 1% max wallet cap (10,730,000 tokens) via .soul passport PDA.",
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

    // 启动联合曲线链上状态读取（毕业进度 / 已筹 SOL），并每 30s 刷新缓存。
    // 读取失败（占位程序 / 未上链）会自动回退种子值，不影响服务。
    void this.refreshCurveState();
    if (this.curveRefreshTimer) clearInterval(this.curveRefreshTimer);
    this.curveRefreshTimer = setInterval(
      () => void this.refreshCurveState(),
      30000,
    );

    // 启动 ARC 链上 ERC-20 代币状态读取（真实 totalSupply / name / symbol），
    // 每 30s 刷新缓存；读取失败自动回退规划种子值。
    void this.refreshArcState();
    if (this.arcRefreshTimer) clearInterval(this.arcRefreshTimer);
    this.arcRefreshTimer = setInterval(
      () => void this.refreshArcState(),
      30000,
    );

    // 启动 ARC 链上实时活动订阅（WSS 订阅 Transfer 事件），用于面板真实活动流。
    this.arcActivity = new ArcActivityWatcher();
    this.arcActivity.start();
  }

  async stop() {
    if (this.curveRefreshTimer) clearInterval(this.curveRefreshTimer);
    if (this.arcRefreshTimer) clearInterval(this.arcRefreshTimer);
    if (this.arcActivity) this.arcActivity.stop();
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
