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

// Configuration for simulation
const INITIAL_SUPPLY = ethers.utils.parseEther("10000000"); // 10 million tokens
const LP_AMOUNT = ethers.utils.parseEther("100000");       // Initial liquidity 
const FLASH_LOAN_FEE = 9;                                  // 0.09% flash loan fee

async function main() {
  console.log("Starting simulation deployment...");
  
  // Get signers
  const [deployer, user1, user2] = await ethers.getSigners();
  console.log(`Deployer address: ${deployer.address}`);
  
  // Deploy mock tokens
  console.log("\nDeploying mock tokens...");
  const MockERC20 = await ethers.getContractFactory("MockERC20");
  
  const weth = await MockERC20.deploy("Wrapped Ether", "WETH", INITIAL_SUPPLY);
  await weth.deployed();
  console.log(`Mock WETH deployed to: ${weth.address}`);
  
  const dai = await MockERC20.deploy("Dai Stablecoin", "DAI", INITIAL_SUPPLY);
  await dai.deployed();
  console.log(`Mock DAI deployed to: ${dai.address}`);
  
  const usdc = await MockERC20.deploy("USD Coin", "USDC", INITIAL_SUPPLY);
  await usdc.deployed();
  console.log(`Mock USDC deployed to: ${usdc.address}`);
  
  // Deploy mock lending pool for flash loans
  console.log("\nDeploying mock lending pool...");
  const MockLendingPool = await ethers.getContractFactory("MockLendingPool");
  const lendingPool = await MockLendingPool.deploy(FLASH_LOAN_FEE);
  await lendingPool.deployed();
  console.log(`Mock Lending Pool deployed to: ${lendingPool.address}`);
  
  // Deploy mock Uniswap V2 router
  console.log("\nDeploying mock Uniswap V2 router...");
  const MockRouter = await ethers.getContractFactory("MockRouter");
  const uniswapV2Router = await MockRouter.deploy("Uniswap V2");
  await uniswapV2Router.deployed();
  console.log(`Mock Uniswap V2 Router deployed to: ${uniswapV2Router.address}`);
  
  // Deploy mock Uniswap V3 router
  console.log("\nDeploying mock Uniswap V3 router...");
  const MockUniswapV3Router = await ethers.getContractFactory("MockUniswapV3Router");
  const uniswapV3Router = await MockUniswapV3Router.deploy("Uniswap V3");
  await uniswapV3Router.deployed();
  console.log(`Mock Uniswap V3 Router deployed to: ${uniswapV3Router.address}`);
  
  // Deploy FlashloanArb contract
  console.log("\nDeploying FlashloanArb contract...");
  const MIN_PROFIT_AMOUNT = ethers.utils.parseEther("0.1"); // 0.1 ETH min profit
  
  // Use fully qualified name to avoid ambiguity
  const FlashloanArb = await ethers.getContractFactory("contracts/FlashloanArb.sol:FlashloanArb");
  const flashloanArb = await FlashloanArb.deploy(
    lendingPool.address,
    uniswapV2Router.address,
    uniswapV3Router.address,
    MIN_PROFIT_AMOUNT
  );
  await flashloanArb.deployed();
  console.log(`FlashloanArb deployed to: ${flashloanArb.address}`);
  
  // Set up exchange rates with price differences to create arbitrage opportunities
  console.log("\nSetting up exchange rates between DEXes...");
  
  // Exchange rates in Uniswap V2 (base rates)
  // 1 ETH = 2000 DAI
  // 1 ETH = 2000 USDC
  // 1 DAI = 1 USDC
  await uniswapV2Router.setExchangeRate(
    weth.address,
    dai.address,
    ethers.utils.parseEther("2000")
  );
  
  await uniswapV2Router.setExchangeRate(
    weth.address,
    usdc.address,
    ethers.utils.parseEther("2000")
  );
  
  await uniswapV2Router.setExchangeRate(
    dai.address,
    usdc.address,
    ethers.utils.parseEther("1")
  );
  
  // Exchange rates in Uniswap V3 (higher difference to create larger arbitrage opportunities)
  // 1 ETH = 2300 DAI (+15%)
  // 1 ETH = 1700 USDC (-15%)
  // 1 DAI = 0.85 USDC (-15%)
  await uniswapV3Router.setExchangeRate(
    weth.address,
    dai.address,
    3000, // 0.3% fee tier
    ethers.utils.parseEther("2300")
  );
  
  await uniswapV3Router.setExchangeRate(
    weth.address,
    usdc.address,
    3000, // 0.3% fee tier
    ethers.utils.parseEther("1700")
  );
  
  await uniswapV3Router.setExchangeRate(
    dai.address,
    usdc.address,
    3000, // 0.3% fee tier
    ethers.utils.parseEther("0.85")
  );
  
  // Also set up the 0.05% and 1% fee tiers for V3 with slightly different prices
  await uniswapV3Router.setExchangeRate(
    weth.address,
    dai.address,
    500, // 0.05% fee tier
    ethers.utils.parseEther("2050")
  );
  
  await uniswapV3Router.setExchangeRate(
    weth.address,
    dai.address,
    10000, // 1% fee tier
    ethers.utils.parseEther("2150")
  );
  
  // Provide tokens to the lending pool for flash loans - use smaller amounts to avoid balance errors
  console.log("\nProviding liquidity to lending pool for flash loans...");
  await weth.transfer(lendingPool.address, ethers.utils.parseEther("100"));
  await dai.transfer(lendingPool.address, ethers.utils.parseEther("200000"));
  await usdc.transfer(lendingPool.address, ethers.utils.parseEther("200000"));
  
  // Provide tokens to the routers for swaps - use smaller amounts to avoid balance errors
  console.log("\nProviding liquidity to DEX routers...");
  await weth.transfer(uniswapV2Router.address, ethers.utils.parseEther("100"));
  await dai.transfer(uniswapV2Router.address, ethers.utils.parseEther("200000"));
  await usdc.transfer(uniswapV2Router.address, ethers.utils.parseEther("200000"));
  
  await weth.transfer(uniswapV3Router.address, ethers.utils.parseEther("100"));
  await dai.transfer(uniswapV3Router.address, ethers.utils.parseEther("200000"));
  await usdc.transfer(uniswapV3Router.address, ethers.utils.parseEther("200000"));
  
  // Transfer some tokens to the arbitrage contract for testing
  console.log("\nProviding initial tokens to the arbitrage contract...");
  await weth.transfer(flashloanArb.address, ethers.utils.parseEther("1"));
  await dai.transfer(flashloanArb.address, ethers.utils.parseEther("2000"));
  await usdc.transfer(flashloanArb.address, ethers.utils.parseEther("2000"));
  
  // Set flashloan receiver in the lending pool
  await lendingPool.setFlashloanReceiver(flashloanArb.address);
  
  console.log("\nSimulation environment setup complete!");
  console.log("\nDeployed contracts:");
  console.log(`- WETH: ${weth.address}`);
  console.log(`- DAI: ${dai.address}`);
  console.log(`- USDC: ${usdc.address}`);
  console.log(`- Lending Pool: ${lendingPool.address}`);
  console.log(`- Uniswap V2 Router: ${uniswapV2Router.address}`);
  console.log(`- Uniswap V3 Router: ${uniswapV3Router.address}`);
  console.log(`- FlashloanArb: ${flashloanArb.address}`);
  
  // Save deployment information to a file for the arbitrage script
  console.log("\nSaving deployment information to simulation-config.json");
  const fs = require("fs");
  const deploymentInfo = {
    weth: weth.address,
    dai: dai.address,
    usdc: usdc.address,
    lendingPool: lendingPool.address,
    uniswapV2Router: uniswapV2Router.address,
    uniswapV3Router: uniswapV3Router.address,
    flashloanArb: flashloanArb.address,
    networkId: (await ethers.provider.getNetwork()).chainId,
  };
  
  fs.writeFileSync(
    "simulation-config.json",
    JSON.stringify(deploymentInfo, null, 2)
  );
  
  console.log("\nYou can now run the arbitrage scanner with:");
  console.log("npm run arb:scan:local");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
