/**
 * 0x.SOUL Production MCP (Model Context Protocol) Server
 * 参照 TMTN 与 gang.fun 行业标准打造的生产级 stdio / SDK 双模 MCP 服务器
 * 
 * 核心特性：
 * 1. 严格的两阶段交易安全规范 (Preview -> Two-Phase Confirm -> Execute)
 * 2. 智能体资产与持仓盈亏看板 (gang_portfolio / gang_status)
 * 3. 链上思考流 (Notes) 检索与基于 SRS 声誉的一键跟单 (gang_notes / gang_follow)
 * 4. 法律级风控硬顶硬约束 (1.5 SOL 沙盒限额与 1% 持仓硬顶)
 * 5. 标准 JSON-RPC 2.0 stdio 通信协议支持，无缝对接 Claude Code, Cursor, Reasonix
 */

import { randomUUID } from 'crypto';
import { TOTAL_SUPPLY_TOKENS, MAX_WALLET_CAP_TOKENS } from '../config/tokenomics';
import { getGraduationTargetSol } from '../config/graduation';
import { RemoteMcpFederation, RemoteMcpUpstream } from './remote_federation';
import {
  ConfirmationService,
  OwnerEd25519Approver,
  AcceptAllApprover,
  type Executor,
  type ConfirmAction,
} from './confirmation';

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties: Record<string, any>;
    required: string[];
  };
}

export interface TradePreviewRequest {
  mint: string;
  isBuy: boolean;
  solAmount?: number;
  tokenAmount?: number;
  slippagePct?: number;
  note?: string;
  agentIndex?: number;
}

export interface TradePreviewResponse {
  requestId: string;
  mint: string;
  isBuy: boolean;
  solAmount: number;
  tokenAmount: number;
  estimatedPriceSol: number;
  slippagePct: number;
  jitoTipSol: number;
  note: string;
  agentIndex: number;
  expiresAt: number;
  riskEvaluation: {
    allowed: boolean;
    reason?: string;
    capUsagePct: number;
  };
}

export interface TradeExecutionResult {
  txSignature: string;
  status: 'CONFIRMED' | 'FAILED';
  mint: string;
  isBuy: boolean;
  solAmount: number;
  tokenAmount: number;
  latencyMs: number;
  note: string;
  timestamp: number;
}

export interface AgentPortfolioItem {
  mint: string;
  symbol: string;
  tokenBalance: number;
  averageBuyPriceSol: number;
  currentPriceSol: number;
  costBasisSol: number;
  currentValueSol: number;
  unrealizedPnLSol: number;
  unrealizedPnLPct: number;
  capHoldingPct: number; // 占总供应量百分比
}

export const GANG_SOUL_PRODUCTION_MCP_TOOLS: McpToolDefinition[] = [
  {
    name: 'gang_tokens',
    description: '获取 0x.SOUL 内盘最新发射、即将毕业 (~85 SOL) 或热门的 Agent Meme 代币列表',
    inputSchema: {
      type: 'object',
      properties: {
        filter: {
          type: 'string',
          enum: ['hot', 'new', 'near_grad', 'all'],
          description: '代币列表过滤维度 (默认 hot)',
        },
        limit: { type: 'number', description: '返回数量上限 (默认 10)' },
      },
      required: [],
    },
  },
  {
    name: 'gang_info',
    description: '查询特定代币的联合曲线进度、当前公允价格、85 SOL 毕业状态与持仓分布',
    inputSchema: {
      type: 'object',
      properties: {
        mint: { type: 'string', description: '代币的 Solana Mint 公钥' },
      },
      required: ['mint'],
    },
  },
  {
    name: 'gang_preview',
    description: '【两阶段交易第一阶段】报价与风控预审。生成 60s 有效期的 requestId，返回精确滑点、Jito 小费与 1% 硬顶评估。不下单。',
    inputSchema: {
      type: 'object',
      properties: {
        mint: { type: 'string', description: '目标代币 Solana Mint 公钥' },
        isBuy: { type: 'boolean', description: 'true 为买入，false 为卖出' },
        solAmount: { type: 'number', description: '买入的 SOL 数量 (<= 1.5 SOL 硬顶)' },
        tokenAmount: { type: 'number', description: '卖出的代币数量' },
        slippagePct: { type: 'number', description: '容忍滑点百分比 (默认 1.0%)' },
        note: { type: 'string', description: '链上思考理由 (强制 <= 140 字符，广播到共识流)' },
        agentIndex: { type: 'number', description: '操作的 Agent 钱包索引 (默认 0)' },
      },
      required: ['mint', 'isBuy', 'note'],
    },
  },
  {
    name: 'gang_execute',
    description: '【两阶段交易第二阶段】携带 gang_preview 生成的 requestId 提交上链执行。附带 Jito MEV 捆绑与毫秒级延迟追踪。',
    inputSchema: {
      type: 'object',
      properties: {
        requestId: { type: 'string', description: '由 gang_preview 返回的有效 requestId' },
      },
      required: ['requestId'],
    },
  },
  {
    name: 'gang_portfolio',
    description: '查询当前智能体钱包持仓快照、成本基准、未实现/已实现盈亏 (PnL) 与 1% 持仓比例',
    inputSchema: {
      type: 'object',
      properties: {
        agentIndex: { type: 'number', description: '智能体钱包索引 (默认 0)' },
      },
      required: [],
    },
  },
  {
    name: 'gang_notes',
    description: '查询其他 AI 智能体在链上广播的交易思考流 (--note)、置信度与最新市场动态',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: '查询条数 (默认 10)' },
        mint: { type: 'string', description: '可选，按特定代币过滤' },
      },
      required: [],
    },
  },
  {
    name: 'gang_follow',
    description: '对高声誉巨鲸智能体的链上交易进行一键跟随，生成跟单 preview (受 1.5 SOL 限额约束)',
    inputSchema: {
      type: 'object',
      properties: {
        targetNoteTx: { type: 'string', description: '目标巨鲸交易的签名或 Note 标识' },
        followAmountSol: { type: 'number', description: '跟随买入金额 (默认 0.1 SOL)' },
        agentIndex: { type: 'number', description: '跟随执行的智能体索引 (默认 1)' },
      },
      required: ['targetNoteTx'],
    },
  },
  {
    name: 'gang_launch',
    description: '在 0x.SOUL 联合曲线上发射全新的 Agent Meme 代币，写入元数据并绑定初始流动性',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '代币名称' },
        symbol: { type: 'string', description: '代币符号' },
        uri: { type: 'string', description: 'IPFS / Arweave 元数据 URI' },
        initialBuySol: { type: 'number', description: '创世买入 SOL 金额 (<= 1.5 SOL)' },
        note: { type: 'string', description: '创世理念说明 (<= 140 字符)' },
      },
      required: ['name', 'symbol', 'uri'],
    },
  },
  {
    name: 'gang_approve',
    description:
      '【手机确认锁】对一笔待确认意图（PENDING_CONFIRMATION）用确认私钥签名批准。签名须覆盖 challenge（预览哈希|requestId|过期时刻）。强确认档需 secondFactor 二次复核。超时或拒绝=不成交。',
    inputSchema: {
      type: 'object',
      properties: {
        requestId: { type: 'string', description: 'gang_execute 返回的待确认 requestId' },
        signature: { type: 'string', description: '对 challenge 的 ed25519 签名（base64）' },
        secondFactor: { type: 'string', description: '强确认档的二次复核凭证（如生物识别令牌）' },
      },
      required: ['requestId', 'signature'],
    },
  },
  {
    name: 'gang_confirm_status',
    description: '查询确认锁待确认队列状态：不传 requestId 返回全部待确认；传入则返回该意图的状态 / 档位 / 过期时刻',
    inputSchema: {
      type: 'object',
      properties: {
        requestId: { type: 'string', description: '可选，查询单个意图' },
      },
      required: [],
    },
  },
];

/**
 * 生产级 MCP 服务器核心实现
 */
export class GangSoulMcpServer {
  private gatewayBaseUrl: string;
  private federation: RemoteMcpFederation = new RemoteMcpFederation([]);
  private confirmation: ConfirmationService;
  private pendingPreviews: Map<string, TradePreviewResponse> = new Map();
  private mockPortfolios: Map<number, AgentPortfolioItem[]> = new Map();
  private mockNotes: Array<{
    tx: string;
    agentName: string;
    mint: string;
    action: 'BUY' | 'SELL';
    amountSol: number;
    note: string;
    srsScore: number;
    timestamp: number;
  }> = [];

  constructor(gatewayBaseUrl = 'http://127.0.0.1:3000') {
    this.gatewayBaseUrl = gatewayBaseUrl;
    this.initMockNotesAndPortfolios();
    this.initFederation();
    this.confirmation = this.buildConfirmation();
  }

  /**
   * 构建确认锁服务。审批走可插拔 Approver：
   *  - 配置了 CONFIRM_OWNER_PUBKEY（owner 确认公钥 base64）→ OwnerEd25519Approver（v1 正式路径）；
   *  - CONFIRM_TEST_MODE=1 → AcceptAllApprover（仅测试/演示，生产禁止）；
   *  - 都不配 → approver 为 null，需确认的意图 fail-closed 拒绝（PDF：沉默=拒绝，不自动放行）。
   */
  private buildConfirmation(): ConfirmationService {
    const svc = new ConfirmationService();
    const pub = process.env.CONFIRM_OWNER_PUBKEY;
    if (pub) {
      try {
        svc.setApprover(new OwnerEd25519Approver(pub));
      } catch (e: any) {
        console.warn('[confirmation] CONFIRM_OWNER_PUBKEY 无效，确认面 fail-closed:', e?.message);
      }
    } else if (process.env.CONFIRM_TEST_MODE === '1') {
      console.warn('[confirmation] CONFIRM_TEST_MODE=1：AcceptAllApprover，生产禁止！');
      svc.setApprover(new AcceptAllApprover());
    } else {
      console.warn('[confirmation] 未配置 CONFIRM_OWNER_PUBKEY：需确认的意图将 fail-closed 拒绝。');
    }
    return svc;
  }

  /** 暴露确认锁服务（网关 kill switch 联动用）。 */
  get confirmationService(): ConfirmationService {
    return this.confirmation;
  }

  /**
   * 执行回调（v1 为 mock 执行：更新模拟持仓并生成模拟 txid）。
   * 真实 live_executor 后续以同一 Executor 接口接入，确认锁逻辑无需改动。
   */
  private getExecutor(): Executor {
    return (preview: TradePreviewResponse) => {
      const startTime = Date.now();
      let holdings = this.mockPortfolios.get(preview.agentIndex) || [];
      let existing = holdings.find((h) => h.mint === preview.mint);
      if (!existing) {
        existing = {
          mint: preview.mint,
          symbol: 'GMEME',
          tokenBalance: 0,
          averageBuyPriceSol: preview.estimatedPriceSol,
          currentPriceSol: preview.estimatedPriceSol,
          costBasisSol: 0,
          currentValueSol: 0,
          unrealizedPnLSol: 0,
          unrealizedPnLPct: 0,
          capHoldingPct: 0,
        };
        holdings.push(existing);
      }
      if (preview.isBuy) {
        existing.tokenBalance += preview.tokenAmount;
        existing.costBasisSol += preview.solAmount;
        existing.currentPriceSol = preview.estimatedPriceSol;
        existing.currentValueSol = existing.tokenBalance * existing.currentPriceSol;
        existing.averageBuyPriceSol = existing.costBasisSol / existing.tokenBalance;
        existing.unrealizedPnLSol = existing.currentValueSol - existing.costBasisSol;
        existing.unrealizedPnLPct = (existing.unrealizedPnLSol / existing.costBasisSol) * 100;
        existing.capHoldingPct = (existing.tokenBalance / TOTAL_SUPPLY_TOKENS) * 100;
      } else {
        existing.tokenBalance = Math.max(0, existing.tokenBalance - preview.tokenAmount);
        existing.currentValueSol = existing.tokenBalance * existing.currentPriceSol;
        existing.capHoldingPct = (existing.tokenBalance / TOTAL_SUPPLY_TOKENS) * 100;
      }
      this.mockPortfolios.set(preview.agentIndex, holdings);
      const result: TradeExecutionResult = {
        txSignature: `5SolSig${Date.now()}LiveExecJitoBundledHash999999999`,
        status: 'CONFIRMED',
        mint: preview.mint,
        isBuy: preview.isBuy,
        solAmount: preview.solAmount,
        tokenAmount: preview.tokenAmount,
        latencyMs: Date.now() - startTime + 42,
        note: preview.note,
        timestamp: Date.now(),
      };
      return { status: 'CONFIRMED', result, txid: result.txSignature };
    };
  }

  /**
   * Config-gated federation of upstream remote MCP servers (e.g. MoonLauncher).
   * Disabled by default; enable with FEDERATE_REMOTE_MCP=1. REMOTE_MCP_SERVERS can
   * override the upstream list (JSON array of {id,url,prefix}); otherwise the
   * default MoonLauncher upstream (prefix `ml_`) is used. Failures are non-fatal:
   * the gateway keeps serving its own local tools.
   */
  private initFederation(): void {
    let upstreams: RemoteMcpUpstream[] = [];
    if (process.env.FEDERATE_REMOTE_MCP === '1' || process.env.FEDERATE_REMOTE_MCP === 'true') {
      const raw = process.env.REMOTE_MCP_SERVERS;
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) upstreams = parsed as RemoteMcpUpstream[];
        } catch {
          console.warn('[federation] REMOTE_MCP_SERVERS is not valid JSON; using default');
        }
      }
      if (upstreams.length === 0) {
        upstreams = [
          { id: 'moonlauncher', url: 'https://moonlauncher.app/mcp', prefix: 'ml_' },
        ];
      }
    }
    this.federation = new RemoteMcpFederation(upstreams);
    if (this.federation.isEnabled()) {
      this.refreshUpstreams().catch((e: any) =>
        console.warn(`[federation] initial refresh failed: ${e?.message ?? e}`),
      );
    }
  }

  /** Manually (re)fetch upstream tool/prompt catalogs. Safe to call anytime. */
  public async refreshUpstreams(): Promise<void> {
    await this.federation.refresh();
  }

  private initMockNotesAndPortfolios() {
    this.mockNotes.push(
      {
        tx: '5K3eNoteTxExampleMatrixAlpha111111111111111111111111111111111',
        agentName: 'matrix-quant-whale.soul',
        mint: 'GangMemeAlpha111111111111111111111111111111111',
        action: 'BUY',
        amountSol: 1.2,
        note: 'High sentiment momentum confirmed via x402 signal feed. Accumulating before 85 SOL graduation.',
        srsScore: 9200,
        timestamp: Date.now() - 120_000,
      },
      {
        tx: '4M9xNoteTxExampleDeepAlpha222222222222222222222222222222222',
        agentName: 'deep-alpha.soul',
        mint: 'GangMemeAlpha111111111111111111111111111111111',
        action: 'BUY',
        amountSol: 0.8,
        note: 'Hold Line defense triggered around 3e-8 SOL. Consensus floor secured.',
        srsScore: 8850,
        timestamp: Date.now() - 45_000,
      }
    );

    this.mockPortfolios.set(0, [
      {
        mint: 'GangMemeAlpha111111111111111111111111111111111',
        symbol: 'GMEME',
        tokenBalance: 4_500_000,
        averageBuyPriceSol: 0.000000032,
        currentPriceSol: 0.000000038,
        costBasisSol: 0.144,
        currentValueSol: 0.171,
        unrealizedPnLSol: 0.027,
        unrealizedPnLPct: 18.75,
        capHoldingPct: 0.45, // 0.45% (< 1% 限制)
      },
    ]);
  }

  public listTools(): McpToolDefinition[] {
    const local = GANG_SOUL_PRODUCTION_MCP_TOOLS;
    const upstream = this.federation.getTools();
    return [...local, ...upstream] as McpToolDefinition[];
  }

  public async executeTool(name: string, args: any): Promise<any> {
    // Federated upstream tool (namespaced with the upstream prefix, e.g. ml_start_launch).
    if (this.federation.isEnabled() && this.federation.prefixOf(name)) {
      return await this.federation.callTool(name, args);
    }
    switch (name) {
      case 'gang_tokens': {
        const filter = args.filter || 'hot';
        const limit = args.limit || 10;
        return {
          filter,
          total: 1,
          tokens: [
            {
              mint: 'GangMemeAlpha111111111111111111111111111111111',
              name: 'Gang Soul Alpha',
              symbol: 'GMEME',
              creator: 'matrix-quant-whale.soul',
              marketCapSol: 38.0,
              graduationProgressPct: 76.0, // 38 / 50 SOL (STANDARD 毕业目标)
              holders: 16,
              volume24hSol: 125.4,
              priceSol: 0.000000038,
              isGraduated: false,
            },
          ].slice(0, limit),
        };
      }

      case 'gang_info': {
        return {
          mint: args.mint,
          name: 'Gang Soul Alpha',
          symbol: 'GMEME',
          bondingCurveSupply: 800_000_000,
          currentPriceSol: 0.000000038,
          solReserve: 38.0,
          graduationTargetSol: getGraduationTargetSol(),
          graduationProgressPct: 76.0,
          isGraduated: false,
          raydiumAmmId: null,
          maxWalletHoldingCap: MAX_WALLET_CAP_TOKENS, // 总供应 1%
          rule: 'Agent-only. Max 1.5 SOL per tx. Max 1% holding per agent passport.',
        };
      }

      case 'gang_preview': {
        // 第一阶段两阶段确认：风控验证与报价计算
        const isBuy = Boolean(args.isBuy);
        const solAmount = args.solAmount || 0;
        const tokenAmount = args.tokenAmount || 0;
        const slippagePct = args.slippagePct ?? 1.0;
        const note = (args.note || '').slice(0, 140);
        const agentIndex = args.agentIndex ?? 0;

        // 1.5 SOL 硬顶风控
        if (isBuy && solAmount > 1.5) {
          return {
            error: 'RISK_VIOLATION',
            message: `[风控拦截] 单笔交易投入金额 ${solAmount} SOL 超过硬编码沙盒上限 1.5 SOL`,
            allowed: false,
          };
        }

        const priceSol = 0.000000038;
        const estimatedTokens = isBuy ? Math.floor(solAmount / priceSol) : tokenAmount;
        const estimatedSol = isBuy ? solAmount : Number((tokenAmount * priceSol).toFixed(4));

        // 1% 持仓硬顶风控评估
        const currentHoldings = (this.mockPortfolios.get(agentIndex) || []).find((p) => p.mint === args.mint);
        const currentBalance = currentHoldings ? currentHoldings.tokenBalance : 0;
        const postTradeBalance = isBuy ? currentBalance + estimatedTokens : currentBalance - estimatedTokens;
        const postCapPct = (postTradeBalance / TOTAL_SUPPLY_TOKENS) * 100;

        if (isBuy && postTradeBalance > MAX_WALLET_CAP_TOKENS) {
          return {
            error: 'CAP_EXCEEDED',
            message: `[风控拦截] 交易后持仓 ${postTradeBalance} 枚超过 1% 法律级硬顶 (${MAX_WALLET_CAP_TOKENS} 枚)`,
            allowed: false,
            currentCapPct: (currentBalance / TOTAL_SUPPLY_TOKENS) * 100,
          };
        }

        const requestId = `req_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
        const preview: TradePreviewResponse = {
          requestId,
          mint: args.mint,
          isBuy,
          solAmount: estimatedSol,
          tokenAmount: estimatedTokens,
          estimatedPriceSol: priceSol,
          slippagePct,
          jitoTipSol: 0.001,
          note,
          agentIndex,
          expiresAt: Date.now() + 60_000, // 60s 有效
          riskEvaluation: {
            allowed: true,
            capUsagePct: Number(postCapPct.toFixed(2)),
          },
        };

        this.pendingPreviews.set(requestId, preview);

        // 确认锁：计算预览哈希 + 三档分级，让调用方知道是否需要手机确认
        const previewHash = this.confirmation.computePreviewHash(preview);
        const tier = this.confirmation.classify(preview, preview.isBuy ? 'buy' : 'sell');

        return {
          status: 'PREVIEW_GENERATED',
          instruction: '请核对以下参数；如需确认将返回 challenge，调用 gang_approve 带签名批准。',
          preview,
          previewHash,
          tier,
          confirmRequired: tier !== 'EXEMPT',
        };
      }

      case 'gang_execute': {
        // 第二阶段：提交执行意图，由确认锁状态机决定直行或进待确认队列
        const preview = this.pendingPreviews.get(args.requestId);
        if (!preview) {
          throw new Error(`[执行失败] 无效或未找到 requestId: ${args.requestId}`);
        }
        if (Date.now() > preview.expiresAt) {
          this.pendingPreviews.delete(args.requestId);
          throw new Error(`[执行失败] 该报价已过期 (TTL 60s)，请重新调用 gang_preview 获取新报价`);
        }

        const action: ConfirmAction = preview.isBuy ? 'buy' : 'sell';
        const submit = await this.confirmation.submit(preview, action, this.getExecutor());

        if (submit.status === 'REJECTED') {
          this.pendingPreviews.delete(args.requestId);
          return { status: 'REJECTED', allowed: false, reason: submit.reason };
        }
        if (submit.status === 'EXEMPT') {
          // 免确认档：已直接执行
          this.pendingPreviews.delete(args.requestId);
          return {
            status: 'EXECUTION_CONFIRMED',
            result: submit.result,
            jitoBundleId: `jito_bundle_${Math.random().toString(36).substring(2, 10)}`,
          };
        }
        // PENDING：需手机确认
        return {
          status: 'PENDING_CONFIRMATION',
          requestId: preview.requestId,
          tier: submit.intent?.tier,
          previewHash: submit.intent?.previewHash,
          challenge: submit.challenge,
          expiresAt: submit.intent?.expiresAt,
          instruction:
            '本笔需手机确认：用确认私钥对 challenge（预览哈希|requestId|过期时刻）签名，调用 gang_approve(requestId, signature)。超时或拒绝=不成交。',
        };
      }

      case 'gang_approve': {
        const { requestId, signature, secondFactor } = args;
        if (!requestId || !signature) {
          throw new Error('gang_approve 需要 requestId 与 signature');
        }
        const res = await this.confirmation.approve(requestId, signature, this.getExecutor(), { secondFactor });
        if (!res.ok) {
          return { status: res.status, allowed: false, reason: res.reason };
        }
        return {
          status: 'EXECUTION_CONFIRMED',
          result: res.result,
          jitoBundleId: `jito_bundle_${Math.random().toString(36).substring(2, 10)}`,
        };
      }

      case 'gang_confirm_status': {
        const id = args.requestId;
        if (!id) {
          return { pending: this.confirmation.listPending() };
        }
        const intent = this.confirmation.getPending(id);
        return intent
          ? { requestId: id, status: intent.status, tier: intent.tier, expiresAt: intent.expiresAt }
          : { requestId: id, status: 'UNKNOWN' };
      }

      case 'gang_portfolio': {
        const agentIndex = args.agentIndex ?? 0;
        const items = this.mockPortfolios.get(agentIndex) || [];
        const totalValueSol = items.reduce((acc, cur) => acc + cur.currentValueSol, 0);
        const totalPnLSol = items.reduce((acc, cur) => acc + cur.unrealizedPnLSol, 0);

        return {
          agentIndex,
          totalValueSol: Number(totalValueSol.toFixed(4)),
          totalPnLSol: Number(totalPnLSol.toFixed(4)),
          solUsdRate: 210.0,
          totalValueUsd: Number((totalValueSol * 210.0).toFixed(2)),
          holdings: items,
        };
      }

      case 'gang_notes': {
        const limit = args.limit || 10;
        let notes = this.mockNotes;
        if (args.mint) {
          notes = notes.filter((n) => n.mint === args.mint);
        }
        return {
          total: notes.length,
          notes: notes.slice(0, limit),
        };
      }

      case 'gang_follow': {
        const note = this.mockNotes.find((n) => n.tx === args.targetNoteTx);
        if (!note) {
          throw new Error(`未找到目标 Note 交易记录: ${args.targetNoteTx}`);
        }
        if (note.srsScore < 8000) {
          return {
            error: 'SRS_SCORE_TOO_LOW',
            message: `目标智能体 ${note.agentName} 的 SRS 评分仅为 ${note.srsScore}，低于 8,000 巨鲸门槛，拒绝跟单`,
            allowed: false,
          };
        }

        const followAmountSol = Math.min(1.5, args.followAmountSol || 0.1);
        const agentIndex = args.agentIndex ?? 1;

        // 生成跟单 preview
        return await this.executeTool('gang_preview', {
          mint: note.mint,
          isBuy: note.action === 'BUY',
          solAmount: followAmountSol,
          note: `[Follow ${note.agentName}] Co-trade inspired by tx ${note.tx.substring(0, 8)}`,
          agentIndex,
        });
      }

      case 'gang_launch': {
        if (args.initialBuySol && args.initialBuySol > 1.5) {
          throw new Error(`创世买入金额 ${args.initialBuySol} SOL 超过 1.5 SOL 沙盒限额`);
        }
        return {
          status: 'LAUNCH_SUBMITTED',
          mint: `GangMeme${Date.now()}NewCreatedToken11111111111`,
          name: args.name,
          symbol: args.symbol,
          uri: args.uri,
          initialBuySol: args.initialBuySol || 0,
          bondingCurveSupply: 1_000_000_000,
          note: (args.note || '').slice(0, 140),
          jitoAttached: true,
          txSignature: `5LaunchSig${Date.now()}GenesisAlphaHash8888888888`,
        };
      }

      default:
        throw new Error(`未知的 MCP Tool 名称: ${name}`);
    }
  }

  /**
   * 启动标准 stdio JSON-RPC 2.0 监听器 (对接 Claude Code, Cursor 等外部智能体进程)
   */
  public startStdioServer() {
    process.stdin.setEncoding('utf-8');
    let buffer = '';

    process.stdin.on('data', async (chunk: string) => {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const req = JSON.parse(line);
          const response = await this.handleJsonRpc(req);
          process.stdout.write(JSON.stringify(response) + '\n');
        } catch (err: any) {
          process.stdout.write(
            JSON.stringify({
              jsonrpc: '2.0',
              id: null,
              error: { code: -32700, message: `Parse error: ${err.message}` },
            }) + '\n'
          );
        }
      }
    });
  }

  public async handleJsonRpc(req: any): Promise<any> {
    const { id, method, params } = req;
    if (method === 'tools/list') {
      return {
        jsonrpc: '2.0',
        id,
        result: { tools: this.listTools() },
      };
    }

    if (method === 'prompts/list') {
      if (!this.federation.isEnabled()) {
        return { jsonrpc: '2.0', id, result: { prompts: [] } };
      }
      return {
        jsonrpc: '2.0',
        id,
        result: { prompts: this.federation.getPrompts() },
      };
    }

    if (method === 'prompts/get') {
      if (!this.federation.isEnabled()) {
        return { jsonrpc: '2.0', id, error: { code: -32601, message: 'No prompts available' } };
      }
      try {
        const { name, arguments: args } = params;
        const result = await this.federation.getPrompt(name, args);
        return { jsonrpc: '2.0', id, result };
      } catch (err: any) {
        return { jsonrpc: '2.0', id, error: { code: -32603, message: err.message } };
      }
    }

    if (method === 'tools/call') {
      try {
        const { name, arguments: args } = params;
        const result = await this.executeTool(name, args);
        // Upstream (federated) tools already return { content: [...] }; pass through
        // to avoid double-wrapping. Local tools return plain objects -> wrap as text.
        const finalResult =
          result && Array.isArray((result as any).content)
            ? result
            : { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        return { jsonrpc: '2.0', id, result: finalResult };
      } catch (err: any) {
        return {
          jsonrpc: '2.0',
          id,
          error: { code: -32603, message: err.message },
        };
      }
    }

    return {
      jsonrpc: '2.0',
      id,
      error: { code: -32601, message: `Method not found: ${method}` },
    };
  }
}

// 保持对早期模块与 CLI 调用的向后兼容别名
export { GangSoulMcpServer as GangSoulMcpHandler };
export { GANG_SOUL_PRODUCTION_MCP_TOOLS as GANG_SOUL_MCP_TOOLS };

