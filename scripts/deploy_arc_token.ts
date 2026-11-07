import { ethers } from "hardhat";
import { ARC_PRODUCTION_CONFIG } from "./src/config/arc_production";

async function main() {
  console.log("====================================================");
  console.log("🚀 开始在 ARC 公链 (Chain ID: 5042) 上部署 $0x.SOUL (ERC-20)");
  console.log("====================================================");

  // 严格锁死您的协议受益与 Owner 地址
  const targetOwner = ARC_PRODUCTION_CONFIG.owner; // 0x10687368eF1be3f178de0fCCf5EdfF49e1C258B1
  console.log(`👑 预设合约 Owner / 受益地址: ${targetOwner}`);

  const [deployer] = await ethers.getSigners();
  console.log(`👤 部署操作员钱包地址: ${deployer.address}`);
  
  const balance = await deployer.provider.getBalance(deployer.address);
  console.log(`💰 部署钱包 ARC 余额: ${ethers.formatEther(balance)} ARC`);

  const ArcSoulToken = await ethers.getContractFactory("ArcSoulToken");
  console.log("📦 正在向 ARC 链提交合约创建交易...");

  const token = await ArcSoulToken.deploy(targetOwner);
  await token.waitForDeployment();

  const deployedAddress = await token.getAddress();
  console.log("====================================================");
  console.log(`🎉 $0x.SOUL (ERC-20) 成功部署在 ARC 链！`);
  console.log(`📍 合约地址: ${deployedAddress}`);
  console.log(`👑 合约所有者 (Owner): ${await token.owner()}`);
  console.log(`💰 初始总供应量: ${ethers.formatUnits(await token.totalSupply(), 6)} 0x.SOUL`);
  console.log("====================================================");
}

main().catch((error) => {
  console.error("❌ ARC 代币部署失败:", error);
  process.exitCode = 1;
});
