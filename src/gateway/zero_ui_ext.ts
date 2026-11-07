import { renderZeroUi } from "./zero_ui";
import { ARC_PRODUCTION_CONFIG } from "../config/arc_production";

export function renderFullDashboard(targetSol: number = 50): string {
  let html = renderZeroUi(targetSol);
  
  // 在右侧面板或底部注入极客多链资产矩阵（含 ARC 主网 ERC-20 与 Solana 资产卡片）
  const multichainInject = `
    <div style="margin-top: 16px; background: rgba(0,229,255,0.03); border: 1px solid var(--accent-cyan); border-radius: 6px; padding: 12px;">
      <div style="font-size: 11px; font-weight: bold; color: var(--accent-cyan); margin-bottom: 8px; display: flex; justify-content: space-between;">
        <span>🌐 MULTI-CHAIN CONTRACT MATRIX</span>
        <span style="color: var(--accent-green);">ARC MAINNET & SOLANA</span>
      </div>
      <div style="font-size: 10px; color: #a0aec0; margin-bottom: 4px;">ARC Mainnet ERC-20 Token ($0x.SOUL):</div>
      <div style="background: #030407; padding: 6px; border-radius: 3px; font-size: 10px; color: #fff; word-break: break-all; border: 1px dashed var(--border); margin-bottom: 8px;">
        ${ARC_PRODUCTION_CONFIG.contracts.token}
      </div>
      <div style="font-size: 10px; color: #a0aec0; margin-bottom: 4px;">Solana SPL Genesis Mint:</div>
      <div style="background: #030407; padding: 6px; border-radius: 3px; font-size: 10px; color: #fff; word-break: break-all; border: 1px dashed var(--border);">
        GgZcyZ8A2wWxULFPfjJ6deUMqmoN1QDpLnZVGkBkiVcL
      </div>
    </div>
  `;

  // 将多链合约卡片注入到左侧面板底部
  html = html.replace('<!-- 左侧：代币与联合曲线状态 -->', multichainInject + '\n    <!-- 左侧：代币与联合曲线状态 -->');
  return html;
}
