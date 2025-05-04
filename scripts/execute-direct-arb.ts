// Import hardhat runtime
const hre = require("hardhat");
const ethers = hre.ethers;
import { BigNumber } from "ethers";
import * as fs from "fs";
import * as path from "path";

// Setup logging function
function log(message: string) {
  const timestamp = new Date().toISOString();
  const logEntry = `[${timestamp}] ${message}`;
  
  console.log(logEntry);
  
  // Log to file
  const logFile = path.join(__dirname, "../logs", `direct_arb_execution_${new Date().toISOString().split('T')[0]}.log`);
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

// ABIs
const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function name() view returns (string)"
];

const FLASHLOAN_ARB_V2_ABI = [
  "function executeArbitrage(address loanAsset, uint256 loanAmount, address[] calldata path, uint8[] calldata dexForTrade, uint24[] calldata feeTiers) external",
  "function setMinProfitAmount(uint256 _newMinProfitAmount) external"
];

const ROUTER_ABI = [
  "function getAmountsOut(uint amountIn, address[] memory path) view returns (uint[] memory amounts)"
];

async function main() {
  log("Starting direct arbitrage execution script...");
  
  // Load configuration
  const config = loadForkConfig();
  
  if (!config.flashloanArbV2) {
    log("FlashloanArbV2 contract address not found in fork-config.json");
    log("Please run deploy-enhanced-arb.ts first.");
    process.exit(1);
  }
  
  log(`Loaded fork config with network ID: ${config.networkId}`);
  
  // Get signer
  const [deployer] = await ethers.getSigners();
  log(`Using account: ${deployer.address}`);
  
  // Connect to the FlashloanArbV2 contract
  const flashloanArbV2 = new ethers.Contract(
    config.flashloanArbV2,
    FLASHLOAN_ARB_V2_ABI,
    deployer
  );
  
  // Connect to token contracts
  const weth = new ethers.Contract(config.weth, ERC20_ABI, deployer);
  const dai = new ethers.Contract(config.dai, ERC20_ABI, deployer);
  
  // Connect to routers to check current prices
  const uniswapRouter = new ethers.Contract(config.uniswapV2Router, ROUTER_ABI, deployer);
  const sushiswapRouter = new ethers.Contract(config.sushiswapRouter, ROUTER_ABI, deployer);
  
  // Get token info
  const wethDecimals = await weth.decimals();
  const daiDecimals = await dai.decimals();
  const wethSymbol = await weth.symbol();
  const daiSymbol = await dai.symbol();
  
  log(`Token details:`);
  log(`- ${wethSymbol}: ${wethDecimals} decimals`);
  log(`- ${daiSymbol}: ${daiDecimals} decimals`);
  
  // Determine current prices on both DEXes
  const wethDaiPath = [config.weth, config.dai];
  const daiWethPath = [config.dai, config.weth];
  
  log("\nAnalyzing current market conditions...");
  
  // Check WETH -> DAI exchange rates
  const wethAmountIn = ethers.utils.parseUnits("1", wethDecimals);
  const wethToDaiUniswap = await uniswapRouter.getAmountsOut(wethAmountIn, wethDaiPath);
  const wethToDaiSushiswap = await sushiswapRouter.getAmountsOut(wethAmountIn, wethDaiPath);
  
  log(`1 WETH -> ${ethers.utils.formatUnits(wethToDaiUniswap[1], daiDecimals)} DAI on Uniswap`);
  log(`1 WETH -> ${ethers.utils.formatUnits(wethToDaiSushiswap[1], daiDecimals)} DAI on Sushiswap`);
  
  // Check DAI -> WETH exchange rates
  const daiAmountIn = ethers.utils.parseUnits("1000", daiDecimals);
  const daiToWethUniswap = await uniswapRouter.getAmountsOut(daiAmountIn, daiWethPath);
  const daiToWethSushiswap = await sushiswapRouter.getAmountsOut(daiAmountIn, daiWethPath);
  
  log(`1000 DAI -> ${ethers.utils.formatUnits(daiToWethUniswap[1], wethDecimals)} WETH on Uniswap`);
  log(`1000 DAI -> ${ethers.utils.formatUnits(daiToWethSushiswap[1], wethDecimals)} WETH on Sushiswap`);
  
  // Determine best arbitrage path
  const wethUniPrice = parseFloat(ethers.utils.formatUnits(wethToDaiUniswap[1], daiDecimals));
  const wethSushiPrice = parseFloat(ethers.utils.formatUnits(wethToDaiSushiswap[1], daiDecimals));
  
  const daiUniPrice = parseFloat(ethers.utils.formatUnits(daiToWethUniswap[1], wethDecimals)) / 1000;
  const daiSushiPrice = parseFloat(ethers.utils.formatUnits(daiToWethSushiswap[1], wethDecimals)) / 1000;
  
  // Check if WETH is cheaper on Uniswap
  const wethCheaperOnUniswap = daiUniPrice > daiSushiPrice;
  // Check if DAI is cheaper on Sushiswap
  const daiCheaperOnSushiswap = wethUniPrice > wethSushiPrice;
  
  log(`\nPrice analysis:`);
  if (wethCheaperOnUniswap) {
    log(`WETH is cheaper on Uniswap (${1/daiUniPrice} DAI per WETH vs ${1/daiSushiPrice} DAI per WETH on Sushiswap)`);
  } else {
    log(`WETH is cheaper on Sushiswap (${1/daiSushiPrice} DAI per WETH vs ${1/daiUniPrice} DAI per WETH on Uniswap)`);
  }
  
  if (daiCheaperOnSushiswap) {
    log(`DAI is cheaper on Sushiswap (${wethSushiPrice} DAI per WETH vs ${wethUniPrice} DAI per WETH on Uniswap)`);
  } else {
    log(`DAI is cheaper on Uniswap (${wethUniPrice} DAI per WETH vs ${wethSushiPrice} DAI per WETH on Sushiswap)`);
  }
  
  // Choose best flash loan asset and amount
  let loanAsset: string;
  let loanAmount: BigNumber;
  let path: string[];
  let dexForTrade: number[];
  
  if (wethCheaperOnUniswap && daiCheaperOnSushiswap) {
    // If WETH is cheaper on Uniswap and DAI is cheaper on Sushiswap
    log("\nBest arbitrage path: Borrow WETH -> Buy DAI on Uniswap -> Sell DAI for WETH on Sushiswap");
    
    loanAsset = config.weth;
    loanAmount = ethers.utils.parseUnits("10", wethDecimals); // 10 WETH
    path = [config.weth, config.dai, config.weth];
    dexForTrade = [0, 1]; // 0 = DEX A (Uniswap), 1 = DEX B (Sushiswap)
  } else {
    // Otherwise do the reverse
    log("\nBest arbitrage path: Borrow WETH -> Buy DAI on Sushiswap -> Sell DAI for WETH on Uniswap");
    
    loanAsset = config.weth;
    loanAmount = ethers.utils.parseUnits("10", wethDecimals); // 10 WETH
    path = [config.weth, config.dai, config.weth];
    dexForTrade = [1, 0]; // 1 = DEX B (Sushiswap), 0 = DEX A (Uniswap)
  }
  
  // Fee tiers are not relevant for V2 swaps
  const feeTiers = [0, 0];
  
  log(`\nExecuting arbitrage with ${ethers.utils.formatUnits(loanAmount, wethDecimals)} ${wethSymbol}`);
  log(`Path: ${wethSymbol} -> ${daiSymbol} -> ${wethSymbol}`);
  log(`DEXes: [${dexForTrade.map(d => d === 0 ? "Uniswap" : "Sushiswap").join(', ')}]`);
  
  try {
    // Estimate gas for transaction
    const gasEstimate = await flashloanArbV2.estimateGas.executeArbitrage(
      loanAsset,
      loanAmount,
      path,
      dexForTrade,
      feeTiers
    );
    
    log(`Gas estimate: ${gasEstimate.toString()}`);
    
    // Execute the transaction with high gas limit to ensure success
    const tx = await flashloanArbV2.executeArbitrage(
      loanAsset,
      loanAmount,
      path,
      dexForTrade,
      feeTiers,
      {
        gasLimit: gasEstimate.mul(120).div(100) // Add 20% buffer
      }
    );
    
    log(`Transaction sent! Hash: ${tx.hash}`);
    
    // Wait for transaction confirmation
    const receipt = await tx.wait();
    
    if (receipt.status === 1) {
      log(`✅ Transaction successful! Gas used: ${receipt.gasUsed.toString()}`);
      
      // Try to find ArbitrageExecuted event
      const iface = new ethers.utils.Interface([
        "event ArbitrageExecuted(address indexed tokenBorrowed, uint256 amountBorrowed, address indexed profitToken, uint256 profit, uint256 timestamp)"
      ]);
      
      for (const log of receipt.logs) {
        try {
          const event = iface.parseLog(log);
          if (event.name === "ArbitrageExecuted") {
            const profitAmount = ethers.utils.formatUnits(event.args.profit, wethDecimals);
            log(`🚀 Arbitrage successful! Profit: ${profitAmount} ${wethSymbol}`);
          }
        } catch (e) {
          // Not an ArbitrageExecuted event
        }
      }
    } else {
      log(`❌ Transaction failed`);
    }
  } catch (error: any) {
    log(`❌ Error executing arbitrage: ${error.message || error}`);
    
    if (error.message && error.message.includes("Insufficient profit")) {
      log(`The arbitrage would not be profitable with the current market conditions.`);
      log(`Try creating a larger imbalance with npm run direct:arb or reduce the minimum profit threshold.`);
    }
  }
}

// Run the main function
main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
