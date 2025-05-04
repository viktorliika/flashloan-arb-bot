// Import hardhat runtime
const hre = require("hardhat");
const ethers = hre.ethers;
import { BigNumber, Contract, providers, Wallet } from "ethers";
import * as fs from "fs";
import * as path from "path";

// Import our utility modules
import { DynamicGasStrategy } from "./utils/gas-strategy";
import { TransactionExecutor } from "./utils/transaction-executor";
import { OpportunityValidator, ArbitrageOpportunity } from "./utils/opportunity-validator";
import { createFlashbotsProvider } from "./utils/flashbots-mock";

// ABI for FlashloanArbV2
const FLASHLOAN_ARB_V2_ABI = [
  "function executeArbitrage(address loanAsset, uint256 loanAmount, address[] calldata path, uint8[] calldata dexForTrade, uint24[] calldata feeTiers) external",
  "function executeTriangleArbitrage(address loanAsset, uint256 loanAmount, address[] calldata path, uint8[] calldata dexes, uint24[] calldata fees) external",
  "function withdrawTokens(address token, address to, uint256 amount) external",
  "function setMinProfitAmount(uint256 _newMinProfitAmount) external"
];

// ABI for ERC20 tokens
const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function name() view returns (string)",
  "function approve(address spender, uint256 amount) returns (bool)"
];

// Log helper
function log(message: string) {
  const timestamp = new Date().toISOString();
  const logEntry = `[${timestamp}] ${message}`;
  console.log(logEntry);
  
  // Log to file
  const logsDir = path.join(__dirname, "../logs");
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir);
  }
  
  const logFile = path.join(logsDir, `enhanced_test_${new Date().toISOString().split('T')[0]}.log`);
  fs.appendFileSync(logFile, logEntry + '\n');
}

// Load configuration
function loadConfig() {
  try {
    // Try to load fork config first
    const forkConfigPath = path.join(__dirname, "../fork-config.json");
    if (fs.existsSync(forkConfigPath)) {
      return JSON.parse(fs.readFileSync(forkConfigPath, 'utf8'));
    }
    
    // If no fork config, try simulation config
    const simConfigPath = path.join(__dirname, "../simulation-config.json");
    if (fs.existsSync(simConfigPath)) {
      return JSON.parse(fs.readFileSync(simConfigPath, 'utf8'));
    }
    
    throw new Error("No configuration file found. Please run deploy-fork.ts or deploy-simulation.ts first.");
  } catch (error) {
    console.error("Error loading configuration:", error);
    process.exit(1);
  }
}

async function main() {
  log("Starting enhanced arbitrage test...");
  
  // Load configuration
  const config = loadConfig();
  log(`Loaded configuration with network ID: ${config.networkId || 'unknown'}`);
  
  // Get signer
  const [deployer] = await ethers.getSigners();
  log(`Using account: ${deployer.address}`);
  
  // Create instances of our utility modules
  const gasStrategy = new DynamicGasStrategy(20); // 20% max gas percentage
  const executor = new TransactionExecutor(
    ethers.provider,
    gasStrategy,
    3,                // 3 retry attempts
    2000,             // 2s backoff
    false             // Not using Flashbots for testing
  );
  const validator = new OpportunityValidator(
    gasStrategy,
    5,                // $5 min profit
    2,                // 2% slippage tolerance
    0.3               // 0.3% min profit percentage
  );
  
  // Connect to the arbitrage contract
  let arbContract: Contract;
  try {
    if (config.flashloanArbV2) {
      arbContract = new ethers.Contract(
        config.flashloanArbV2,
        FLASHLOAN_ARB_V2_ABI,
        deployer
      );
      log(`Connected to FlashloanArbV2 contract at ${config.flashloanArbV2}`);
    } else if (config.flashloanArb) {
      arbContract = new ethers.Contract(
        config.flashloanArb,
        FLASHLOAN_ARB_V2_ABI, // Using V2 ABI, may not work with all functions on V1
        deployer
      );
      log(`Connected to FlashloanArb contract at ${config.flashloanArb}`);
    } else {
      throw new Error("No arbitrage contract address found in configuration");
    }
  } catch (error) {
    log(`Error connecting to contract: ${error}`);
    return;
  }
  
  // Connect to token contracts
  const weth = new ethers.Contract(config.weth, ERC20_ABI, deployer);
  const dai = new ethers.Contract(config.dai, ERC20_ABI, deployer);
  const usdc = new ethers.Contract(config.usdc, ERC20_ABI, deployer);
  
  // Get token info
  const wethDecimals = await weth.decimals();
  const wethSymbol = await weth.symbol();
  log(`Connected to WETH (${wethSymbol}) with ${wethDecimals} decimals`);
  
  const daiDecimals = await dai.decimals();
  const daiSymbol = await dai.symbol();
  log(`Connected to DAI (${daiSymbol}) with ${daiDecimals} decimals`);
  
  const usdcDecimals = await usdc.decimals();
  const usdcSymbol = await usdc.symbol();
  log(`Connected to USDC (${usdcSymbol}) with ${usdcDecimals} decimals`);
  
  // Mock ETH price for demonstration
  const ethPriceUsd = 3000;
  log(`Using mock ETH price: $${ethPriceUsd}`);
  
  // Create a sample opportunity
  const opportunity: ArbitrageOpportunity = {
    tokenBorrow: config.weth,
    flashLoanAmount: ethers.utils.parseUnits("10", wethDecimals),
    expectedProfit: ethers.utils.parseUnits("0.1", wethDecimals), // 0.1 ETH profit
    tokenName: wethSymbol,
    path: [config.weth, config.dai, config.usdc, config.weth],
    dexes: [0, 1, 0], // DEX A (Uniswap), DEX B (Sushiswap), DEX A (Uniswap)
    fees: [3000, 3000, 3000] // All using 0.3% fee tiers
  };
  
  log(`Created sample opportunity with expected profit of ${ethers.utils.formatUnits(opportunity.expectedProfit, wethDecimals)} ${wethSymbol}`);
  
  // Step 1: Validate the opportunity
  log("\nStep 1: Validating opportunity...");
  const validationResult = await validator.validate(
    opportunity,
    ethers.provider,
    500000, // Gas limit
    ethPriceUsd
  );
  
  if (!validationResult.valid) {
    log(`Opportunity validation failed: ${validationResult.reason}`);
    if (validationResult.adjustedProfit && validationResult.gasCost) {
      log(`Adjusted profit: ${ethers.utils.formatUnits(validationResult.adjustedProfit, wethDecimals)} ${wethSymbol}`);
      log(`Gas cost: ${ethers.utils.formatUnits(validationResult.gasCost, wethDecimals)} ${wethSymbol}`);
    }
    if (validationResult.profitability !== undefined) {
      log(`Profitability: ${validationResult.profitability.toFixed(4)}%`);
    }
    log("This is a simulated opportunity for testing, so we'll proceed anyway");
  } else {
    log("Opportunity is valid!");
    log(`Adjusted profit: ${ethers.utils.formatUnits(validationResult.adjustedProfit!, wethDecimals)} ${wethSymbol}`);
    log(`Gas cost: ${ethers.utils.formatUnits(validationResult.gasCost!, wethDecimals)} ${wethSymbol}`);
    log(`Profitability: ${validationResult.profitability!.toFixed(4)}%`);
  }
  
  // Step 2: Prepare transaction (only simulate, don't execute)
  log("\nStep 2: Preparing transaction (simulation only)...");
  try {
    // Simulate getting gas price using our strategy
    const gasPrice = await gasStrategy.getGasPrice(ethers.provider, opportunity.expectedProfit);
    log(`Calculated optimal gas price: ${ethers.utils.formatUnits(gasPrice, "gwei")} Gwei`);
    
    // Check if profitable after gas
    const gasLimit = 500000;
    const gasCost = gasPrice.mul(gasLimit);
    const isProfitable = gasStrategy.isProfitableAfterGas(
      opportunity.expectedProfit,
      gasPrice,
      gasLimit
    );
    
    log(`Gas cost would be: ${ethers.utils.formatUnits(gasCost, wethDecimals)} ${wethSymbol}`);
    log(`Transaction would be profitable: ${isProfitable}`);
    
    const netProfit = gasStrategy.getProfitAfterGas(
      opportunity.expectedProfit,
      gasPrice,
      gasLimit
    );
    log(`Net profit after gas: ${ethers.utils.formatUnits(netProfit, wethDecimals)} ${wethSymbol}`);
    
    // Show how to execute with TransactionExecutor (but don't actually execute)
    log("\nIn production, the transaction would be executed with:");
    log(`executor.executeContractMethod(`);
    log(`  arbContract,`);
    log(`  "executeTriangleArbitrage",`);
    log(`  [opportunity.tokenBorrow, opportunity.flashLoanAmount, opportunity.path, opportunity.dexes, opportunity.fees],`);
    log(`  deployer,`);
    log(`  opportunity.expectedProfit,`);
    log(`  500000`);
    log(`);`);
    
    // If using Flashbots
    log("\nIf using Flashbots for MEV protection:");
    log(`const flashbotsExecutor = new TransactionExecutor(`);
    log(`  ethers.provider,`);
    log(`  gasStrategy,`);
    log(`  3,           // 3 retry attempts`);
    log(`  2000,        // 2s backoff`);
    log(`  true         // Use Flashbots`);
    log(`);`);
    log(`flashbotsExecutor.executeContractMethod(...);`);
  } catch (error) {
    log(`Error in simulation: ${error}`);
  }
  
  log("\nEnhanced arbitrage test completed successfully");
}

// Run the main function
main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
