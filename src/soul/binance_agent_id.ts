import { ethers } from "ethers";
import { ARC_PRODUCTION_CONFIG } from "../config/arc_production";

/**
 * 0x.SOUL 币安 Agent ID 与 BNB Chain (BSC) 资产映射桥接器
 * 职责：
 * 1. 验证币安 Agent ID 签名并与 .soul 域名绑定。
 * 2. 提供 BNB Smart Chain (BSC) BEP-20 映射资产参数。
 */
export class BinanceAgentIdBridge {
  static getBscMappingConfig() {
    return {
      chainId: 56, // BNB Smart Chain Mainnet
      name: "0x.SOUL Pioneer (BSC Mapped)",
      symbol: "0x.SOUL",
      decimals: 6,
      totalSupply: "1,000,000,000",
      protocolBeneficiary: ARC_PRODUCTION_CONFIG.owner, // 0x10687368eF1be3f178de0fCCf5EdfF49e1C258B1
      pancakeswapPairTarget: "WBNB / 0x.SOUL"
    };
  }

  static verifyBinanceAgentIdSignature(agentAddress: string, signature: string, payload: string): boolean {
    try {
      const recoveredAddress = ethers.verifyMessage(payload, signature);
      return recoveredAddress.toLowerCase() === agentAddress.toLowerCase();
    } catch (err) {
      console.error("[BinanceAgentIdBridge] 验证签名失败:", err);
      return false;
    }
  }
}
