import { HardhatRuntimeEnvironment } from "hardhat/types";
import { HardhatEthersHelpers } from "@nomiclabs/hardhat-ethers/types";
import { BigNumber } from "ethers";

// This is a workaround for accessing ethers from hardhat
declare global {
  interface HardhatRuntimeEnvironment {
    ethers: HardhatEthersHelpers;
  }
}

// Import hardhat runtime
const hre = require("hardhat");
const ethers = hre.ethers;

async function main() {
  console.log("Starting deployment of FlashloanArb contract...");

  // Get network-specific addresses (for Goerli testnet)
  const AAVE_LENDING_POOL_ADDRESS = "0x368EedF3f56ad10b9bC57eed4Dac65B26Bb667f6"; // Goerli Aave v3 Pool
  const UNISWAP_ROUTER_ADDRESS = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D"; // Goerli Uniswap V2 Router
  const SUSHISWAP_ROUTER_ADDRESS = "0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506"; // Goerli Sushiswap Router
  
  // Minimum profit amount in token decimals (e.g., for DAI which has 18 decimals)
  // This is set to 10 DAI for example
  const MIN_PROFIT_AMOUNT = ethers.utils.parseUnits("10", 18);

  // Get the deployer's address
  const [deployer] = await ethers.getSigners();
  console.log(`Deploying contracts with account: ${deployer.address}`);
  console.log(`Account balance: ${(await deployer.getBalance()).toString()}`);

  // Deploy the contract
  const FlashloanArbFactory = await ethers.getContractFactory(
    "FlashloanArb",
    deployer
  );

  const flashloanArb = await FlashloanArbFactory.deploy(
    AAVE_LENDING_POOL_ADDRESS,
    UNISWAP_ROUTER_ADDRESS,
    SUSHISWAP_ROUTER_ADDRESS,
    MIN_PROFIT_AMOUNT
  );

  // Wait for deployment to complete
  await flashloanArb.deployed();

  console.log(`FlashloanArb contract deployed at: ${flashloanArb.address}`);
  console.log("Deployment completed successfully!");

  // Log contract configuration for verification
  console.log("\nContract Configuration:");
  console.log(`- Aave Lending Pool: ${AAVE_LENDING_POOL_ADDRESS}`);
  console.log(`- Uniswap Router (DEX A): ${UNISWAP_ROUTER_ADDRESS}`);
  console.log(`- Sushiswap Router (DEX B): ${SUSHISWAP_ROUTER_ADDRESS}`);
  console.log(`- Minimum Profit Amount: ${ethers.utils.formatUnits(MIN_PROFIT_AMOUNT, 18)} ETH`);
  
  console.log("\nVerify the contract on Etherscan with:");
  console.log(`npx hardhat verify --network goerli ${flashloanArb.address} ${AAVE_LENDING_POOL_ADDRESS} ${UNISWAP_ROUTER_ADDRESS} ${SUSHISWAP_ROUTER_ADDRESS} ${MIN_PROFIT_AMOUNT}`);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
