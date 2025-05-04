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
  const logFile = path.join(__dirname, "../logs", `triangle_arb_${new Date().toISOString().split('T')[0]}.log`);
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
  "function executeTriangleArbitrage(address loanAsset, uint256 loanAmount, address[] calldata path, uint8[] calldata dexes, uint24[] calldata fees) external",
  "function executeArbitrage(address loanAsset, uint256 loanAmount, address[] calldata path, uint8[] calldata dexForTrade, uint24[] calldata feeTiers) external",
  "function setMinProfitAmount(uint256 _newMinProfitAmount) external"
];

// Uniswap V3 fee tiers
const FEE_TIERS = {
  LOWEST: 100,    // 0.01%
  LOW: 500,       // 0.05%
  MEDIUM: 3000,   // 0.3%
  HIGH: 10000     // 1%
};

// DEX indices
const DEX = {
  UNISWAP_V2: 0,
  SUSHISWAP: 1,
  UNISWAP_V3: 2
};

async function main() {
  log("Starting triangle arbitrage execution script...");
  
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
  
  // Choose which token to use for flash loan
  const loanAsset = config.weth;
  const loanAmount = ethers.utils.parseUnits("10", wethDecimals); // 10 WETH
  
  log(`\nPreparing triangle arbitrage with ${ethers.utils.formatUnits(loanAmount, wethDecimals)} ${wethSymbol}`);
  
  // Define the triangle path: WETH -> DAI -> USDC -> WETH
  const path = [
    config.weth,
    config.dai,
    config.usdc,
    config.weth
  ];
  
  // Set which DEX to use for each hop in the path
  // 0 = DEX A (configured as Uniswap V2 in deploy script)
  // 1 = DEX B (configured as Sushiswap in deploy script)
  
  // Try different DEX combinations for triangle arbitrage
  const dexCombinations = [
    {
      name: "Uniswap V2 -> Uniswap V2 -> Uniswap V3",
      dexes: [0, 0, 2]
    },
    {
      name: "Uniswap V2 -> Sushiswap -> Uniswap V3",
      dexes: [0, 1, 2]
    },
    {
      name: "Sushiswap -> Uniswap V2 -> Uniswap V3",
      dexes: [1, 0, 2]
    },
    {
      name: "Uniswap V3 -> Uniswap V2 -> Sushiswap",
      dexes: [2, 0, 1]
    }
  ];
  
  // Try each DEX combination
  for (const combo of dexCombinations) {
    log(`\nTrying DEX combination: ${combo.name}`);
    
    // Convert the DEX identifiers to the format expected by the contract
    // 0 = DEX A (Uniswap V2 or V3 depending on how you configured it)
    // 1 = DEX B (Sushiswap)
    const dexes = combo.dexes.map(dex => {
      if (dex === DEX.UNISWAP_V2 || dex === DEX.UNISWAP_V3) {
        return 0; // DEX A
      } else {
        return 1; // DEX B
      }
    });
    
    // Set fee tiers for each swap
    // 0 = Use default fee tier (for V2 swaps)
    // Set appropriate fee tier for V3 swaps
    const fees = combo.dexes.map(dex => {
      if (dex === DEX.UNISWAP_V3) {
        // Choose different fee tiers based on the tokens
        if (path[0] === config.dai && path[1] === config.usdc) {
          return FEE_TIERS.LOW; // 0.05% for stablecoin pairs
        } else {
          return FEE_TIERS.MEDIUM; // 0.3% for other pairs
        }
      } else {
        return 0; // Use default fee tier for V2 swaps
      }
    });
    
    log(`Executing triangle arbitrage with path: ${wethSymbol} -> ${daiSymbol} -> ${usdcSymbol} -> ${wethSymbol}`);
    log(`DEXes: [${dexes.join(', ')}]`);
    log(`Fee tiers: [${fees.join(', ')}]`);
    
    try {
      // Estimate gas for the transaction
      const gasEstimate = await flashloanArbV2.estimateGas.executeTriangleArbitrage(
        loanAsset,
        loanAmount,
        path,
        dexes,
        fees
      );
      
      log(`Gas estimate: ${gasEstimate.toString()}`);
      
      // Execute the triangle arbitrage
      const tx = await flashloanArbV2.executeTriangleArbitrage(
        loanAsset,
        loanAmount,
        path,
        dexes,
        fees,
        {
          gasLimit: gasEstimate.mul(120).div(100) // Add 20% buffer
        }
      );
      
      log(`Transaction sent! Hash: ${tx.hash}`);
      
      // Wait for the transaction to be mined
      const receipt = await tx.wait();
      
      // Check if transaction was successful
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
              const profit = ethers.utils.formatUnits(event.args.profit, wethDecimals);
              log(`🚀 Arbitrage successful! Profit: ${profit} ${wethSymbol}`);
            }
          } catch (e) {
            // Not an ArbitrageExecuted event
          }
        }
      } else {
        log(`❌ Transaction failed`);
      }
    } catch (error: any) {
      log(`❌ Error executing triangle arbitrage: ${error.message || error}`);
      
      // If the error message includes "Insufficient profit", it means the trade would be unprofitable
      if (error.message && error.message.includes("Insufficient profit")) {
        log(`The arbitrage would not be profitable with the current market conditions.`);
      }
      
      // If it's a transaction underpriced error, suggest increasing gas price
      if (error.message && error.message.includes("underpriced")) {
        log(`Try increasing the gas price for your transaction.`);
      }
    }
  }
  
  log("\nTriangle arbitrage execution attempts completed.");
  log("If all attempts failed, try:");
  log("1. Running create-arb-opportunity.ts first to create artificial price differences");
  log("2. Adjusting the loan amount or trying different token paths");
  log("3. Checking that the DEX routers are properly configured in the contract");
}

// Run the main function
main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
