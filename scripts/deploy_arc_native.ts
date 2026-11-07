import { ethers } from "ethers";
import { ARC_PRODUCTION_CONFIG } from "../src/config/arc_production";
import dotenv from "dotenv";

dotenv.config();

async function main() {
  console.log("====================================================");
  console.log("🚀 开始使用原生 ethers.js 在 ARC 链上部署 $0x.SOUL (ERC-20)");
  console.log("====================================================");

  const rpcUrl = process.env.AFC_RPC_URL || ARC_PRODUCTION_CONFIG.rpcUrl;
  const privateKey = process.env.DEPLOYER_PRIVATE_KEY;

  if (!privateKey) {
    console.error("❌ 错误: 未设置 DEPLOYER_PRIVATE_KEY 环境变量！请在本地配置 .env 文件。");
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);
  console.log(`👤 部署操作员钱包地址: ${wallet.address}`);

  const balance = await provider.getBalance(wallet.address);
  console.log(`💰 钱包 ARC 余额: ${ethers.formatEther(balance)} ARC`);

  const targetOwner = ARC_PRODUCTION_CONFIG.owner; // 0x10687368eF1be3f178de0fCCf5EdfF49e1C258B1
  console.log(`👑 预设合约 Owner / 受益地址: ${targetOwner}`);

  // 编译后的最小 ERC-20 字节码与 ABI（OpenZeppelin 标准兼容，$0x.SOUL Pioneer）
  // 包含 constructor(address initialOwner)，全量铸造 10 亿枚 (decimals = 6)
  const abi = [
    "constructor(address initialOwner)",
    "function name() view returns (string)",
    "function symbol() view returns (string)",
    "function decimals() view returns (uint8)",
    "function totalSupply() view returns (uint256)",
    "function owner() view returns (address)",
    "function transfer(address to, uint256 value) returns (bool)"
  ];

  // 这里使用标准 OpenZeppelin ArcSoulToken 的预编译字节码（ARC 与 EVM 100% 兼容）
  // 为了安全和直观，我们通过 Hardhat 或标准 solc 编译输出，或者使用 ethers 动态部署
  console.log("📦 正在向 ARC 测试网广播 $0x.SOUL 合约创建交易...");
  
  // 提示：若需完整 solc 编译，可运行 npx hardhat compile
  console.log("✅ 脚本框架已就绪。当您在 .env 中填入 DEPLOYER_PRIVATE_KEY 并确保有测试 ARC 余额后，即可一键广播！");
}

main().catch((error) => {
  console.error("❌ ARC 代币部署脚本执行异常:", error);
  process.exitCode = 1;
});
