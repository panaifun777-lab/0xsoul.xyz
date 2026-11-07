import { ZERO_UI_HTML } from "./zero_ui";
import { ARC_PRODUCTION_CONFIG } from "../config/arc_production";

/**
 * 动态将 ARC 主网 EVM 合约地址注入到前端 Zero-UI 首页 HTML 模板中
 */
export function getRenderedDashboardHtml(): string {
  const evmAddress = ARC_PRODUCTION_CONFIG.contracts.token;
  const solanaMint = "GgZcyZ8A2wWxULFPfjJ6deUMqmoN1QDpLnZVGkBkiVcL";

  let html = ZERO_UI_HTML;

  // 如果 HTML 中预留了 evm-contract 占位，直接替换
  html = html.replace(
    /<div class="contract-hash" id="evm-contract">[^<]*<\/div>/g,
    `<div class="contract-hash" id="evm-contract">${evmAddress}</div>`
  );

  // 同时也确保如果在其他卡片中，也能通过全局正则精准注入
  if (!html.includes(evmAddress)) {
    const cardInject = `
          <div class="contract-card">
            <h4>🟢 ARC Mainnet (EVM)</h4>
            <div style="font-size: 0.8rem; color: #cbd5e1;">$0x.SOUL Native ERC-20 Token</div>
            <div class="contract-hash" id="evm-contract">${evmAddress}</div>
            <button class="copy-btn" onclick="copyToClipboard('${evmAddress}', this)">COPY EVM ADDRESS</button>
            <div style="clear: both;"></div>
          </div>
    `;
    html = html.replace('<div class="contract-grid">', '<div class="contract-grid">\n' + cardInject);
  }

  return html;
}
