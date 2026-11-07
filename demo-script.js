import { ethers } from "ethers";
import dotenv from "dotenv";

dotenv.config();

async function main() {
  console.log("====================================================");
  console.log("⚡ 启动 Alchemy Ethereum Mainnet RPC 演示脚本");
  console.log("====================================================");

  const apiKey = process.env.ALCHEMY_API_KEY;
  if (!apiKey) {
    console.error("❌ 错误: 未检测到 ALCHEMY_API_KEY 环境变量！请确保已在本地 .env 文件中配置 ALCHEMY_API_KEY=<my-key>");
    process.exit(1);
  }

  // 1. 拼接 Alchemy RPC 端点
  const rpcUrl = `https://eth-mainnet.g.alchemy.com/v2/${apiKey}`;
  const provider = new ethers.JsonRpcProvider(rpcUrl);

  try {
    // 2. 调用 JSON-RPC 节点接口获取最新区块高度 (eth_blockNumber)
    const blockNumber = await provider.getBlockNumber();
    console.log(`📦 当前 Ethereum Mainnet 最新区块高度 (Block Number): ${blockNumber}`);

    // 3. 查询指定的知名以太坊地址余额 (例如以太坊基金会地址)
    const vitalikAddress = "0xd8dA6BF26964aF9D7eEd9e03E53415d37aA96045";
    const balance = await provider.getBalance(vitalikAddress);
    console.log(`💰 查询 Vitalik 地址 (${vitalikAddress}) 余额: ${ethers.formatEther(balance)} ETH`);

    // 4. 获取当前 Gas Price (eth_gasPrice)
    const feeData = await provider.getFeeData();
    console.log(`⛽ 当前网络平均 Gas Price: ${ethers.formatUnits(feeData.gasPrice || 0n, "gwei")} Gwei`);

    console.log("====================================================");
    console.log("✅ Alchemy RPC 连通性测试与演示执行成功！");
    console.log("====================================================");
  } catch (error) {
    console.error("❌ Alchemy RPC 调用异常:", error);
  }
}

main();
