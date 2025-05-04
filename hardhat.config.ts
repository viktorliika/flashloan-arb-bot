const { HardhatUserConfig } = require("hardhat/config");
require("@nomiclabs/hardhat-ethers");
require("@nomiclabs/hardhat-waffle");
require("@nomicfoundation/hardhat-verify");
require("hardhat-gas-reporter");
const dotenv = require("dotenv");

// Load environment variables from .env file
dotenv.config();

const config = {
  solidity: {
    version: "0.8.20",
    settings: { 
      optimizer: { 
        enabled: true, 
        runs: 200,
        details: {
          yul: true,
          yulDetails: {
            stackAllocation: true,
            optimizerSteps: "dhfoDgvulfnTUtnIf"
          }
        }
      },
      viaIR: true  // Enable viaIR with better optimizer settings
    }
  },
  networks: {
    localhost: {
      url: "http://127.0.0.1:8545/",
      chainId: 1,  // Changed from 31337 to match forked mainnet chain ID
      gasPrice: "auto",
      gas: 6000000,
      // Set higher gas settings to handle forked mainnet
      accounts: {
        mnemonic: "test test test test test test test test test test test junk",
        path: "m/44'/60'/0'/0",
        initialIndex: 0,
        count: 20
      }
    },
    hardhat: {
      forking: {
        url: process.env.MAINNET_RPC_URL || "",
        blockNumber: 18800000, // Optional: fork from a specific block number
      },
      chainId: 1, // Use mainnet's chain ID to ensure compatibility
      gas: 12000000, // Set higher gas limit
      gasPrice: "auto",
      blockGasLimit: 30000000, // Increased block gas limit
      // Set hardfork to latest
      hardfork: "shanghai",
      mining: {
        auto: true,
        interval: 0
      }
    },
    goerli: {
      url: process.env.GOERLI_RPC_URL || "",
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : []
    }
  },
  etherscan: {
    apiKey: process.env.ETHERSCAN_API_KEY
  },
  gasReporter: {
    enabled: true,
    currency: "USD",
  }
};
module.exports = config;
