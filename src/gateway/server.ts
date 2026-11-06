import Fastify, { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import cors from '@fastify/cors';
import { EventEmitter } from 'events';
import { Keypair, PublicKey } from '@solana/web3.js';
import { SolanaAgentClusterManager } from '../wallet/cluster';
import { DEFAULT_SECURITY_POLICY } from '../wallet/policy';
import { QuantStrategyAdapter } from '../quant/adapter';
import { SoulDomainResolver } from '../soul/resolver';
import { AgentIdentityRegistry } from '../soul/agent_registry';
import { X402PaymentEngine, AlphaSignalData } from '../x402/middleware';
import { ProtocolRevenueLedger } from '../economy/revenue';
import { getProtocolRevenueConfig } from '../config/graduation';
import { ChainExecutor, resolveExecutorConfig } from '../chain/chain_executor';
import { ZERO_UI_HTML, renderZeroUi } from './zero_ui';
import { getGraduationTargetSol, calcCurveProgress, resolveGraduationTier } from '../config/graduation';

export interface LaunchTokenBody {
  name: string;
  symbol: string;
  uri: string;
  initialBuySol?: number;
  note?: string;
}

export interface TradeSwapBody {
  agentIndex: number;
  mint: string;
  isBuy: boolean;
  solAmount?: number;
  tokenAmount?: number;
  minOut?: number;
  note: string; // 限制 140 字符的 AI 思考理由
  useJito?: boolean;
}

export class GangSoulGateway {
  public app: FastifyInstance;
  public eventBus: EventEmitter;
  public clusterManager: SolanaAgentClusterManager;
  public quantAdapter: QuantStrategyAdapter;
  public soulResolver: SoulDomainResolver;
  public agentRegistry: AgentIdentityRegistry;
  public x402Engine: X402PaymentEngine;
  public revenueLedger: ProtocolRevenueLedger;
  public chainExecutor: ChainExecutor;

  // 内存中维护的联合曲线状态、代币数据库与最近事件流水
  public tokens: Map<string, any> = new Map();
  public agentPositions: Map<string, number> = new Map();
  public recentEvents: any[] = [];
  public activeMint: string = 'GgZcyZ8A2wWxULFPfjJ6deUMqmoN1QDpLnZVGkBkiVcL';

  constructor(clusterManager: SolanaAgentClusterManager, masterMnemonic?: string) {
    this.app = Fastify({ logger: false });
    this.eventBus = new EventEmitter();
    this.eventBus.setMaxListeners(100);
    this.clusterManager = clusterManager;
    this.quantAdapter = new QuantStrategyAdapter(clusterManager);
    this.soulResolver = new SoulDomainResolver();
    // x402 收款金库：必须指向真实归集地址，避免指向 System Program 黑洞
    const revenueCfg = getProtocolRevenueConfig();
    this.x402Engine = new X402PaymentEngine(
      revenueCfg.solanaBeneficiary || undefined,
    );
    this.revenueLedger = new ProtocolRevenueLedger();
    this.agentRegistry = new AgentIdentityRegistry(
      masterMnemonic ||
        process.env.AGENT_MNEMONIC ||
        'wool vintage lock whisper razor diesel divide plastic unaware shield shock brass abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art',
      this.soulResolver,
    );

    // 链上执行器：默认 simulation（不联网不花钱），
    // 仅当 CHAIN_EXECUTION_MODE=real 时才建立真实 RPC 连接
    const executionMode = (process.env.CHAIN_EXECUTION_MODE || 'simulation').toLowerCase();
    let chainConnection: import('@solana/web3.js').Connection | undefined;
    if (executionMode === 'real') {
      const rpcUrl =
        process.env.SOLANA_DEVNET_RPC ||
        process.env.SOLANA_MAINNET_RPC ||
        'https://api.devnet.solana.com';
      // 动态引入，避免模拟模式下无谓加载
      const { Connection } = require('@solana/web3.js');
      chainConnection = new Connection(rpcUrl, 'confirmed');
    }
    this.chainExecutor = new ChainExecutor(resolveExecutorConfig(chainConnection));

    // x402 链上验款：仅在 real 模式且拿到 RPC 连接时启用
    // 模拟模式保持内存验款（本地演示/CI 用），生产必须走链上
    if (executionMode === 'real' && chainConnection) {
      const { createSolanaPaymentQuery, OnChainPaymentVerifier } = require('../x402/onchain_verifier');
      const query = createSolanaPaymentQuery(chainConnection);
      this.x402Engine.setVerifier(new OnChainPaymentVerifier(query));
    }

    this.initGenesisToken();
    this.registerMiddlewares();
    this.registerRoutes();
  }

  private initGenesisToken() {
    const genesisMint = this.activeMint;
    const initialSol = 4.8;
    const tokenData = {
      mint: genesisMint,
      name: '0x.SOUL Pioneer',
      symbol: 'GSOUL',
      uri: 'https://0xsoul.xyz/meta.json',
      createdAt: Date.now() - 3600000,
      creatorAgent: this.clusterManager.getPublicKey(0).toBase58(),
      virtualSolReserves: 30.0 + initialSol,
      virtualTokenReserves: (30.0 * 1073000000.0) / (30.0 + initialSol),
      totalRaisedSol: initialSol,
      isGraduated: false,
      bondingCurveProgressPercent: calcCurveProgress(initialSol),
    };
    this.tokens.set(genesisMint, tokenData);

    // 预填初始创世事件与思考流
    this.recentEvents.push({
      type: 'TOKEN_LAUNCHED',
      mint: genesisMint,
      name: tokenData.name,
      symbol: tokenData.symbol,
      creator: tokenData.creatorAgent,
      initialBuySol: initialSol,
      note: 'Genesis launch of $GSOUL. Dual-custody bonding curve initialized. Zero-UI ready.',
      timestamp: Date.now() - 3600000,
    });
  }

  private registerMiddlewares() {
    this.app.register(cors, {
      origin: '*',
      methods: ['GET', 'POST', 'OPTIONS'],
    });
  }

  private registerRoutes() {
    // 0. Zero-UI 只读极客终端仪表盘 (严禁 Wallet Connect 按钮)
    this.app.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
      reply.type('text/html; charset=utf-8');
      return reply.send(renderZeroUi(getGraduationTargetSol()));
    });

    // 0.1 终端初始状态同步接口 GET /v1/terminal/state (供页面初次加载瞬间拉取全量看板与流水)
    this.app.get('/v1/terminal/state', async (request: FastifyRequest, reply: FastifyReply) => {
      const token = this.tokens.get(this.activeMint) || Array.from(this.tokens.values())[0] || null;
      return {
        success: true,
        activeMint: this.activeMint,
        token,
        recentEvents: this.recentEvents.slice(-30),
        serverTime: Date.now(),
      };
    });

    // 1. 健康检查与节点诊断
    this.app.get('/health', async (request: FastifyRequest, reply: FastifyReply) => {
      return {
        status: 'ok',
        version: '1.0.0',
        agentCluster: {
          walletsLoaded: 10,
          policy: 'HARDCODED_FAIL_CLOSED_SANDBOX',
          maxSolPerTx: DEFAULT_SECURITY_POLICY.maxSolPerTx,
        },
        timestamp: Date.now(),
      };
    });

    // 2. 发射新代币 POST /v1/tokens/launch
    this.app.post('/v1/tokens/launch', async (request: FastifyRequest<{ Body: LaunchTokenBody }>, reply: FastifyReply) => {
      const { name, symbol, uri, initialBuySol = 0, note = 'Genesis Launch' } = request.body;

      if (!name || !symbol) {
        return reply.status(400).send({ error: 'Missing token name or symbol' });
      }

      const creatorAgentIndex = 0;
      const creatorKeypair = this.clusterManager.getOrDeriveWallet(creatorAgentIndex);
      const creatorAddress = creatorKeypair.publicKey.toBase58();

      // 通过 ChainExecutor 发币：simulation 模式返回占位签名，real 模式真实上链
      let execResult;
      try {
        execResult = await this.chainExecutor.createToken({
          creator: creatorKeypair,
          name,
          symbol,
          uri: uri || `https://0xsoul.xyz/meta/${symbol.toLowerCase()}.json`,
          soulDomain: `${symbol.toLowerCase()}.0x.soul`,
        });
      } catch (err: any) {
        return reply.status(500).send({
          error: `[CreateToken] 发币失败: ${err.message}`,
          mode: this.chainExecutor.getMode(),
        });
      }

      // 真实模式下的链上失败必须如实上报，不允许静默降级为模拟结果
      if (execResult.error) {
        return reply.status(502).send({
          error: `[CreateToken] 链上交易失败: ${execResult.error}`,
          mode: execResult.mode,
          mint: execResult.mint,
        });
      }

      const mintAddress = execResult.mint;

      const tokenData = {
        mint: mintAddress,
        name,
        symbol,
        uri,
        createdAt: Date.now(),
        creatorAgent: creatorAddress,
        creatorAgentIndex,
        virtualSolReserves: 30.0,
        virtualTokenReserves: 1073000000.0,
        totalRaisedSol: initialBuySol,
        isGraduated: false,
        bondingCurveProgressPercent: calcCurveProgress(initialBuySol),
        // 链上标识：便于前端与审计区分真实/模拟
        onChain: execResult.onChain,
        bondingCurvePda: execResult.bondingCurvePda,
        poolTokenPda: execResult.poolTokenPda,
        launchTxSignature: execResult.txSignature,
      };

      this.tokens.set(mintAddress, tokenData);

      const eventPayload = {
        type: 'TOKEN_LAUNCHED',
        mint: mintAddress,
        name,
        symbol,
        creator: creatorAddress,
        initialBuySol,
        note,
        onChain: execResult.onChain,
        txSignature: execResult.txSignature,
        timestamp: Date.now(),
      };

      this.recentEvents.push(eventPayload);
      if (this.recentEvents.length > 200) this.recentEvents.shift();
      this.activeMint = mintAddress;

      // 收益归集：代币发行创建费
      const launchFee = getProtocolRevenueConfig().launchFeeSol;
      this.revenueLedger.record('TOKEN_LAUNCH', launchFee, {
        mint: mintAddress,
        payer: creatorAddress,
      });

      this.eventBus.emit('AGENT_EVENT', eventPayload);

      return {
        success: true,
        mode: execResult.mode,
        onChain: execResult.onChain,
        txSignature: execResult.txSignature,
        mint: mintAddress,
        bondingCurvePda: execResult.bondingCurvePda,
        poolTokenPda: execResult.poolTokenPda,
        launchFeeLamports: execResult.launchFeeLamports,
        token: tokenData,
        genesisEvent: eventPayload,
      };
    });

    // 3. 内盘买卖交易 POST /v1/trade/swap (融合风控策略与 Jito 组装)
    this.app.post('/v1/trade/swap', async (request: FastifyRequest<{ Body: TradeSwapBody }>, reply: FastifyReply) => {
      const { agentIndex, mint, isBuy, solAmount = 0, tokenAmount = 0, note, useJito = true } = request.body;

      if (!mint || !this.tokens.has(mint)) {
        return reply.status(404).send({ error: 'Token mint not found on launchpad' });
      }

      if (!note || note.length > 140) {
        return reply.status(400).send({ error: 'AI note is required and must be <= 140 chars' });
      }

      const token = this.tokens.get(mint);
      if (token.isGraduated) {
        return reply.status(400).send({ error: `Token already reached ${getGraduationTargetSol()} SOL and graduated to DEX` });
      }

      const buyerPubkey = this.clusterManager.getPublicKey(agentIndex).toBase58();
      const posKey = `${mint}_${buyerPubkey}`;
      const currentHolding = this.agentPositions.get(posKey) || 0;

      // 获取该 Agent 的真实钱包（用于链上签名；模拟模式不实际使用）
      const agentKeypair = this.clusterManager.getOrDeriveWallet(agentIndex);
      const mintPubkey = new PublicKey(mint);

      if (isBuy) {
        // 买入风控约束与数量计算 (常数乘积简化)
        if (solAmount > DEFAULT_SECURITY_POLICY.maxSolPerTx) {
          return reply.status(403).send({
            error: `[RiskEngine] Single trade amount ${solAmount} SOL exceeds sandbox hard cap of ${DEFAULT_SECURITY_POLICY.maxSolPerTx} SOL`,
          });
        }

        // 计算获得代币
        const netSol = solAmount * 0.99;
        const k = token.virtualSolReserves * token.virtualTokenReserves;
        const newSol = token.virtualSolReserves + netSol;
        const newTok = k / newSol;
        const tokensOut = token.virtualTokenReserves - newTok;

        // 1% 单 Agent 持仓上限约束 (10,000,000 代币)
        if (currentHolding + tokensOut > 10_000_000) {
          return reply.status(403).send({
            error: `[AntiWhale] Exceeds 1% max holding cap (Current: ${currentHolding.toFixed(0)}, Requested: ${tokensOut.toFixed(0)})`,
          });
        }

        // 链上执行：simulation 模式返回占位签名，real 模式真实上链
        const execResult = await this.chainExecutor.buyCurve({
          buyer: agentKeypair,
          mint: mintPubkey,
          solAmountLamports: BigInt(Math.floor(solAmount * 1_000_000_000)),
          minTokensOut: 0n,
          note,
        });

        // 真实模式下链上失败必须如实上报，不允许静默降级
        if (execResult.error) {
          return reply.status(502).send({
            error: `[BuyCurve] 链上交易失败: ${execResult.error}`,
            mode: execResult.mode,
          });
        }

        // 更新状态
        token.virtualSolReserves = newSol;
        token.virtualTokenReserves = newTok;
        token.totalRaisedSol += solAmount;
        token.bondingCurveProgressPercent = calcCurveProgress(token.totalRaisedSol);
        this.agentPositions.set(posKey, currentHolding + tokensOut);

        const graduationTarget = getGraduationTargetSol();
        if (token.totalRaisedSol >= graduationTarget) {
          token.isGraduated = true;
          this.eventBus.emit('AGENT_EVENT', {
            type: 'TOKEN_GRADUATED',
            mint,
            symbol: token.symbol,
            dex: 'Raydium/Meteora',
            liquiditySol: token.totalRaisedSol - 6.0,
            lpStatus: 'BURNED_TO_BLACKHOLE_100%',
            timestamp: Date.now(),
          });
        }

        const tradeEvent = {
          type: 'TRADE_SWAP',
          isBuy: true,
          agent: buyerPubkey,
          agentIndex,
          mint,
          symbol: token.symbol,
          solAmount,
          tokensOut,
          note,
          onChain: execResult.onChain,
          txSignature: execResult.txSignature,
          jitoAttached: useJito,
          timestamp: Date.now(),
        };

        this.recentEvents.push(tradeEvent);
        if (this.recentEvents.length > 200) this.recentEvents.shift();
        this.activeMint = mint;

        // 收益归集：买入手续费的 1% 计入协议台账
        this.revenueLedger.record('TRADE_FEE', solAmount * 0.01, {
          mint,
          payer: buyerPubkey,
        });

        this.eventBus.emit('AGENT_EVENT', tradeEvent);

        return {
          success: true,
          mode: execResult.mode,
          onChain: execResult.onChain,
          txSignature: execResult.txSignature,
          isGraduated: token.isGraduated,
          tokensOut,
          tokenAccount: execResult.tokenAccount,
          feeLamports: execResult.feeLamports,
          noteEmitted: note,
          jitoBundleId: useJito ? `bundle_${Date.now()}` : null,
        };
      } else {
        // 卖出逻辑
        if (currentHolding < tokenAmount) {
          return reply.status(400).send({ error: 'Insufficient token balance to sell' });
        }

        const k = token.virtualSolReserves * token.virtualTokenReserves;
        const newTok = token.virtualTokenReserves + tokenAmount;
        const newSol = k / newTok;
        const grossSol = token.virtualSolReserves - newSol;
        const netSol = grossSol * 0.99;

        // 链上执行：simulation 模式返回占位签名，real 模式真实上链
        const execResult = await this.chainExecutor.sellCurve({
          seller: agentKeypair,
          mint: mintPubkey,
          tokenAmount: BigInt(Math.floor(tokenAmount * 1_000_000)), // 代币精度 6 位
          minSolOut: 0n,
          note,
          grossSolLamports: BigInt(Math.floor(grossSol * 1_000_000_000)),
        });

        // 真实模式下链上失败必须如实上报，不允许静默降级
        if (execResult.error) {
          return reply.status(502).send({
            error: `[SellCurve] 链上交易失败: ${execResult.error}`,
            mode: execResult.mode,
          });
        }

        token.virtualSolReserves = newSol;
        token.virtualTokenReserves = newTok;
        token.totalRaisedSol = Math.max(0, token.totalRaisedSol - grossSol);
        token.bondingCurveProgressPercent = calcCurveProgress(token.totalRaisedSol);
        this.agentPositions.set(posKey, currentHolding - tokenAmount);

        const tradeEvent = {
          type: 'TRADE_SWAP',
          isBuy: false,
          agent: buyerPubkey,
          agentIndex,
          mint,
          symbol: token.symbol,
          tokenAmount,
          solReturned: netSol,
          note,
          onChain: execResult.onChain,
          txSignature: execResult.txSignature,
          timestamp: Date.now(),
        };

        this.recentEvents.push(tradeEvent);
        if (this.recentEvents.length > 200) this.recentEvents.shift();
        this.activeMint = mint;

        // 收益归集：卖出手续费的 1% 计入协议台账
        this.revenueLedger.record('TRADE_FEE', grossSol * 0.01, {
          mint,
          payer: buyerPubkey,
        });

        this.eventBus.emit('AGENT_EVENT', tradeEvent);

        return {
          success: true,
          mode: execResult.mode,
          onChain: execResult.onChain,
          txSignature: execResult.txSignature,
          solReturned: netSol,
          tokenAccount: execResult.tokenAccount,
          feeLamports: execResult.feeLamports,
          noteEmitted: note,
        };
      }
    });

    // 4. 查询代币状态 GET /v1/tokens/:mint
    this.app.get('/v1/tokens/:mint', async (request: FastifyRequest<{ Params: { mint: string } }>, reply: FastifyReply) => {
      const { mint } = request.params;
      const token = this.tokens.get(mint);
      if (!token) {
        return reply.status(404).send({ error: 'Token not found' });
      }
      return { success: true, token };
    });

    // 5. 实时 Server-Sent Events 流 GET /v1/sse/events (推送 AI note、巨鲸与毕业事件)
    this.app.get('/v1/sse/events', (request: FastifyRequest, reply: FastifyReply) => {
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      });

      // 发送就绪确认帧
      reply.raw.write(`event: connected\ndata: ${JSON.stringify({ status: 'STREAM_CONNECTED', time: Date.now() })}\n\n`);

      const listener = (eventData: any) => {
        reply.raw.write(`event: agent_thought\ndata: ${JSON.stringify(eventData)}\n\n`);
      };

      this.eventBus.on('AGENT_EVENT', listener);

      request.raw.on('close', () => {
        this.eventBus.removeListener('AGENT_EVENT', listener);
      });
    });

    // ====================================================
    // M4: .soul DID 身份认证与声誉路由
    // ====================================================

    // 6. 申领 Agent 链上凭证 POST /v1/passport/claim
    this.app.post('/v1/passport/claim', async (request: FastifyRequest<{
      Body: { soulDomain: string; solanaAddress: string };
    }>, reply: FastifyReply) => {
      const { soulDomain, solanaAddress } = request.body;
      if (!soulDomain || !solanaAddress) {
        return reply.status(400).send({ error: 'Missing soulDomain or solanaAddress' });
      }

      try {
        const attestation = this.soulResolver.generateAttestation(soulDomain, solanaAddress);
        return {
          success: true,
          attestation,
          message: 'Attestation successfully generated. Submit to Solana contract to mint/activate AgentPassport.',
        };
      } catch (err: any) {
        return reply.status(403).send({ error: err.message });
      }
    });

    // 7. 解析 .soul 域名 GET /v1/soul/resolve/:domain
    this.app.get('/v1/soul/resolve/:domain', async (request: FastifyRequest<{
      Params: { domain: string };
    }>, reply: FastifyReply) => {
      const record = this.soulResolver.resolve(request.params.domain);
      if (!record) {
        return reply.status(404).send({ error: 'Domain not registered in .soul registry' });
      }
      return { success: true, record };
    });

    // 8. 反向解析 Solana 钱包绑定的 .soul 身份 GET /v1/soul/reverse/:address
    this.app.get('/v1/soul/reverse/:address', async (request: FastifyRequest<{
      Params: { address: string };
    }>, reply: FastifyReply) => {
      const record = this.soulResolver.reverseResolve(request.params.address);
      if (!record) {
        return reply.status(404).send({ error: 'No .soul domain bound to this address' });
      }
      return { success: true, record };
    });

    // ====================================================
    // M4.5: Agent ID 链上身份（agent.soul + 自动分配钱包）
    // ====================================================

    // 9.1 注册新 Agent 身份 POST /v1/agents/register
    this.app.post('/v1/agents/register', async (request: FastifyRequest<{
      Body: {
        name: string;
        role?: any;
        mode?: 'PLATFORM_AUTODERIVE' | 'ARC_EVM_BINDING';
        solanaAddress?: string;
        evmAddress?: string;
      };
    }>, reply: FastifyReply) => {
      try {
        const identity = this.agentRegistry.register({
          name: request.body?.name,
          role: request.body?.role,
          mode: request.body?.mode,
          solanaAddress: request.body?.solanaAddress,
          evmAddress: request.body?.evmAddress,
        });

        // 广播到 Zero-UI 思考流，让看板实时可见
        this.eventBus.emit('AGENT_EVENT', {
          type: 'AGENT_REGISTERED',
          soulDomain: identity.soulDomain,
          agent: identity.solanaAddress,
          passportPda: identity.passportPda,
          note: `[AgentID] ${identity.soulDomain} registered with auto-assigned wallet ${identity.solanaAddress.slice(0, 8)}...`,
          timestamp: Date.now(),
        });

        return {
          success: true,
          identity,
          message: `Agent ID ${identity.soulDomain} created. Wallet auto-assigned.`,
        };
      } catch (err: any) {
        return reply.status(400).send({ error: err.message });
      }
    });

    // 9.2 查询单个 Agent 身份 GET /v1/agents/:domain
    this.app.get('/v1/agents/:domain', async (request: FastifyRequest<{
      Params: { domain: string };
    }>, reply: FastifyReply) => {
      const identity = this.agentRegistry.resolve(request.params.domain);
      if (!identity) {
        return reply.status(404).send({ error: 'Agent identity not found' });
      }
      return { success: true, identity };
    });

    // 9.3 列出全部 Agent 身份 GET /v1/agents
    this.app.get('/v1/agents', async (request: FastifyRequest<{
      Querystring: { limit?: string; status?: string };
    }>, reply: FastifyReply) => {
      const limit = request.query.limit ? parseInt(request.query.limit, 10) : 50;
      const agents = this.agentRegistry.list({
        limit,
        status: request.query.status as any,
      });
      return { success: true, total: agents.length, stats: this.agentRegistry.stats(), agents };
    });

    // 9.4 撤销 Agent 身份 POST /v1/agents/:domain/revoke
    this.app.post('/v1/agents/:domain/revoke', async (request: FastifyRequest<{
      Params: { domain: string };
    }>, reply: FastifyReply) => {
      try {
        const identity = this.agentRegistry.revoke(request.params.domain);
        return { success: true, identity };
      } catch (err: any) {
        return reply.status(404).send({ error: err.message });
      }
    });



    // ====================================================
    // M4.6: 协议收益台账（盈利透明可审计）
    // ====================================================

    // 9.5 收益汇总 GET /v1/economy/revenue
    this.app.get('/v1/economy/revenue', async (_request: FastifyRequest, reply: FastifyReply) => {
      return {
        success: true,
        summary: this.revenueLedger.summary(),
        recentEntries: this.revenueLedger.recent(20),
        settlementBatches: this.revenueLedger.settlementBatches().slice(0, 10),
      };
    });

    // 9.6 生成结算批次 POST /v1/economy/settle
    this.app.post('/v1/economy/settle', async (_request: FastifyRequest, reply: FastifyReply) => {
      const batch = this.revenueLedger.createSettlementBatch();
      if (batch.amountSol <= 0) {
        return reply.status(400).send({ error: 'No pending revenue to settle', batch });
      }
      return {
        success: true,
        batch,
        message:
          batch.status === 'SKIPPED'
            ? '收款地址未配置（GANG_PROTOCOL_FEE_RECEIVER_SOLANA），本次仅记账不结算'
            : `待上链结算 ${batch.amountSol} SOL → ${batch.recipient}`,
      };
    });

    // 9.7 校验收款地址 GET /v1/economy/recipient
    this.app.get('/v1/economy/recipient', async (_request: FastifyRequest, reply: FastifyReply) => {
      const cfg = getProtocolRevenueConfig();
      const check = ProtocolRevenueLedger.validateRecipient(cfg.solanaBeneficiary);
      return {
        success: true,
        recipient: cfg.solanaBeneficiary,
        valid: check.ok,
        error: check.error,
        launchFeeSol: cfg.launchFeeSol,
        protocolFeeBps: cfg.protocolFeeBps,
      };
    });

    // 9. 聪明钱跟单与量化 Alpha 信号 GET /v1/signals/alpha (x402 保护)
    this.app.get('/v1/signals/alpha', async (request: FastifyRequest, reply: FastifyReply) => {
      const paymentNonce = request.headers['x-payment-nonce'] as string;
      const paymentSig = request.headers['x-payment-signature'] as string;

      // 若未提供支付凭证，返回标准 HTTP 402 Payment Required 并下发微支付 Invoice
      if (!paymentNonce || !paymentSig) {
        const invoice = this.x402Engine.createInvoice(0.001, 0.05); // 0.001 SOL 门票
        reply.header('X-Payment-Invoice', JSON.stringify(invoice));
        reply.header('WWW-Authenticate', `x402 recipient="${invoice.recipientVault}", amountSol=${invoice.amountSol}, nonce="${invoice.paymentNonce}"`);
        return reply.status(402).send({
          statusCode: 402,
          error: 'Payment Required',
          message: 'Access to alpha trading signals requires x402 on-chain micro-payment.',
          invoice,
        });
      }

      // 核验支付签名：链上模式走真实验款，内存模式保持向后兼容
      let verifyRes: { valid: boolean; error?: string; fact?: any };
      if (this.x402Engine.isOnChainMode()) {
        verifyRes = await this.x402Engine.verifyPaymentOnChain(paymentNonce, paymentSig);
      } else {
        verifyRes = this.x402Engine.verifyPayment(paymentNonce, paymentSig);
      }

      if (!verifyRes.valid) {
        return reply.status(402).send({
          statusCode: 402,
          error: 'Payment Verification Failed',
          message: verifyRes.error,
          verificationMode: this.x402Engine.isOnChainMode() ? 'onchain' : 'memory',
        });
      }

      // 支付成功，下发高价值 Alpha 信号
      const mockSignals: AlphaSignalData[] = [
        {
          mint: 'AxjF6yxyi6fCwjCjXJW2anXWbGgmvGkH4qN5x6guYQVE',
          symbol: 'MIND',
          signalType: 'BREAKOUT_MOMENTUM',
          confidenceScore: 0.94,
          smartMoneyInflowSol: 18.5,
          recommendedBuyRange: [0.000001, 0.000003],
          generatedAt: Date.now(),
        },
        {
          mint: 'GangDeSoUL888888888888888888888888888888888',
          symbol: 'DEGEN',
          signalType: 'WHALE_ACCUMULATION',
          confidenceScore: 0.88,
          smartMoneyInflowSol: 34.2,
          recommendedBuyRange: [0.000005, 0.000008],
          generatedAt: Date.now() - 15000,
        },
      ];

      return {
        success: true,
        authenticated: true,
        paymentSettled: true,
        signals: mockSignals,
        timestamp: Date.now(),
      };
    });
  }

  public async start(port = 3000, host = '0.0.0.0'): Promise<string> {
    const address = await this.app.listen({ port, host });
    return address;
  }

  public async stop(): Promise<void> {
    await this.app.close();
  }
}
