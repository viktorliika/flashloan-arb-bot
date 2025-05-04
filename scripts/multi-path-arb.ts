// Import hardhat runtime
const hre = require("hardhat");
const ethers = hre.ethers;
import { BigNumber, Contract } from "ethers";
import * as fs from "fs";
import * as path from "path";

// Setup logging function
function log(message: string) {
  const timestamp = new Date().toISOString();
  const logEntry = `[${timestamp}] ${message}`;
  
  console.log(logEntry);
  
  // Log to file
  const logFile = path.join(__dirname, "../logs", `multi_path_arb_${new Date().toISOString().split('T')[0]}.log`);
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

// ABIs for contracts
const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function name() view returns (string)"
];

const ROUTER_ABI = [
  "function getAmountsOut(uint amountIn, address[] memory path) view returns (uint[] memory amounts)"
];

// Flash loan fee
const AAVE_FLASH_LOAN_FEE = 0.09; // 0.09%

// Test multiple loan amounts
const LOAN_AMOUNTS_MULTIPLIERS = [0.1, 1, 10, 50, 100]; // multipliers for base amount

async function main() {
  log("Starting multi-path arbitrage analysis on forked mainnet...");
  
  // Load configuration
  const config = loadForkConfig();
  log(`Loaded fork config with network ID: ${config.networkId}`);
  
  // Get signer
  const [deployer] = await ethers.getSigners();
  
  // Connect to tokens
  const weth = new ethers.Contract(config.weth, ERC20_ABI, deployer);
  const dai = new ethers.Contract(config.dai, ERC20_ABI, deployer);
  const usdc = new ethers.Contract(config.usdc, ERC20_ABI, deployer);
  
  // Get token symbols and decimals
  const wethSymbol = await weth.symbol();
  const wethDecimals = await weth.decimals();
  const daiSymbol = await dai.symbol();
  const daiDecimals = await dai.decimals();
  const usdcSymbol = await usdc.symbol();
  const usdcDecimals = await usdc.decimals();
  
  log(`Token details:`);
  log(`- ${wethSymbol}: ${wethDecimals} decimals`);
  log(`- ${daiSymbol}: ${daiDecimals} decimals`);
  log(`- ${usdcSymbol}: ${usdcDecimals} decimals`);
  
  // Connect to routers
  const uniswapRouter = new ethers.Contract(config.uniswapV2Router, ROUTER_ABI, deployer);
  const sushiswapRouter = new ethers.Contract(config.sushiswapRouter, ROUTER_ABI, deployer);
  
  // Define tokens for our paths
  const tokens = [
    { address: config.weth, symbol: wethSymbol, decimals: wethDecimals },
    { address: config.dai, symbol: daiSymbol, decimals: daiDecimals },
    { address: config.usdc, symbol: usdcSymbol, decimals: usdcDecimals }
  ];
  
  // Base loan amounts (will be multiplied by LOAN_AMOUNTS_MULTIPLIERS)
  const baseLoanAmounts = {
    [config.weth]: ethers.utils.parseUnits("1", wethDecimals),
    [config.dai]: ethers.utils.parseUnits("1000", daiDecimals),
    [config.usdc]: ethers.utils.parseUnits("1000", usdcDecimals)
  };
  
  // Try different starting tokens and paths
  for (const startToken of tokens) {
    log(`\n========== STARTING WITH ${startToken.symbol} ==========`);
    
    // Try different loan amounts
    for (const multiplier of LOAN_AMOUNTS_MULTIPLIERS) {
      const loanAmount = baseLoanAmounts[startToken.address].mul(Math.floor(multiplier * 100)).div(100);
      log(`\n----- Testing with loan amount: ${ethers.utils.formatUnits(loanAmount, startToken.decimals)} ${startToken.symbol} -----`);
      
      // Calculate flash loan fee and repayment
      const flashLoanFee = loanAmount.mul(Math.floor(AAVE_FLASH_LOAN_FEE * 100)).div(10000);
      const requiredRepayment = loanAmount.add(flashLoanFee);
      
      log(`Flash loan fee: ${ethers.utils.formatUnits(flashLoanFee, startToken.decimals)} ${startToken.symbol}`);
      log(`Required repayment: ${ethers.utils.formatUnits(requiredRepayment, startToken.decimals)} ${startToken.symbol}`);
      
      // Try simple paths (2 tokens)
      await testSimplePaths(startToken, tokens, loanAmount, requiredRepayment, uniswapRouter, sushiswapRouter);
      
      // Try triangle paths (3 tokens)
      await testTrianglePaths(startToken, tokens, loanAmount, requiredRepayment, uniswapRouter, sushiswapRouter);
    }
  }
  
  log("\nMulti-path arbitrage analysis complete!");
}

async function testSimplePaths(
  startToken: any,
  tokens: any[],
  loanAmount: BigNumber,
  requiredRepayment: BigNumber,
  uniswapRouter: Contract,
  sushiswapRouter: Contract
) {
  log(`\nTesting simple paths (starting and ending with ${startToken.symbol}):`);
  
  // For each token (other than the start token)
  for (const middleToken of tokens.filter(t => t.address !== startToken.address)) {
    log(`\nTesting path: ${startToken.symbol} -> ${middleToken.symbol} -> ${startToken.symbol}`);
    
    // Four possible paths:
    // 1. Uniswap -> Uniswap
    // 2. Uniswap -> Sushiswap
    // 3. Sushiswap -> Uniswap
    // 4. Sushiswap -> Sushiswap
    
    // Path 1: Uniswap -> Uniswap
    await testPath(
      "Uniswap -> Uniswap",
      uniswapRouter,
      uniswapRouter,
      startToken,
      middleToken,
      startToken,
      loanAmount,
      requiredRepayment
    );
    
    // Path 2: Uniswap -> Sushiswap
    await testPath(
      "Uniswap -> Sushiswap",
      uniswapRouter,
      sushiswapRouter,
      startToken,
      middleToken,
      startToken,
      loanAmount,
      requiredRepayment
    );
    
    // Path 3: Sushiswap -> Uniswap
    await testPath(
      "Sushiswap -> Uniswap",
      sushiswapRouter,
      uniswapRouter,
      startToken,
      middleToken,
      startToken,
      loanAmount,
      requiredRepayment
    );
    
    // Path 4: Sushiswap -> Sushiswap
    await testPath(
      "Sushiswap -> Sushiswap",
      sushiswapRouter,
      sushiswapRouter,
      startToken,
      middleToken,
      startToken,
      loanAmount,
      requiredRepayment
    );
  }
}

async function testTrianglePaths(
  startToken: any,
  tokens: any[],
  loanAmount: BigNumber,
  requiredRepayment: BigNumber,
  uniswapRouter: Contract,
  sushiswapRouter: Contract
) {
  log(`\nTesting triangle paths (starting and ending with ${startToken.symbol}):`);
  
  // Get tokens that are not the start token
  const otherTokens = tokens.filter(t => t.address !== startToken.address);
  
  // Only proceed if we have at least 2 other tokens to form a triangle
  if (otherTokens.length < 2) {
    log(`Not enough tokens for triangle path`);
    return;
  }
  
  const middleToken1 = otherTokens[0];
  const middleToken2 = otherTokens[1];
  
  log(`\nTesting triangle path: ${startToken.symbol} -> ${middleToken1.symbol} -> ${middleToken2.symbol} -> ${startToken.symbol}`);
  
  // Eight possible paths with three tokens (2^3 combinations of exchanges)
  const exchanges = [
    { name: "Uniswap -> Uniswap -> Uniswap", routers: [uniswapRouter, uniswapRouter, uniswapRouter] },
    { name: "Uniswap -> Uniswap -> Sushiswap", routers: [uniswapRouter, uniswapRouter, sushiswapRouter] },
    { name: "Uniswap -> Sushiswap -> Uniswap", routers: [uniswapRouter, sushiswapRouter, uniswapRouter] },
    { name: "Uniswap -> Sushiswap -> Sushiswap", routers: [uniswapRouter, sushiswapRouter, sushiswapRouter] },
    { name: "Sushiswap -> Uniswap -> Uniswap", routers: [sushiswapRouter, uniswapRouter, uniswapRouter] },
    { name: "Sushiswap -> Uniswap -> Sushiswap", routers: [sushiswapRouter, uniswapRouter, sushiswapRouter] },
    { name: "Sushiswap -> Sushiswap -> Uniswap", routers: [sushiswapRouter, sushiswapRouter, uniswapRouter] },
    { name: "Sushiswap -> Sushiswap -> Sushiswap", routers: [sushiswapRouter, sushiswapRouter, sushiswapRouter] }
  ];
  
  // Test all exchange combinations for the triangle path
  for (const exchange of exchanges) {
    await testTrianglePath(
      exchange.name,
      exchange.routers[0],
      exchange.routers[1],
      exchange.routers[2],
      startToken,
      middleToken1,
      middleToken2,
      loanAmount,
      requiredRepayment
    );
  }
}

async function testPath(
  pathName: string,
  router1: Contract,
  router2: Contract,
  token1: any,
  token2: any,
  token3: any, // this will be the same as token1 for simple paths
  amountIn: BigNumber,
  requiredRepayment: BigNumber
) {
  try {
    // First trade
    const path1 = [token1.address, token2.address];
    const amountsOut1 = await router1.getAmountsOut(amountIn, path1);
    const middleAmount = amountsOut1[1];
    
    // Second trade
    const path2 = [token2.address, token3.address];
    const amountsOut2 = await router2.getAmountsOut(middleAmount, path2);
    const finalAmount = amountsOut2[1];
    
    // Calculate profit/loss
    const netResult = finalAmount.sub(requiredRepayment);
    const profitPercentage = netResult.mul(10000).div(amountIn).toNumber() / 100;
    
    if (netResult.gt(0)) {
      log(`✅ [${pathName}] PROFITABLE! ${token1.symbol} -> ${token2.symbol} -> ${token3.symbol}`);
      log(`   ${ethers.utils.formatUnits(amountIn, token1.decimals)} ${token1.symbol} -> ${ethers.utils.formatUnits(middleAmount, token2.decimals)} ${token2.symbol} -> ${ethers.utils.formatUnits(finalAmount, token3.decimals)} ${token3.symbol}`);
      log(`   Net profit: ${ethers.utils.formatUnits(netResult, token3.decimals)} ${token3.symbol} (${profitPercentage.toFixed(4)}%)`);
    } else {
      log(`❌ [${pathName}] Not profitable. ${token1.symbol} -> ${token2.symbol} -> ${token3.symbol}`);
      log(`   ${ethers.utils.formatUnits(amountIn, token1.decimals)} ${token1.symbol} -> ${ethers.utils.formatUnits(middleAmount, token2.decimals)} ${token2.symbol} -> ${ethers.utils.formatUnits(finalAmount, token3.decimals)} ${token3.symbol}`);
      log(`   Net loss: ${ethers.utils.formatUnits(netResult.mul(-1), token3.decimals)} ${token3.symbol} (${profitPercentage.toFixed(4)}%)`);
    }
  } catch (error) {
    log(`❌ [${pathName}] Error testing path ${token1.symbol} -> ${token2.symbol} -> ${token3.symbol}: ${error}`);
  }
}

async function testTrianglePath(
  pathName: string,
  router1: Contract,
  router2: Contract,
  router3: Contract,
  token1: any,
  token2: any,
  token3: any,
  amountIn: BigNumber,
  requiredRepayment: BigNumber
) {
  try {
    // First trade
    const path1 = [token1.address, token2.address];
    const amountsOut1 = await router1.getAmountsOut(amountIn, path1);
    const middleAmount1 = amountsOut1[1];
    
    // Second trade
    const path2 = [token2.address, token3.address];
    const amountsOut2 = await router2.getAmountsOut(middleAmount1, path2);
    const middleAmount2 = amountsOut2[1];
    
    // Third trade
    const path3 = [token3.address, token1.address];
    const amountsOut3 = await router3.getAmountsOut(middleAmount2, path3);
    const finalAmount = amountsOut3[1];
    
    // Calculate profit/loss
    const netResult = finalAmount.sub(requiredRepayment);
    const profitPercentage = netResult.mul(10000).div(amountIn).toNumber() / 100;
    
    if (netResult.gt(0)) {
      log(`✅ [${pathName}] PROFITABLE! ${token1.symbol} -> ${token2.symbol} -> ${token3.symbol} -> ${token1.symbol}`);
      log(`   ${ethers.utils.formatUnits(amountIn, token1.decimals)} ${token1.symbol} -> ` +
          `${ethers.utils.formatUnits(middleAmount1, token2.decimals)} ${token2.symbol} -> ` +
          `${ethers.utils.formatUnits(middleAmount2, token3.decimals)} ${token3.symbol} -> ` +
          `${ethers.utils.formatUnits(finalAmount, token1.decimals)} ${token1.symbol}`);
      log(`   Net profit: ${ethers.utils.formatUnits(netResult, token1.decimals)} ${token1.symbol} (${profitPercentage.toFixed(4)}%)`);
    } else {
      log(`❌ [${pathName}] Not profitable. ${token1.symbol} -> ${token2.symbol} -> ${token3.symbol} -> ${token1.symbol}`);
      log(`   ${ethers.utils.formatUnits(amountIn, token1.decimals)} ${token1.symbol} -> ` +
          `${ethers.utils.formatUnits(middleAmount1, token2.decimals)} ${token2.symbol} -> ` +
          `${ethers.utils.formatUnits(middleAmount2, token3.decimals)} ${token3.symbol} -> ` +
          `${ethers.utils.formatUnits(finalAmount, token1.decimals)} ${token1.symbol}`);
      log(`   Net loss: ${ethers.utils.formatUnits(netResult.mul(-1), token1.decimals)} ${token1.symbol} (${profitPercentage.toFixed(4)}%)`);
    }
  } catch (error) {
    log(`❌ [${pathName}] Error testing triangle path ${token1.symbol} -> ${token2.symbol} -> ${token3.symbol} -> ${token1.symbol}: ${error}`);
  }
}

// Run the main function
main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
