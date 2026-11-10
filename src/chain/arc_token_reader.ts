/**
 * ARC 链上 ERC-20 代币读取器（ARC Token On-Chain Reader）
 *
 * 读取 ARC 主网（EVM chainId 5042）上 $0x.SOUL 代币合约的真实链上数据：
 *   totalSupply() / decimals() / name() / symbol()
 * 用于把面板上的「总供应量」从硬编码的规划值，替换为链上真实已铸造量。
 *
 * 设计要点（对齐 src/chain/bonding_curve_reader.ts 的容错风格）：
 * - 直接复用 src/config/arc_production.ts 的 rpcUrl 与 token 地址；
 * - 任何失败（RPC 不可达 / 合约未部署 / 调用超时 / 异常）都安全回退到
 *   规划种子值（TOTAL_SUPPLY_TOKENS = 1,073,000,000）并标注 source:'seed'，
 *   绝不抛错、绝不阻塞请求；
 * - 链上读取成功缓存 30s，回退 5s 后重试；
 * - 真实总量用 ethers.formatUnits 换算（避免大数 / 小数精度丢失，
 *   例如当前合约仅铸造 0.001 枚也能量化展示，而非被 bigint 整除抹成 0）。
 */

import { ethers } from "ethers";
import { ARC_PRODUCTION_CONFIG } from "../config/arc_production";
import { TOTAL_SUPPLY_TOKENS } from "../config/tokenomics";

const ERC20_ABI = [
  "function totalSupply() view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function name() view returns (string)",
  "function symbol() view returns (string)",
];

export interface ArcTokenState {
  /** 数据来源：onchain=链上真实读取；seed=读取失败回退规划值 */
  source: "onchain" | "seed";
  contractAddress: string;
  chainId: number;
  name: string;
  symbol: string;
  decimals: number;
  /** 链上原始 totalSupply（wei 字符串，避免大数精度丢失） */
  totalSupplyRaw: string;
  /** 折算后的真实代币总量（human units，Number，便于前端渲染） */
  totalSupplyTokens: number;
  /** 折算后的真实代币总量（字符串，保留小数精度，如 "0.001" / "1073000000"） */
  totalSupplyFormatted: string;
  /** 规划总量（代币经济白皮书口径，1,073,000,000） */
  plannedTotalSupplyTokens: number;
  /** 回退原因（仅 seed 时存在） */
  fallbackReason?: string;
}

const PLANNED_TOTAL_SUPPLY = TOTAL_SUPPLY_TOKENS;

export function initialSeedArcState(): ArcTokenState {
  return seedArcState("init");
}

function seedArcState(fallbackReason: string): ArcTokenState {
  return {
    source: "seed",
    contractAddress: ARC_PRODUCTION_CONFIG.contracts.token,
    chainId: ARC_PRODUCTION_CONFIG.chainId,
    name: "0x.SOUL",
    symbol: "GSOUL",
    decimals: 18,
    totalSupplyRaw: "",
    totalSupplyTokens: PLANNED_TOTAL_SUPPLY,
    totalSupplyFormatted: PLANNED_TOTAL_SUPPLY.toLocaleString("en-US"),
    plannedTotalSupplyTokens: PLANNED_TOTAL_SUPPLY,
    fallbackReason,
  };
}

/**
 * 从 ARC 链上读取 $0x.SOUL 代币合约的真实状态。
 *
 * @param rpcUrl       ARC RPC（默认 ARC_PRODUCTION_CONFIG.rpcUrl）
 * @param tokenAddress 代币合约地址（默认 ARC_PRODUCTION_CONFIG.contracts.token）
 * @param timeoutMs    单次读取超时，默认 5000ms
 */
export async function readArcTokenOnChain(opts?: {
  rpcUrl?: string;
  tokenAddress?: string;
  timeoutMs?: number;
}): Promise<ArcTokenState> {
  const rpcUrl = opts?.rpcUrl || ARC_PRODUCTION_CONFIG.rpcUrl;
  const tokenAddress = opts?.tokenAddress || ARC_PRODUCTION_CONFIG.contracts.token;
  const timeoutMs = opts?.timeoutMs || 5000;

  let provider: ethers.JsonRpcProvider;
  try {
    provider = new ethers.JsonRpcProvider(
      rpcUrl,
      ARC_PRODUCTION_CONFIG.chainId,
      { staticNetwork: true },
    );
  } catch (e: any) {
    return seedArcState(`RPC 初始化失败: ${String(e?.message || e).slice(0, 90)}`);
  }

  const contract = new ethers.Contract(tokenAddress, ERC20_ABI, provider);

  const withTimeout = <T>(p: Promise<T>, label: string): Promise<T> =>
    Promise.race([
      p,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error(`${label} 超时`)), timeoutMs),
      ),
    ]);

  try {
    const [raw, dec, name, symbol] = await Promise.all([
      withTimeout(contract.totalSupply() as Promise<bigint>, "totalSupply"),
      withTimeout(contract.decimals() as Promise<number>, "decimals"),
      withTimeout(contract.name() as Promise<string>, "name"),
      withTimeout(contract.symbol() as Promise<string>, "symbol"),
    ]);

    const decimals = Number(dec);
    const totalSupplyRaw = (raw as bigint).toString();
    const totalSupplyFormatted = ethers.formatUnits(raw as bigint, decimals);
    const totalSupplyTokens = Number(totalSupplyFormatted);

    return {
      source: "onchain",
      contractAddress: tokenAddress,
      chainId: ARC_PRODUCTION_CONFIG.chainId,
      name: String(name),
      symbol: String(symbol),
      decimals,
      totalSupplyRaw,
      totalSupplyTokens,
      totalSupplyFormatted,
      plannedTotalSupplyTokens: PLANNED_TOTAL_SUPPLY,
    };
  } catch (e: any) {
    return seedArcState(`${String(e?.message || e).slice(0, 120)}`);
  }
}
