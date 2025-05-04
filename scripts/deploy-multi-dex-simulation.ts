import { HardhatRuntimeEnvironment } from "hardhat/types";
import { HardhatEthersHelpers } from "@nomiclabs/hardhat-ethers/types";
import { BigNumber } from "ethers";
import fs from "fs";
import path from "path";

// This is a workaround for accessing ethers from hardhat
declare global {
  interface HardhatRuntimeEnvironment {
    ethers: HardhatEthersHelpers;
  }
}

// Import hardhat runtime
const hre = require("hardhat");
const ethers = hre.ethers;

/**
 * Deploy a multi-DEX environment for testing the MultiDexArbitrageur contract
 * 
 * This script sets up a complete test environment with mock tokens, mock DEXes,
 * and the MultiDexArbitrageur contract for testing.
 */
async function main() {
  console.log("Deploying Multi-DEX simulation environment...");
  
  // Get signers
  const [deployer, user1, user2] = await ethers.getSigners();
  console.log(`Deployer address: ${deployer.address}`);
  
  // Configuration
  const INITIAL_SUPPLY = ethers.utils.parseEther("10000000"); // 10 million tokens
  const LP_AMOUNT = ethers.utils.parseEther("100000");        // Initial liquidity
  const FLASH_LOAN_FEE = 9;                                   // 0.09% flash loan fee
  
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
  
  const wbtc = await MockERC20.deploy("Wrapped Bitcoin", "WBTC", INITIAL_SUPPLY);
  await wbtc.deployed();
  console.log(`Mock WBTC deployed to: ${wbtc.address}`);
  
  // Deploy mock lending pool for flash loans
  console.log("\nDeploying mock lending pool...");
  const MockLendingPool = await ethers.getContractFactory("MockLendingPool");
  const lendingPool = await MockLendingPool.deploy(FLASH_LOAN_FEE);
  await lendingPool.deployed();
  console.log(`Mock Lending Pool deployed to: ${lendingPool.address}`);
  
  // Deploy mock DEX routers
  console.log("\nDeploying mock DEX routers...");
  
  // Uniswap V2
  const MockRouter = await ethers.getContractFactory("MockRouter");
  const uniswapV2Router = await MockRouter.deploy("Uniswap V2");
  await uniswapV2Router.deployed();
  console.log(`Mock Uniswap V2 Router deployed to: ${uniswapV2Router.address}`);
  
  // Uniswap V3
  const MockUniswapV3Router = await ethers.getContractFactory("MockUniswapV3Router");
  const uniswapV3Router = await MockUniswapV3Router.deploy("Uniswap V3");
  await uniswapV3Router.deployed();
  console.log(`Mock Uniswap V3 Router deployed to: ${uniswapV3Router.address}`);
  
  // Curve (using MockRouter for simulation)
  const curveRouter = await MockRouter.deploy("Curve");
  await curveRouter.deployed();
  console.log(`Mock Curve Router deployed to: ${curveRouter.address}`);
  
  // Balancer (using MockRouter for simulation)
  const balancerRouter = await MockRouter.deploy("Balancer");
  await balancerRouter.deployed();
  console.log(`Mock Balancer Router deployed to: ${balancerRouter.address}`);
  
  // Deploy MultiDexArbitrageur contract
  console.log("\nDeploying MultiDexArbitrageur contract...");
  const MultiDexArbitrageur = await ethers.getContractFactory("MultiDexArbitrageur");
  const arbitrageur = await MultiDexArbitrageur.deploy(lendingPool.address);
  await arbitrageur.deployed();
  console.log(`MultiDexArbitrageur deployed to: ${arbitrageur.address}`);
  
  // Set up exchange rates with price differences to create arbitrage opportunities
  console.log("\nSetting up exchange rates between DEXes...");
  
  // Uniswap V2 rates (base rates)
  // 1 ETH = 2000 DAI
  // 1 ETH = 2000 USDC
  // 1 ETH = 30 WBTC
  // 1 DAI = 1 USDC
  await uniswapV2Router.setExchangeRate(weth.address, dai.address, ethers.utils.parseEther("2000"));
  await uniswapV2Router.setExchangeRate(weth.address, usdc.address, ethers.utils.parseEther("2000"));
  await uniswapV2Router.setExchangeRate(weth.address, wbtc.address, ethers.utils.parseEther("30"));
  await uniswapV2Router.setExchangeRate(dai.address, usdc.address, ethers.utils.parseEther("1"));
  
  // Uniswap V3 rates (slightly different to create arbitrage opportunities)
  // 1 ETH = 2050 DAI (+2.5%)
  // 1 ETH = 1950 USDC (-2.5%)
  // 1 ETH = 29.5 WBTC (-1.7%)
  // 1 DAI = 0.97 USDC (-3%)
  await uniswapV3Router.setExchangeRate(weth.address, dai.address, 3000, ethers.utils.parseEther("2050"));
  await uniswapV3Router.setExchangeRate(weth.address, usdc.address, 3000, ethers.utils.parseEther("1950"));
  await uniswapV3Router.setExchangeRate(weth.address, wbtc.address, 3000, ethers.utils.parseEther("29.5"));
  await uniswapV3Router.setExchangeRate(dai.address, usdc.address, 3000, ethers.utils.parseEther("0.97"));
  
  // Curve rates (more significant differences for triangle arbitrage)
  // 1 ETH = 2100 DAI (+5%)
  // 1 ETH = 1900 USDC (-5%)
  // 1 ETH = 31 WBTC (+3.3%)
  // 1 DAI = 0.93 USDC (-7%)
  await curveRouter.setExchangeRate(weth.address, dai.address, ethers.utils.parseEther("2100"));
  await curveRouter.setExchangeRate(weth.address, usdc.address, ethers.utils.parseEther("1900"));
  await curveRouter.setExchangeRate(weth.address, wbtc.address, ethers.utils.parseEther("31"));
  await curveRouter.setExchangeRate(dai.address, usdc.address, ethers.utils.parseEther("0.93"));
  
  // Balancer rates (for the most extreme arbitrage opportunities)
  // 1 ETH = 2150 DAI (+7.5%)
  // 1 ETH = 1850 USDC (-7.5%)
  // 1 ETH = 32 WBTC (+6.7%)
  // 1 DAI = 0.90 USDC (-10%)
  await balancerRouter.setExchangeRate(weth.address, dai.address, ethers.utils.parseEther("2150"));
  await balancerRouter.setExchangeRate(weth.address, usdc.address, ethers.utils.parseEther("1850"));
  await balancerRouter.setExchangeRate(weth.address, wbtc.address, ethers.utils.parseEther("32"));
  await balancerRouter.setExchangeRate(dai.address, usdc.address, ethers.utils.parseEther("0.90"));
  
  // Provide tokens to the lending pool for flash loans
  console.log("\nProviding liquidity to lending pool for flash loans...");
  await weth.transfer(lendingPool.address, ethers.utils.parseEther("100"));
  await dai.transfer(lendingPool.address, ethers.utils.parseEther("200000"));
  await usdc.transfer(lendingPool.address, ethers.utils.parseEther("200000"));
  await wbtc.transfer(lendingPool.address, ethers.utils.parseEther("3000"));
  
  // Provide tokens to the DEX routers for swaps
  console.log("\nProviding liquidity to DEX routers...");
  
  // Uniswap V2
  await weth.transfer(uniswapV2Router.address, ethers.utils.parseEther("100"));
  await dai.transfer(uniswapV2Router.address, ethers.utils.parseEther("200000"));
  await usdc.transfer(uniswapV2Router.address, ethers.utils.parseEther("200000"));
  await wbtc.transfer(uniswapV2Router.address, ethers.utils.parseEther("3000"));
  
  // Uniswap V3
  await weth.transfer(uniswapV3Router.address, ethers.utils.parseEther("100"));
  await dai.transfer(uniswapV3Router.address, ethers.utils.parseEther("200000"));
  await usdc.transfer(uniswapV3Router.address, ethers.utils.parseEther("200000"));
  await wbtc.transfer(uniswapV3Router.address, ethers.utils.parseEther("3000"));
  
  // Curve
  await weth.transfer(curveRouter.address, ethers.utils.parseEther("100"));
  await dai.transfer(curveRouter.address, ethers.utils.parseEther("200000"));
  await usdc.transfer(curveRouter.address, ethers.utils.parseEther("200000"));
  await wbtc.transfer(curveRouter.address, ethers.utils.parseEther("3000"));
  
  // Balancer
  await weth.transfer(balancerRouter.address, ethers.utils.parseEther("100"));
  await dai.transfer(balancerRouter.address, ethers.utils.parseEther("200000"));
  await usdc.transfer(balancerRouter.address, ethers.utils.parseEther("200000"));
  await wbtc.transfer(balancerRouter.address, ethers.utils.parseEther("3000"));
  
  // Set flashloan receiver in the lending pool
  await lendingPool.setFlashloanReceiver(arbitrageur.address);
  
  // Save deployment information to files
  console.log("\nSaving deployment information...");
  
  // Save to simulation-config.json for general use
  const simulationConfig = {
    weth: weth.address,
    dai: dai.address,
    usdc: usdc.address,
    wbtc: wbtc.address,
    lendingPool: lendingPool.address,
    uniswapV2Router: uniswapV2Router.address,
    uniswapV3Router: uniswapV3Router.address,
    curveRouter: curveRouter.address,
    balancerRouter: balancerRouter.address,
    arbitrageur: arbitrageur.address,
    networkId: (await ethers.provider.getNetwork()).chainId,
  };
  
  fs.writeFileSync(
    "simulation-config.json",
    JSON.stringify(simulationConfig, null, 2)
  );
  
  // Save to deployments directory for the arbitrageur scripts
  const outDir = path.join(__dirname, "../deployments");
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }
  
  fs.writeFileSync(
    path.join(outDir, "multi-dex-arb-deployment.json"),
    JSON.stringify({
      network: (await ethers.provider.getNetwork()).name,
      arbitrageur: arbitrageur.address,
      lendingPool: lendingPool.address,
      tokens: {
        weth: weth.address,
        dai: dai.address,
        usdc: usdc.address,
        wbtc: wbtc.address
      },
      routers: {
        uniswapV2: uniswapV2Router.address,
        uniswapV3: uniswapV3Router.address,
        curve: curveRouter.address,
        balancer: balancerRouter.address
      },
      deployer: deployer.address,
      timestamp: new Date().toISOString()
    }, null, 2)
  );
  
  console.log("\nMulti-DEX simulation environment setup complete!");
  console.log("\nDeployed contracts:");
  console.log(`- WETH: ${weth.address}`);
  console.log(`- DAI: ${dai.address}`);
  console.log(`- USDC: ${usdc.address}`);
  console.log(`- WBTC: ${wbtc.address}`);
  console.log(`- Lending Pool: ${lendingPool.address}`);
  console.log(`- Uniswap V2 Router: ${uniswapV2Router.address}`);
  console.log(`- Uniswap V3 Router: ${uniswapV3Router.address}`);
  console.log(`- Curve Router: ${curveRouter.address}`);
  console.log(`- Balancer Router: ${balancerRouter.address}`);
  console.log(`- MultiDexArbitrageur: ${arbitrageur.address}`);
  
  console.log("\nYou can now run the following commands:");
  console.log("- npm run execute:multi-dex-arb");
  console.log("- npm run arb:scan:universal");
}

// Execute the script
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
