import { HardhatRuntimeEnvironment } from "hardhat/types";
import { HardhatEthersHelpers } from "@nomiclabs/hardhat-ethers/types";
import { BigNumber, Contract } from "ethers";
import * as fs from "fs";
import * as path from "path";

// This is a workaround for accessing ethers from hardhat
declare global {
  interface HardhatRuntimeEnvironment {
    ethers: HardhatEthersHelpers;
  }
}

// Import hardhat runtime
const hre = require("hardhat");
const ethers = hre.ethers;

// Create logs directory if it doesn't exist
const logsDir = path.join(__dirname, "../logs");
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir);
}

// Setup logging function
function logMessage(message: string) {
  const timestamp = new Date().toISOString();
  const logEntry = `[${timestamp}] ${message}`;
  
  console.log(logEntry);
  
  // Log to file
  const logFile = path.join(logsDir, `arbitrage_${new Date().toISOString().split('T')[0]}.log`);
  fs.appendFileSync(logFile, logEntry + '\n');
}

// Load simulation configuration
function loadSimulationConfig() {
  try {
    const configPath = path.join(__dirname, "../simulation-config.json");
    if (!fs.existsSync(configPath)) {
      throw new Error("Simulation config not found. Run deploy-simulation.ts first.");
    }
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (error) {
    console.error("Error loading simulation config:", error);
    process.exit(1);
  }
}

// Flash loan fee in percentage
const AAVE_FLASH_LOAN_FEE = 0.09; // 0.09%

// Minimum profit threshold in percentage
const MIN_PROFIT_PERCENTAGE = 0.001;  // Lower the threshold to see executions in simulation

async function main() {
  logMessage("Starting arbitrage scanner in simulation mode...");
  
  // Load simulation configuration
  const config = loadSimulationConfig();
  logMessage(`Loaded simulation config with network ID: ${config.networkId}`);
  
  // Get signer
  const [deployer] = await ethers.getSigners();
  logMessage(`Using account: ${deployer.address}`);
  
  // Load contract ABIs
  const FlashloanArbArtifact = require("../artifacts/contracts/FlashloanArb.sol/FlashloanArb.json");
  const MockERC20Artifact = require("../artifacts/contracts/mocks/MockERC20.sol/MockERC20.json");
  const MockRouterArtifact = require("../artifacts/contracts/mocks/MockRouter.sol/MockRouter.json");
  const MockUniswapV3RouterArtifact = require("../artifacts/contracts/mocks/MockUniswapV3Router.sol/MockUniswapV3Router.json");
  
  // Connect to contracts
  const flashloanArb = new ethers.Contract(
    config.flashloanArb,
    FlashloanArbArtifact.abi,
    deployer
  );
  
  const weth = new ethers.Contract(
    config.weth,
    MockERC20Artifact.abi,
    deployer
  );
  
  const dai = new ethers.Contract(
    config.dai,
    MockERC20Artifact.abi,
    deployer
  );
  
  const usdc = new ethers.Contract(
    config.usdc,
    MockERC20Artifact.abi,
    deployer
  );
  
  const uniswapV2Router = new ethers.Contract(
    config.uniswapV2Router,
    MockRouterArtifact.abi,
    deployer
  );
  
  const uniswapV3Router = new ethers.Contract(
    config.uniswapV3Router,
    MockUniswapV3RouterArtifact.abi,
    deployer
  );
  
  logMessage("Connected to all contracts in simulation");
  logMessage("Starting arbitrage scanning between Uniswap V2 and Uniswap V3...");
  
  // Token pairs to monitor
  const tokenPairs = [
    { from: config.weth, to: config.dai, name: "WETH/DAI", fromDecimals: 18, toDecimals: 18 },
    { from: config.weth, to: config.usdc, name: "WETH/USDC", fromDecimals: 18, toDecimals: 18 },
    { from: config.dai, to: config.usdc, name: "DAI/USDC", fromDecimals: 18, toDecimals: 18 }
  ];
  
  // Flash loan amount - 100 units of each token
  const flashLoanAmounts: {[key: string]: BigNumber} = {
    [config.weth]: ethers.utils.parseEther("100"),  // 100 WETH
    [config.dai]: ethers.utils.parseEther("100000"), // 100,000 DAI
    [config.usdc]: ethers.utils.parseEther("100000")  // 100,000 USDC
  };
  
  // Main scanning loop
  while (true) {
    try {
      // Random sleep to simulate real network behavior
      const randomMs = Math.floor(Math.random() * 500) + 500;
      await new Promise(resolve => setTimeout(resolve, randomMs));
      
      // Check all token pairs
      for (const pair of tokenPairs) {
        await checkArbitrageOpportunity(
          uniswapV2Router,
          uniswapV3Router,
          pair.from,
          pair.to,
          pair.name,
          flashLoanAmounts[pair.from],
          flashloanArb
        );
      }
      
      // Sleep between scans
      await new Promise(resolve => setTimeout(resolve, 5000));
      logMessage("Waiting for next scan cycle...");
    } catch (error) {
      logMessage(`Error in main loop: ${error}`);
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
}

async function checkArbitrageOpportunity(
  uniswapV2Router: Contract,
  uniswapV3Router: Contract,
  tokenFrom: string,
  tokenTo: string,
  pairName: string,
  amountIn: BigNumber,
  flashloanArb: Contract
) {
  logMessage(`Checking ${pairName} for arbitrage opportunities...`);
  
  try {
    // Check V2 price
    const path = [tokenFrom, tokenTo];
    const uniV2AmountsOut = await uniswapV2Router.getAmountsOut(amountIn, path);
    const uniV2AmountOut = uniV2AmountsOut[1];
    
    // Check V3 price at 0.3% fee tier
    const v3FeeLevel = 3000; // 0.3%
    const uniV3AmountOut = await uniswapV3Router.getQuote(
      tokenFrom,
      tokenTo,
      v3FeeLevel,
      amountIn
    );
    
    // Format prices for logging
    const v2Price = ethers.utils.formatEther(uniV2AmountOut);
    const v3Price = ethers.utils.formatEther(uniV3AmountOut);
    
    logMessage(`${pairName} prices:`);
    logMessage(`- Uniswap V2: 1 unit = ${v2Price} units`);
    logMessage(`- Uniswap V3: 1 unit = ${v3Price} units`);
    
    // Check for arbitrage opportunities
    let profitPath: string[] = [];
    let expectedProfit = BigNumber.from(0);
    let flashLoanRepayment = amountIn.mul(10000 + Math.floor(AAVE_FLASH_LOAN_FEE * 100)).div(10000);
    
    // Check V2 -> V3 path
    if (uniV2AmountOut.gt(uniV3AmountOut)) {
      // Buy on V2, sell on V3
      const reversePath = [tokenTo, tokenFrom];
      const v3BackAmounts = await uniswapV3Router.getQuote(
        tokenTo,
        tokenFrom,
        v3FeeLevel,
        uniV2AmountOut
      );
      
      if (v3BackAmounts.gt(flashLoanRepayment)) {
        profitPath = ["V2", "V3"];
        expectedProfit = v3BackAmounts.sub(flashLoanRepayment);
      }
    } 
    // Check V3 -> V2 path
    else if (uniV3AmountOut.gt(uniV2AmountOut)) {
      // Buy on V3, sell on V2
      const reversePath = [tokenTo, tokenFrom];
      const v2BackAmounts = await uniswapV2Router.getAmountsOut(uniV3AmountOut, reversePath);
      const finalAmount = v2BackAmounts[1];
      
      if (finalAmount.gt(flashLoanRepayment)) {
        profitPath = ["V3", "V2"];
        expectedProfit = finalAmount.sub(flashLoanRepayment);
      }
    }
    
    // If profitable opportunity found
    if (profitPath.length > 0 && expectedProfit.gt(0)) {
      // Calculate profit percentage
      const profitPercentageStr = ethers.utils.formatEther(expectedProfit.mul(100).div(amountIn));
      const profitPercentage = Number(profitPercentageStr);
      
      logMessage(`ARBITRAGE OPPORTUNITY FOUND!`);
      logMessage(`Path: ${profitPath[0]} -> ${profitPath[1]}`);
      logMessage(`Expected profit: ${ethers.utils.formatEther(expectedProfit)} (${profitPercentage.toFixed(2)}%)`);
      
      // Check if profit meets minimum threshold
      if (profitPercentage >= MIN_PROFIT_PERCENTAGE) {
        logMessage(`Profit exceeds threshold. Would execute arbitrage in non-simulation mode.`);
        
        // In a real scenario, we would execute the arbitrage here
        // Since this is a simulation, we just log the opportunity
        
        // Save to CSV for record keeping
        const csvLogEntry = `${new Date().toISOString()},${pairName},${profitPath[0]}->${profitPath[1]},${ethers.utils.formatEther(expectedProfit)},${profitPercentage.toFixed(2)}%,SIMULATION\n`;
        try {
          // Use direct concatenation instead of path.join to avoid TypeScript errors
          const csvPath = __dirname + "/../arbitrage_log.csv";
          fs.writeFileSync(csvPath, csvLogEntry, { flag: 'a' });
        } catch (error) {
          logMessage(`Error writing to CSV: ${error}`);
        }
        
        // Sleep a moment to simulate transaction time
        await new Promise(resolve => setTimeout(resolve, 2000));
        logMessage(`[SIMULATION] Arbitrage execution completed`);
      } else {
        logMessage(`Profit below threshold (${MIN_PROFIT_PERCENTAGE}%). Skipping execution.`);
      }
    } else {
      logMessage(`No profitable arbitrage opportunity found for ${pairName}.`);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logMessage(`Error checking ${pairName}: ${errorMessage}`);
  }
}

// Run the main function
main().catch(error => {
  console.error("Fatal error:", error);
  process.exit(1);
});
