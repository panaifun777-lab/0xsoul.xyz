import { ethers } from "ethers";
import solc from "solc";
import fs from "fs";

async function main() {
  console.log("====================================================");
  console.log("🚀 开始在 ARC 公链 (Chain ID: 5042) 上部署 $0x.SOUL (ERC-20)");
  console.log("====================================================");

  const rpcUrl = "https://rpc.testnet.arc.io";
  const privateKey = "9608d47aeb452f26bff12d6f93dbcfb2b29b5396703bfc1e12c7487b89d35a91";

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);
  console.log(`👤 部署操作员钱包地址: ${wallet.address}`);

  const balance = await provider.getBalance(wallet.address);
  console.log(`💰 钱包 ARC 余额: ${ethers.formatEther(balance)} ARC`);

  const sourceCode = fs.readFileSync("contracts/ArcSoulToken.sol", "utf8");

  const input = {
    language: "Solidity",
    sources: {
      "ArcSoulToken.sol": { content: sourceCode },
    },
    settings: {
      outputSelection: {
        "*": {
          "*": ["abi", "evm.bytecode"],
        },
      },
    },
  };

  function findImports(importPath: string) {
    if (importPath.startsWith("@openzeppelin/")) {
      const realPath = "node_modules/" + importPath;
      return { contents: fs.readFileSync(realPath, "utf8") };
    }
    return { error: "File not found" };
  }

  console.log("📦 正在编译 ArcSoulToken.sol...");
  const output = JSON.parse(solc.compile(JSON.stringify(input), { import: findImports }));
  
  if (output.errors) {
    output.errors.forEach((err: any) => console.log(err.formattedMessage));
    if (output.errors.some((e: any) => e.severity === "error")) {
      throw new Error("编译失败");
    }
  }

  const contractFile = output.contracts["ArcSoulToken.sol"]["ArcSoulToken"];
  const abi = contractFile.abi;
  const bytecode = contractFile.evm.bytecode.object;

  console.log("🚀 编译成功！正在向 ARC 测试网广播合约创建交易...");
  const factory = new ethers.ContractFactory(abi, bytecode, wallet);
  const initialOwner = "0x10687368eF1be3f178de0fCCf5EdfF49e1C258B1";
  
  const contract = await factory.deploy(initialOwner);
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  console.log("====================================================");
  console.log("🎉 $0x.SOUL (ERC-20) 成功部署在 ARC 测试网！");
  console.log("📍 合约地址:", address);
  console.log("👑 合约 Owner:", await contract.owner());
  console.log("====================================================");
}

main().catch((err) => {
  console.error("❌ 部署异常:", err);
  process.exit(1);
});
