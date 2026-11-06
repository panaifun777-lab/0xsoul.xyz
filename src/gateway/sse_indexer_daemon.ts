import Fastify, { FastifyRequest, FastifyReply } from "fastify";
import { Connection, PublicKey } from "@solana/web3.js";
import { EventParser, BorshCoder, Idl } from "@coral-xyz/anchor";
import { ServerResponse } from "http";

const PORT = Number(process.env.PORT || 3001);
const RPC_HTTP_URL = process.env.SOLANA_RPC_HTTP || "https://api.mainnet-beta.solana.com";
const RPC_WSS_URL = process.env.SOLANA_RPC_WSS || "wss://api.mainnet-beta.solana.com";
const PROGRAM_ID = new PublicKey(process.env.GANG_PROGRAM_ID || "GangLaunchpad111111111111111111111111111111");
const TARGET_SOL = 50; // 50 SOL 满标毕业线

import idl from "./idl/gsoul_bonding_curve.json";

const fastify = Fastify({ logger: true });

interface StreamPayload {
  id: string;
  type: "AGENT_TRADE" | "GRADUATED" | "SYSTEM_STATUS";
  data: any;
  timestamp: number;
}

const sseClients = new Set<ServerResponse>();
const recentEventsBuffer: StreamPayload[] = [];
const MAX_BUFFER_SIZE = 50;

function pushToBufferAndBroadcast(payload: StreamPayload) {
  recentEventsBuffer.push(payload);
  if (recentEventsBuffer.length > MAX_BUFFER_SIZE) {
    recentEventsBuffer.shift();
  }

  const sseFrame = `id: ${payload.id}\nevent: ${payload.type}\ndata: ${JSON.stringify(payload.data)}\n\n`;

  for (const client of sseClients) {
    if (!client.writableEnded) {
      client.write(sseFrame);
    } else {
      sseClients.delete(client);
    }
  }
}

// 15 秒心跳保活帧，彻底防止 Nginx/Cloudflare 掐断连接
setInterval(() => {
  const heartbeatFrame = `: ping ${Date.now()}\n\n`;
  for (const client of sseClients) {
    if (!client.writableEnded) {
      client.write(heartbeatFrame);
    } else {
      sseClients.delete(client);
    }
  }
}, 15_000);

class SolanaLogStreamer {
  private connection!: Connection;
  private subscriptionId: number | null = null;
  private eventParser: EventParser;
  private reconnectAttempts = 0;

  constructor(idlData: Idl) {
    const coder = new BorshCoder(idlData);
    this.eventParser = new EventParser(PROGRAM_ID, coder);
    this.initConnection();
  }

  private initConnection() {
    this.connection = new Connection(RPC_HTTP_URL, {
      wsEndpoint: RPC_WSS_URL,
      commitment: "processed",
    });
    this.subscribeLogs();
  }

  private subscribeLogs() {
    try {
      fastify.log.info(`[Solana WSS] 正在订阅 0x.SOUL 合约日志: ${PROGRAM_ID.toBase58()}`);

      this.subscriptionId = this.connection.onLogs(
        PROGRAM_ID,
        (logs, ctx) => {
          if (logs.err) return;
          this.reconnectAttempts = 0;

          const parsedEvents = this.eventParser.parseLogs(logs.logs);

          for (const event of parsedEvents) {
            if (event.name === "AgentTradeEvent") {
              const d = event.data as any;
              const currentReserveSol = Number(d.realSolReserves) / 1e9;
              const progressPct = Math.min(100, (currentReserveSol / TARGET_SOL) * 100);

              pushToBufferAndBroadcast({
                id: `${logs.signature}-trade`,
                type: "AGENT_TRADE",
                timestamp: Date.now(),
                data: {
                  signature: logs.signature,
                  slot: ctx.slot,
                  agent: d.agent.toBase58(),
                  soulDomain: d.soulDomain || "anon.soul",
                  side: d.isBuy ? "BUY" : "SELL",
                  solAmount: (Number(d.solAmount) / 1e9).toFixed(4),
                  tokenAmount: (Number(d.tokenAmount) / 1e6).toFixed(2),
                  curveReservesSol: currentReserveSol.toFixed(2),
                  progressPct: progressPct.toFixed(1),
                  note: d.thoughtNote,
                },
              });
            } else if (event.name === "CurveGraduatedEvent") {
              const d = event.data as any;
              pushToBufferAndBroadcast({
                id: `${logs.signature}-grad`,
                type: "GRADUATED",
                timestamp: Date.now(),
                data: {
                  signature: logs.signature,
                  mint: d.mint.toBase58(),
                  raydiumPool: d.raydiumPool.toBase58(),
                  burnedLpAmount: d.burnedLpAmount.toString(),
                  progressPct: "100.0",
                  message: "50 SOL 0x.SOUL BONDING CURVE GRADUATED! RAYDIUM CPMM POOL INITIALIZED & LP PERMANENTLY BURNED.",
                },
              });
            }
          }
        },
        "processed"
      );
    } catch (err) {
      fastify.log.error(err, "[Solana WSS] 订阅异常，准备指数退避重连...");
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect() {
    this.reconnectAttempts++;
    const delay = Math.min(30_000, 1000 * Math.pow(2, this.reconnectAttempts));
    setTimeout(() => {
      if (this.subscriptionId !== null) {
        this.connection.removeOnLogsListener(this.subscriptionId).catch(() => {});
      }
      this.initConnection();
    }, delay);
  }
}

fastify.get("/api/stream/0xsoul", (request: FastifyRequest, reply: FastifyReply) => {
  const raw = reply.raw;

  raw.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
    "Access-Control-Allow-Origin": "*",
  });

  request.raw.socket.setNoDelay(true);
  request.raw.socket.setKeepAlive(true);

  raw.write(`retry: 3000\n`);
  raw.write(
    `event: SYSTEM_STATUS\ndata: ${JSON.stringify({
      status: "CONNECTED",
      service: "0xsoul.xyz Real-time SSE Indexer",
      onlineClients: sseClients.size + 1,
    })}\n\n`
  );

  if (recentEventsBuffer.length > 0) {
    raw.write(
      `event: HISTORY_SNAPSHOT\ndata: ${JSON.stringify(recentEventsBuffer)}\n\n`
    );
  }

  sseClients.add(raw);

  request.raw.on("close", () => {
    sseClients.delete(raw);
    raw.end();
  });
});

const startServer = async () => {
  try {
    // 尝试初始化日志流监听器（若未打包 IDL 则降级运行网关 SSE 广播）
    try {
      new SolanaLogStreamer(idl as unknown as Idl);
    } catch (e) {
      fastify.log.warn("[Solana WSS] IDL 加载跳过，启动模拟心跳与量化广播模式。");
    }

    await fastify.listen({ port: PORT, host: "0.0.0.0" });
    fastify.log.info(`🚀 0x.SOUL SSE 实时推流网关已启动: http://0.0.0.0:${PORT}/api/stream/0xsoul`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

startServer();
