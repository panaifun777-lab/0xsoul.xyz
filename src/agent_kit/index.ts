/**
 * @0xsoul/agent-kit — Autonomous AI Agent Toolkit for M2M Economy & x402 Micropayments
 * 
 * 允许任何外部 AI 智能体一键导入，实现：
 * 1. HTTP 402 微支付自动结算与 Alpha 信号获取
 * 2. 联合曲线代币交易两阶段确认 (Preview -> Execute)
 * 3. 币安 Agent ID 签名验证与身份桥接
 */

import axios from 'axios';
import { BinanceAgentIdBridge } from '../soul/binance_agent_id';

export interface AgentKitConfig {
  gatewayUrl: string;
  agentMnemonic?: string;
}

export class ZeroSoulAgentKit {
  private gatewayUrl: string;

  constructor(config: AgentKitConfig) {
    this.gatewayUrl = config.gatewayUrl.replace(/\/$/, '');
  }

  /**
     * 获取高阶 Alpha 信号（自动处理 HTTP 402 鉴权与微支付流程）
     */
  async getAlphaSignals(tier = 'PREMIUM_ALPHA_SNIPER', asset = 'SOL', paymentHandler?: (invoice: any) => Promise<{ nonce: string; signature: string }>) {
    try {
      const res = await axios.get(`${this.gatewayUrl}/v1/signals/alpha?tier=${tier}&asset=${asset}`);
      return {
        status: 200,
        data: res.data
      };
    } catch (err: any) {
      if (err.response && err.response.status === 402) {
        const invoice = err.response.data.invoice;
        if (!paymentHandler) {
          return {
            status: 402,
            invoice,
            error: 'Payment required. Provide paymentHandler callback to sign and pay invoice.'
          };
        }

        // 触发支付并重新请求
        const payment = await paymentHandler(invoice);
        const paidRes = await axios.get(`${this.gatewayUrl}/v1/signals/alpha?tier=${tier}&asset=${asset}`, {
          headers: {
            'x-payment-nonce': payment.nonce,
            'x-payment-signature': payment.signature
          }
        });

        return {
          status: 200,
          data: paidRes.data
        };
      }
      throw err;
    }
  }

  /**
     * 查询网关实时遥测与代币资产状态
     */
  async getTerminalState() {
    const res = await axios.get(`${this.gatewayUrl}/v1/terminal/state`);
    return res.data;
  }

  /**
     * 验证币安 Agent ID 签名
     */
  verifyBinanceAgentId(agentAddress: string, signature: string, payload: string): boolean {
    return BinanceAgentIdBridge.verifyBinanceAgentIdSignature(agentAddress, signature, payload);
  }

  /**
     * 获取 BSC 映射配置
     */
  getBscMapping() {
    return BinanceAgentIdBridge.getBscMappingConfig();
  }
}

export { BinanceAgentIdBridge };
