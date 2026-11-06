#!/usr/bin/env node
import { GangSoulMcpHandler } from '../mcp/server';

/**
 * GANG.SOUL M2M CLI 客户端
 * 提供 Agent 开发者和量化机器人快速交互命令行工具
 */

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  const handler = new GangSoulMcpHandler(process.env.GATEWAY_URL || 'http://127.0.0.1:3000');

  if (!command || command === 'help' || command === '--help') {
    console.log(`
⚡ GANG.SOUL M2M CLI Tool (Autonomous Agent Trading & Launchpad)
Usage:
  gang-cli launch <name> <symbol> <uri> [initialSol] [note]
  gang-cli buy <mint> <solAmount> <note> [agentIndex]
  gang-cli sell <mint> <tokenAmount> <note> [agentIndex]
  gang-cli query <mint>
  gang-cli status
    `);
    return;
  }

  try {
    switch (command) {
      case 'launch': {
        const [, name, symbol, uri, initialSol = '0', note = 'Agent CLI launch'] = args;
        if (!name || !symbol || !uri) {
          console.error('❌ Error: name, symbol, and uri are required');
          process.exit(1);
        }
        const res = await handler.executeTool('gang_launch_token', {
          name,
          symbol,
          uri,
          initialBuySol: parseFloat(initialSol),
          note,
        });
        console.log('🚀 Token Launched Successfully:');
        console.log(JSON.stringify(res, null, 2));
        break;
      }

      case 'buy': {
        const [, mint, solAmount, note, agentIndex = '0'] = args;
        if (!mint || !solAmount || !note) {
          console.error('❌ Error: mint, solAmount, and note are required');
          process.exit(1);
        }
        const res = await handler.executeTool('gang_swap_token', {
          mint,
          isBuy: true,
          solAmount: parseFloat(solAmount),
          note,
          agentIndex: parseInt(agentIndex, 10),
        });
        console.log('🛒 Buy Order Executed:');
        console.log(JSON.stringify(res, null, 2));
        break;
      }

      case 'sell': {
        const [, mint, tokenAmount, note, agentIndex = '0'] = args;
        if (!mint || !tokenAmount || !note) {
          console.error('❌ Error: mint, tokenAmount, and note are required');
          process.exit(1);
        }
        const res = await handler.executeTool('gang_swap_token', {
          mint,
          isBuy: false,
          tokenAmount: parseFloat(tokenAmount),
          note,
          agentIndex: parseInt(agentIndex, 10),
        });
        console.log('📉 Sell Order Executed:');
        console.log(JSON.stringify(res, null, 2));
        break;
      }

      case 'query': {
        const [, mint] = args;
        if (!mint) {
          console.error('❌ Error: mint address is required');
          process.exit(1);
        }
        const res = await handler.executeTool('gang_query_token', { mint });
        console.log('📊 Token State:');
        console.log(JSON.stringify(res, null, 2));
        break;
      }

      case 'status': {
        const res = await handler.executeTool('gang_get_cluster_status', {});
        console.log('🛡️ Cluster & Gateway Health:');
        console.log(JSON.stringify(res, null, 2));
        break;
      }

      default:
        console.error(`Unknown command: ${command}`);
        process.exit(1);
    }
  } catch (err: any) {
    console.error('❌ CLI Execution Failed:', err.message);
    process.exit(1);
  }
}

main();
