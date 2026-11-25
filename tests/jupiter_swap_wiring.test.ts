import { strict as assert } from 'assert';
import { GangSoulMcpServer, type TradePreviewResponse } from '../src/mcp/server';

async function runTests() {
  console.log('=== Running Jupiter swap MCP wiring tests ===');

  const preview: TradePreviewResponse = {
    requestId: 'req_swap_wiring',
    mint: 'So11111111111111111111111111111111111111112',
    isBuy: true,
    solAmount: 0.1,
    tokenAmount: 1000000,
    estimatedPriceSol: 0.0000001,
    slippagePct: 1,
    jitoTipSol: 0,
    note: 'wiring-test',
    agentIndex: 0,
    expiresAt: Date.now() + 60000,
    riskEvaluation: { allowed: true, capUsagePct: 0 },
    liveSwap: {
      unsignedHex: '0100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001',
      mint: 'So11111111111111111111111111111111111111112',
      minOut: '995000',
      outAmount: '1000000',
      inputAmount: '100000000',
      programs: [],
      quote: {},
    },
  };

  const server = new GangSoulMcpServer();
  let calls = 0;
  server.setLiveSwapSigner(async (req) => {
    calls++;
    assert.equal(req.unsignedHex, preview.liveSwap!.unsignedHex);
    assert.equal(req.minOut, '995000');
    assert.equal(req.solAmount, 0.1);
    return { ok: true, status: 'SUBMITTED', activityId: 'act_swap_wiring' };
  });

  const out = await (server as any).getExecutor()(preview);
  assert.equal(calls, 1, 'live swap signer must be called exactly once');
  assert.equal(out.status, 'SUBMITTED');
  assert.equal(out.result.execution, 'turnkey-jupiter-swap');
  assert.equal(out.result.txSignature, '', 'must not fabricate a txid before broadcast');
  assert.equal(out.result.minOut, '995000');

  let deniedCalls = 0;
  const server2 = new GangSoulMcpServer();
  server2.setLiveSwapSigner(async () => {
    deniedCalls++;
    return { ok: false, status: 'FAILED', reason: 'DENY_IMPLICIT' };
  });
  const out2 = await (server2 as any).getExecutor()(preview);
  assert.equal(deniedCalls, 1);
  assert.equal(out2.status, 'FAILED');
  assert.equal(out2.result.txSignature, '');
  assert.ok(String(out2.result.reason).includes('DENY_IMPLICIT'));

  const server3 = new GangSoulMcpServer();
  const out3 = await (server3 as any).getExecutor()(preview);
  assert.equal(out3.result.dataSource, 'seed', 'without signer, must fall back to mock and label seed');

  console.log('=== Jupiter swap MCP wiring tests passed ===');
}

runTests().catch((e) => { console.error(e); process.exit(1); });
