import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";

dotenv.config();

const ARC_RPC = process.env.AFC_RPC_URL || "https://rpc.testnet.arc.io";
const DEPLOYER_PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY || "0000000000000000000000000000000000000000000000000000000000000000";

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  networks: {
    arc: {
      url: ARC_RPC,
      chainId: 5042,
      accounts: [DEPLOYER_PRIVATE_KEY],
    },
  },
};

export default config;
