import { ZERO_UI_HTML } from "./zero_ui";
import { ARC_PRODUCTION_CONFIG } from "../config/arc_production";

export class GangSoulGateway {
  private fastify = null;

  async start() {
    // 已在 server.ts 中实现
  }
}

/**
 * 0x.SOUL 生产网关主入口 (Fastify M2M + Zero-UI Terminal + 多链资产矩阵)
 */
export function injectEvmAddressIntoHtml(baseHtml: string): string {
  const evmAddress = ARC_PRODUCTION_CONFIG.contracts.token;
  const solanaMint = "GgZcyZ8A2wWxULFPfjJ6deUMqmoN1QDpLnZVGkBkiVcL";

  // 在 HTML 模板中注入真实的 EVM 代币地址与 Solana Mint
  const injectedCardHtml = `
          <div class="contract-card">
            <h4>🟢 ARC Mainnet (EVM)</h4>
            <div style="font-size: 0.8rem; color: #cbd5e1;">$0x.SOUL Native ERC-20 Token</div>
            <div class="contract-hash" id="evm-contract">${evmAddress}</div>
            <button class="copy-btn" onclick="copyToClipboard('${evmAddress}', this)">COPY EVM ADDRESS</button>
            <div style="clear: both;"></div>
          </div>
  `;

  // 替换原有占位或在多链面板中直接注入
  let modified = baseHtml;
  if (!modified.includes(evmAddress)) {
    modified = modified.replace(
      '<div class="contract-grid">',
      '<div class="contract-grid">\n' + injectedCardHtml
    );
  }
  return modified;
}
