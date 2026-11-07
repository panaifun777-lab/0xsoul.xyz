import { ARC_PRODUCTION_CONFIG } from "../config/arc_production";

export interface DomainPricingResult {
  domain: string;
  length: number;
  priceUsdc: number;
  priceUnits: string; // 6 decimals bigint string
  tier: string;
}

export class DomainPricingManager {
  /**
   * 根据域名计算阶梯定价 (纯纯标准算法，无需外部依赖，彻底杜绝容器启动模块未找到错误)
   */
  static calculatePrice(domainName: string): DomainPricingResult {
    const cleanName = domainName.toLowerCase().replace(/\.soul$/, "").trim();
    const len = cleanName.length;

    let priceUsdc = 0.99;
    let tier = "LONG_TAIL_6PLUS";

    if (len <= 4) {
      priceUsdc = 10.0;
      tier = "PREMIUM_SHORT_4MINUS";
    } else if (len === 5) {
      if (/^\d+$/.test(cleanName)) {
        priceUsdc = 2.0;
        tier = "NUMERIC_5DIGIT";
      } else {
        priceUsdc = 4.0;
        tier = "STANDARD_5CHAR";
      }
    } else {
      priceUsdc = 0.99;
      tier = "LONG_TAIL_6PLUS";
    }

    // 转换为 USDC 6位小数精度整数 (例如 4.0 -> 4000000)
    const priceUnits = Math.round(priceUsdc * 1_000_000).toString();

    return {
      domain: cleanName + ".soul",
      length: len,
      priceUsdc,
      priceUnits,
      tier,
    };
  }

  /**
   * 构造 ARC 链 Registrar 合约 register(string name, address owner, uint256 duration) 的 EVM 交易数据
   */
  static encodeRegisterTransaction(domainName: string, ownerAddress: string, durationSeconds: number = 31536000) {
    const cleanName = domainName.toLowerCase().replace(/\.soul$/, "").trim();
    const registrarAddress = ARC_PRODUCTION_CONFIG.contracts.registrar;
    
    // 手动编码函数选择器 signature: register(string,address,uint256) -> keccak256("register(string,address,uint256)").slice(0, 10) -> 0x446d0a79 (示例)
    // 这里采用标准简化版 calldata 构造或由网关返回结构化目标地址
    return {
      to: registrarAddress,
      domain: cleanName + ".soul",
      owner: ownerAddress,
      duration: durationSeconds,
      beneficiary: ARC_PRODUCTION_CONFIG.owner, // 0x10687368eF1be3f178de0fCCf5EdfF49e1C258B1
    };
  }
}
