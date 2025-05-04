// Import hardhat runtime
const hre = require("hardhat");
const ethers = hre.ethers;
import * as fs from "fs";
import * as path from "path";

// Setup logging function
function log(message: string) {
  const timestamp = new Date().toISOString();
  const logEntry = `[${timestamp}] ${message}`;
  
  console.log(logEntry);
  
  // Log to file
  const logFile = path.join(__dirname, "../logs", `deploy_enhanced_arb_${new Date().toISOString().split('T')[0]}.log`);
  fs.appendFileSync(logFile, logEntry + '\n');
}

// Load fork configuration
function loadForkConfig() {
  try {
    const configPath = path.join(__dirname, "../fork-config.json");
    if (!fs.existsSync(configPath)) {
      throw new Error("Fork config not found. Run deploy-fork.ts first.");
    }
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (error) {
    console.error("Error loading fork config:", error);
    process.exit(1);
  }
}

// Ethereum mainnet addresses for V3
const UNISWAP_V3_ADDRESSES = {
  factory: "0x1F98431c8aD98523631AE4a59f267346ea31F984",
  router: "0xE592427A0AEce92De3Edee1F18E0157C05861564",
  quoter: "0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6",
};

async function main() {
  log("Starting deployment of enhanced arbitrage contract (FlashloanArbV2)...");
  
  // Load config
  const forkConfig = loadForkConfig();
  log(`Loaded fork config with network ID: ${forkConfig.networkId}`);
  
  // Get the signer
  const [deployer] = await ethers.getSigners();
  log(`Deploying with account: ${deployer.address}`);
  
  // Verify Aave LendingPool address
  log(`Using Aave LendingPool at: ${forkConfig.aaveLendingPool}`);
  
  // Deploy the enhanced FlashloanArbV2 contract
  const FlashloanArbV2 = await ethers.getContractFactory("FlashloanArbV2");
  
  const minProfitAmount = ethers.utils.parseEther("0.01"); // 0.01 ETH minimum profit
  
  log("Deploying FlashloanArbV2...");
  
  // Define deployment options with higher gas settings
  const deployOptions = {
    gasLimit: 6000000,
    maxFeePerGas: ethers.utils.parseUnits("100", "gwei"),
    maxPriorityFeePerGas: ethers.utils.parseUnits("2", "gwei")
  };
  
  const flashloanArbV2 = await FlashloanArbV2.deploy(
    forkConfig.aaveLendingPool,        // Aave lending pool
    forkConfig.uniswapV2Router,         // DEX A router (Uniswap V2)
    forkConfig.sushiswapRouter,         // DEX B router (Sushiswap)
    UNISWAP_V3_ADDRESSES.quoter,        // DEX A quoter (UniswapV3 Quoter)
    UNISWAP_V3_ADDRESSES.quoter,        // DEX B quoter (using same quoter for simplicity)
    minProfitAmount,
    deployOptions
  );
  
  log(`Deployment transaction sent. Waiting for confirmation...`);
  await flashloanArbV2.deployed();
  log(`FlashloanArbV2 deployed to: ${flashloanArbV2.address}`);
  
  // Configure the UniswapV3 router with higher gas settings
  log("Configuring UniswapV3 router...");
  let tx = await flashloanArbV2.setDexRouter("A", UNISWAP_V3_ADDRESSES.router, 1, {
    gasLimit: 500000,
    maxFeePerGas: ethers.utils.parseUnits("100", "gwei"),
    maxPriorityFeePerGas: ethers.utils.parseUnits("2", "gwei")
  }); // 1 = V3
  await tx.wait();
  log("UniswapV3 router configured as DEX A");
  
  // Set optimal fee tiers for common pairs
  log("Setting optimal fee tiers for common pairs...");
  
  // ETH/Stablecoin pairs typically use 0.3% fee tier
  await (await flashloanArbV2.setOptimalFeeTier(
    forkConfig.weth,
    forkConfig.dai,
    3000, // 0.3%
    {
      gasLimit: 300000,
      maxFeePerGas: ethers.utils.parseUnits("100", "gwei"),
      maxPriorityFeePerGas: ethers.utils.parseUnits("2", "gwei")
    }
  )).wait();
  log("Set WETH/DAI optimal fee tier to 0.3%");
  
  await (await flashloanArbV2.setOptimalFeeTier(
    forkConfig.weth,
    forkConfig.usdc,
    3000, // 0.3%
    {
      gasLimit: 300000,
      maxFeePerGas: ethers.utils.parseUnits("100", "gwei"),
      maxPriorityFeePerGas: ethers.utils.parseUnits("2", "gwei")
    }
  )).wait();
  log("Set WETH/USDC optimal fee tier to 0.3%");
  
  // Stablecoin pairs typically use 0.05% fee tier
  await (await flashloanArbV2.setOptimalFeeTier(
    forkConfig.dai,
    forkConfig.usdc,
    500, // 0.05%
    {
      gasLimit: 300000,
      maxFeePerGas: ethers.utils.parseUnits("100", "gwei"),
      maxPriorityFeePerGas: ethers.utils.parseUnits("2", "gwei")
    }
  )).wait();
  log("Set DAI/USDC optimal fee tier to 0.05%");
  
  // Update the fork-config.json file with the new contract address
  const updatedConfig = {
    ...forkConfig,
    flashloanArbV2: flashloanArbV2.address
  };
  
  fs.writeFileSync(
    path.join(__dirname, "../fork-config.json"),
    JSON.stringify(updatedConfig, null, 2)
  );
  
  log("Updated fork-config.json with new contract address");
  
  // Contract summary
  log("\nFlashloanArbV2 contract deployment summary:");
  log(`Address: ${flashloanArbV2.address}`);
  log(`Owner: ${deployer.address}`);
  log(`Min profit: ${ethers.utils.formatEther(minProfitAmount)} ETH`);
  log(`Uniswap V2 Router: ${forkConfig.uniswapV2Router}`);
  log(`Sushiswap Router: ${forkConfig.sushiswapRouter}`);
  log(`Uniswap V3 Router: ${UNISWAP_V3_ADDRESSES.router}`);
  log(`WETH address: ${forkConfig.weth}`);
  log(`DAI address: ${forkConfig.dai}`);
  log(`USDC address: ${forkConfig.usdc}`);
  
  log("\nDeployment complete!");
  
  // Verification instructions
  log("\nTo test the FlashloanArbV2 contract with triangle arbitrage:");
  log("1. Run the 'create-arb-opportunity.ts' script to create artificial price differences");
  log("2. Execute triangle arbitrage with 'npm run execute:triangle'");
  log("3. Monitor logs for successful arbitrage execution");
}

// Run the main function
main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error("Error in deployment:", error);
    process.exit(1);
  });
