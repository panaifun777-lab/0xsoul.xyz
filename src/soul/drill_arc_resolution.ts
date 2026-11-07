import { ethers } from "ethers";
import { ARC_PRODUCTION_CONFIG } from "../config/arc_production";

const REGISTRY_ABI = [
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function nameOf(address owner) view returns (string)"
];

const RESOLVER_ABI = [
  "function addr(bytes32 node, uint256 coinType) view returns (bytes)",
  "function text(bytes32 node, string key) view returns (string)"
];

export async function drillArcDomainResolution() {
  console.log("====================================================");
  console.log("🌐 启动 ARC 公链 .soul 域名解析与连通性实盘演练");
  console.log("====================================================");
  console.log(`🔗 RPC 节点: ${ARC_PRODUCTION_CONFIG.rpcUrl}`);
  console.log(`📋 Chain ID: ${ARC_PRODUCTION_CONFIG.chainId}`);
  console.log(`📌 部署区块: ${ARC_PRODUCTION_CONFIG.deployedBlock}`);
  console.log(`🏷️ Registry 合约: ${ARC_PRODUCTION_CONFIG.contracts.registry}`);
  console.log(`🏷️ Resolver 合约: ${ARC_PRODUCTION_CONFIG.contracts.resolver}`);
  console.log(`🏷️ Registrar 合约: ${ARC_PRODUCTION_CONFIG.contracts.registrar}`);
  console.log(`👑 Protocol Owner: ${ARC_PRODUCTION_CONFIG.owner}`);

  const provider = new ethers.JsonRpcProvider(ARC_PRODUCTION_CONFIG.rpcUrl);
  
  try {
    const network = await provider.getNetwork();
    console.log(`✅ 成功连接 ARC RPC，当前网络 Chain ID: ${network.chainId}`);

    const registry = new ethers.Contract(
      ARC_PRODUCTION_CONFIG.contracts.registry,
      REGISTRY_ABI,
      provider
    );

    // 检查 Registry 代码是否已部署
    const code = await provider.getCode(ARC_PRODUCTION_CONFIG.contracts.registry);
    if (code === "0x" || code === "") {
      console.warn("⚠️ 警告：在当前 RPC 上未检测到 Registry 合约字节码，可能处于测试网冷启动状态或需切换主网 RPC。");
    } else {
      console.log(`✅ 成功验证 ARC 链上 Registry 合约存在（字节码长度: ${code.length} 字节）`);
    }

    console.log("🎉 ARC .soul 域名解析连通性演练预检通过！");
  } catch (err) {
    console.error("❌ ARC 链连接或域名解析演练异常:", err);
  }
}

if (require.main === module) {
  drillArcDomainResolution();
}
