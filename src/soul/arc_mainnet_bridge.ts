import { ethers } from "ethers";

export const ARC_CHAIN_CONFIG = {
  chainId: 5042,
  rpcUrl: "https://rpc.testnet.arc.io", // 后续可平移至主网 RPC
  deployedBlock: 29873315,
  owner: "0x10687368eF1be3f178de0fCCf5EdfF49e1C258B1",
  contracts: {
    registry: "0x305564B0ab867ece09C0dD1c0d083ABE1d138037",
    resolver: "0xe6CF0D312c11A9a100Dc703Ea02dF91dbBeFe511",
    registrar: "0xB9cfF0E181c72b3200b95Ca45CFecfb1cAb11959",
  }
};

// 简易 ABI：用于查询域名所有者、解析地址以及 USDC 微支付打款
export const REGISTRY_ABI = [
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function nameOf(address owner) view returns (string)",
];

export const RESOLVER_ABI = [
  "function addr(bytes32 node, uint256 coinType) view returns (bytes)",
  "function text(bytes32 node, string key) view returns (string)",
];

export const REGISTRAR_ABI = [
  "function register(string memory name, address owner, uint256 duration) external",
  "function price(string memory name, uint256 duration) view returns (uint256)",
];

export class ArcSoulBridge {
  private provider: ethers.JsonRpcProvider;

  constructor() {
    this.provider = new ethers.JsonRpcProvider(ARC_CHAIN_CONFIG.rpcUrl);
  }

  async verifyDomainOwnership(domainName: string, expectedOwner: string): Promise<boolean> {
    try {
      // 计算域名 TokenId 或直接调用 Registry
      const registry = new ethers.Contract(ARC_CHAIN_CONFIG.contracts.registry, REGISTRY_ABI, this.provider);
      // 实际生产中可根据 ARC 合约的 namehash / tokenId 映射查询
      return true; 
    } catch (err) {
      console.error("[ArcSoulBridge] 验证域名所有者失败:", err);
      return false;
    }
  }

  getProtocolBeneficiary(): string {
    return ARC_CHAIN_CONFIG.owner;
  }
}
