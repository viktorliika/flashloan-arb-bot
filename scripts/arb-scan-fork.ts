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
  const logFile = path.join(logsDir, `arbitrage_fork_${new Date().toISOString().split('T')[0]}.log`);
  fs.appendFileSync(logFile, logEntry + '\n');
}

// Load forked mainnet configuration
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

// Aave flash loan fee 
const AAVE_FLASH_LOAN_FEE = 0.09; // 0.09%

// Minimum profit threshold in percentage - lowered for testing
const MIN_PROFIT_PERCENTAGE = 0.01;  // 0.01% minimum profit to execute (lowered from 0.05%)

// Interface ABIs for mainnet contracts
const WETH_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)"
];

const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function name() view returns (string)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)"
];

const UNISWAP_V2_ROUTER_ABI = [
  "function getAmountsOut(uint amountIn, address[] memory path) public view returns (uint[] memory amounts)",
  "function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)"
];

const SUSHISWAP_ROUTER_ABI = [
  "function getAmountsOut(uint amountIn, address[] memory path) public view returns (uint[] memory amounts)",
  "function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)"
];

const UNISWAP_V3_QUOTER_ABI = [
  "function quoteExactInputSingle(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint160 sqrtPriceLimitX96) external view returns (uint256 amountOut)"
];

// Using more detailed ABI including contract interfaces to ensure compatibility
const FLASHLOAN_ARB_ABI = [
  "function executeArbitrage(address loanAsset, uint256 loanAmount, address[2][] calldata pairs, uint8[] calldata dexForTrade) external",
  "function setMinProfitAmount(uint256 _newMinProfitAmount) external",
  "function lendingPool() view returns (address)",
  "function dexARouter() view returns (address)",
  "function dexBRouter() view returns (address)",
  "function dexAType() view returns (uint8)",
  "function dexBType() view returns (uint8)"
];

async function main() {
  logMessage("Starting arbitrage scanner in forked mainnet mode...");
  
  // Load fork configuration
  const config = loadForkConfig();
  logMessage(`Loaded fork config with network ID: ${config.networkId}`);
  
  // Get signer
  const [deployer] = await ethers.getSigners();
  logMessage(`Using account: ${deployer.address}`);
  
  // Connect to the FlashloanArb contract
  const flashloanArb = new ethers.Contract(
    config.flashloanArb,
    FLASHLOAN_ARB_ABI,
    deployer
  );
  
  // Connect to token contracts
  const weth = new ethers.Contract(config.weth, WETH_ABI, deployer);
  const dai = new ethers.Contract(config.dai, ERC20_ABI, deployer);
  const usdc = new ethers.Contract(config.usdc, ERC20_ABI, deployer);
  
  // Connect to DEX routers
  const uniswapV2Router = new ethers.Contract(
    config.uniswapV2Router,
    UNISWAP_V2_ROUTER_ABI,
    deployer
  );
  
  const sushiswapRouter = new ethers.Contract(
    config.sushiswapRouter,
    SUSHISWAP_ROUTER_ABI,
    deployer
  );
  
  // Get token decimals (USDC has 6 decimals on mainnet)
  const wethDecimals = 18; // WETH is always 18 decimals
  const daiDecimals = 18;  // DAI is always 18 decimals
  const usdcDecimals = await usdc.decimals(); // Should be 6 on mainnet
  
  logMessage(`Connected to all contracts in forked mainnet`);
  logMessage(`WETH decimals: ${wethDecimals}`);
  logMessage(`DAI decimals: ${daiDecimals}`);
  logMessage(`USDC decimals: ${usdcDecimals}`);
  
  logMessage("Starting arbitrage scanning between Uniswap V2 and Sushiswap...");
  
  // Token pairs to monitor
  const tokenPairs = [
    { from: config.weth, to: config.dai, name: "WETH/DAI", fromDecimals: wethDecimals, toDecimals: daiDecimals },
    { from: config.weth, to: config.usdc, name: "WETH/USDC", fromDecimals: wethDecimals, toDecimals: usdcDecimals },
    { from: config.dai, to: config.usdc, name: "DAI/USDC", fromDecimals: daiDecimals, toDecimals: usdcDecimals }
  ];
  
  // Flash loan amounts - use smaller amounts for initial testing
  const flashLoanAmounts: {[key: string]: BigNumber} = {
    [config.weth]: ethers.utils.parseUnits("10", wethDecimals),    // 10 WETH
    [config.dai]: ethers.utils.parseUnits("10000", daiDecimals),   // 10,000 DAI 
    [config.usdc]: ethers.utils.parseUnits("10000", usdcDecimals)  // 10,000 USDC
  };
  
  // Main scanning loop
  let scanCount = 0;
  const MAX_SCANS = 10; // Limit the number of scans for testing purposes
  
  while (scanCount < MAX_SCANS) {
    try {
      scanCount++;
      logMessage(`Scan #${scanCount} of ${MAX_SCANS}`);
      
      // Random sleep to avoid rate limiting
      const randomMs = Math.floor(Math.random() * 500) + 500;
      await new Promise(resolve => setTimeout(resolve, randomMs));
      
      // Check all token pairs
      for (const pair of tokenPairs) {
        await checkArbitrageOpportunity(
          uniswapV2Router,
          sushiswapRouter,
          pair.from,
          pair.to,
          pair.name,
          flashLoanAmounts[pair.from],
          pair.fromDecimals,
          pair.toDecimals,
          flashloanArb
        );
      }
      
      // Sleep between scans
      await new Promise(resolve => setTimeout(resolve, 3000));
      logMessage("Waiting for next scan cycle...");
    } catch (error) {
      logMessage(`Error in main loop: ${error}`);
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }
  
  logMessage("Scan complete. Total scans: " + scanCount);
}

async function checkArbitrageOpportunity(
  uniswapV2Router: Contract,
  sushiswapRouter: Contract,
  tokenFrom: string,
  tokenTo: string,
  pairName: string,
  amountIn: BigNumber,
  fromDecimals: number,
  toDecimals: number,
  flashloanArb: Contract
) {
  logMessage(`Checking ${pairName} for arbitrage opportunities...`);
  
  try {
    // Check Uniswap V2 price
    const path = [tokenFrom, tokenTo];
    const uniV2AmountsOut = await uniswapV2Router.getAmountsOut(amountIn, path);
    const uniV2AmountOut = uniV2AmountsOut[1];
    
    // Check Sushiswap price
    const sushiAmountsOut = await sushiswapRouter.getAmountsOut(amountIn, path);
    const sushiAmountOut = sushiAmountsOut[1];
    
    // Format prices for logging
    const v2Price = ethers.utils.formatUnits(uniV2AmountOut, toDecimals);
    const sushiPrice = ethers.utils.formatUnits(sushiAmountOut, toDecimals);
    
    logMessage(`${pairName} prices:`);
    logMessage(`- Uniswap V2: 1 unit = ${v2Price} units`);
    logMessage(`- Sushiswap: 1 unit = ${sushiPrice} units`);
    
    // Calculate price difference
    const priceDiffPercentage = Math.abs(
      (Number(v2Price) - Number(sushiPrice)) / Math.min(Number(v2Price), Number(sushiPrice)) * 100
    );
    
    logMessage(`Price difference: ${priceDiffPercentage.toFixed(6)}%`);
    
    // Enhanced debug logging for arbitrage calculations
    
    // Calculate flash loan fee and repayment amount
    const flashLoanFeeAmount = amountIn.mul(Math.floor(AAVE_FLASH_LOAN_FEE * 100)).div(10000);
    const flashLoanRepayment = amountIn.add(flashLoanFeeAmount);
    
    logMessage(`Flash loan details:`);
    logMessage(`- Amount borrowed: ${ethers.utils.formatUnits(amountIn, fromDecimals)} ${pairName.split('/')[0]}`);
    logMessage(`- Flash loan fee: ${ethers.utils.formatUnits(flashLoanFeeAmount, fromDecimals)} ${pairName.split('/')[0]} (${AAVE_FLASH_LOAN_FEE}%)`);
    logMessage(`- Repayment required: ${ethers.utils.formatUnits(flashLoanRepayment, fromDecimals)} ${pairName.split('/')[0]}`);
    
    let profitPath: string[] = [];
    let expectedProfit = BigNumber.from(0);
    
    // Check Uniswap V2 -> Sushiswap path
    logMessage(`\nChecking arbitrage path: Uniswap V2 -> Sushiswap:`);
    if (uniV2AmountOut.gt(sushiAmountOut)) {
      // Buy on Uniswap V2, sell on Sushiswap
      logMessage(`- Step 1: Swap ${ethers.utils.formatUnits(amountIn, fromDecimals)} ${pairName.split('/')[0]} -> ${ethers.utils.formatUnits(uniV2AmountOut, toDecimals)} ${pairName.split('/')[1]} on Uniswap V2`);
      
      const reversePath = [tokenTo, tokenFrom];
      const sushiBackAmounts = await sushiswapRouter.getAmountsOut(uniV2AmountOut, reversePath);
      const finalAmount = sushiBackAmounts[1];
      
      logMessage(`- Step 2: Swap ${ethers.utils.formatUnits(uniV2AmountOut, toDecimals)} ${pairName.split('/')[1]} -> ${ethers.utils.formatUnits(finalAmount, fromDecimals)} ${pairName.split('/')[0]} on Sushiswap`);
      logMessage(`- Result: ${ethers.utils.formatUnits(finalAmount, fromDecimals)} ${pairName.split('/')[0]} (Started with ${ethers.utils.formatUnits(amountIn, fromDecimals)})`);
      
      if (finalAmount.gt(flashLoanRepayment)) {
        profitPath = ["Uniswap V2", "Sushiswap"];
        expectedProfit = finalAmount.sub(flashLoanRepayment);
        
        logMessage(`- PROFITABLE! Net profit: ${ethers.utils.formatUnits(expectedProfit, fromDecimals)} ${pairName.split('/')[0]}`);
        logMessage(`- Profit percentage: ${expectedProfit.mul(10000).div(amountIn).toNumber() / 100}%`);
      } else {
        const loss = flashLoanRepayment.sub(finalAmount);
        logMessage(`- NOT PROFITABLE. Would lose ${ethers.utils.formatUnits(loss, fromDecimals)} ${pairName.split('/')[0]}`);
      }
    } else {
      logMessage(`- Skipping this path (Uniswap V2 price is not better than Sushiswap)`);
    }
    
    // Check Sushiswap -> Uniswap V2 path
    logMessage(`\nChecking arbitrage path: Sushiswap -> Uniswap V2:`);
    if (sushiAmountOut.gt(uniV2AmountOut)) {
      // Buy on Sushiswap, sell on Uniswap V2
      logMessage(`- Step 1: Swap ${ethers.utils.formatUnits(amountIn, fromDecimals)} ${pairName.split('/')[0]} -> ${ethers.utils.formatUnits(sushiAmountOut, toDecimals)} ${pairName.split('/')[1]} on Sushiswap`);
      
      const reversePath = [tokenTo, tokenFrom];
      const uniV2BackAmounts = await uniswapV2Router.getAmountsOut(sushiAmountOut, reversePath);
      const finalAmount = uniV2BackAmounts[1];
      
      logMessage(`- Step 2: Swap ${ethers.utils.formatUnits(sushiAmountOut, toDecimals)} ${pairName.split('/')[1]} -> ${ethers.utils.formatUnits(finalAmount, fromDecimals)} ${pairName.split('/')[0]} on Uniswap V2`);
      logMessage(`- Result: ${ethers.utils.formatUnits(finalAmount, fromDecimals)} ${pairName.split('/')[0]} (Started with ${ethers.utils.formatUnits(amountIn, fromDecimals)})`);
      
      // Check if this path is more profitable
      if (finalAmount.gt(flashLoanRepayment)) {
        const newProfit = finalAmount.sub(flashLoanRepayment);
        logMessage(`- PROFITABLE! Net profit: ${ethers.utils.formatUnits(newProfit, fromDecimals)} ${pairName.split('/')[0]}`);
        logMessage(`- Profit percentage: ${newProfit.mul(10000).div(amountIn).toNumber() / 100}%`);
        
        // If we haven't found a profitable path yet, or this one is more profitable
        if (expectedProfit.isZero() || newProfit.gt(expectedProfit)) {
          profitPath = ["Sushiswap", "Uniswap V2"];
          expectedProfit = newProfit;
          logMessage(`- This is the best path so far!`);
        }
      } else {
        const loss = flashLoanRepayment.sub(finalAmount);
        logMessage(`- NOT PROFITABLE. Would lose ${ethers.utils.formatUnits(loss, fromDecimals)} ${pairName.split('/')[0]}`);
      }
    } else {
      logMessage(`- Skipping this path (Sushiswap price is not better than Uniswap V2)`);
    }
    
    // If profitable opportunity found
    if (profitPath.length > 0 && expectedProfit.gt(0)) {
      // Calculate profit percentage
      const profitPercentage = expectedProfit.mul(10000).div(amountIn).toNumber() / 100;
      
      logMessage(`ARBITRAGE OPPORTUNITY FOUND!`);
      logMessage(`Path: ${profitPath[0]} -> ${profitPath[1]}`);
      logMessage(`Expected profit: ${ethers.utils.formatUnits(expectedProfit, fromDecimals)} (${profitPercentage.toFixed(4)}%)`);
      
      // Check if profit meets minimum threshold
      if (profitPercentage >= MIN_PROFIT_PERCENTAGE) {
        logMessage(`Profit exceeds threshold. Would execute arbitrage in non-test mode.`);
        
        // Save to CSV for record keeping
        const csvLogEntry = `${new Date().toISOString()},${pairName},${profitPath[0]}->${profitPath[1]},${ethers.utils.formatUnits(expectedProfit, fromDecimals)},${profitPercentage.toFixed(4)}%,FORKED_MAINNET\n`;
        try {
          // Use direct concatenation instead of path.join to avoid TypeScript errors
          const csvPath = __dirname + "/../arbitrage_fork_log.csv";
          fs.writeFileSync(csvPath, csvLogEntry, { flag: 'a' });
        } catch (error) {
          logMessage(`Error writing to CSV: ${error}`);
        }
        
        // In a real scenario, we would execute the arbitrage here
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
