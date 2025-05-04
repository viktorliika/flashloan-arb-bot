import { BigNumber, providers, Wallet, Contract } from "ethers";
import * as dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";

// Load environment variables from .env file
dotenv.config();

// Create logs directory if it doesn't exist
const logsDir = path.join(__dirname, "../logs");
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir);
}

// Setup logging function
function logMessage(message: string, logToFile = true) {
  const timestamp = new Date().toISOString();
  const logEntry = `[${timestamp}] ${message}`;
  
  console.log(logEntry);
  
  if (logToFile) {
    const logFile = path.join(logsDir, `arbitrage_${new Date().toISOString().split('T')[0]}.log`);
    fs.appendFileSync(logFile, logEntry + '\n');
  }
}

// Load contract ABI
const FlashloanArbArtifact = require("../artifacts/contracts/FlashloanArb.sol/FlashloanArb.json");

// Config - Update these values
const PRIVATE_KEY = process.env.PRIVATE_KEY || "";
const RPC_URL = process.env.GOERLI_RPC_URL || "";
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS || "";

// Token addresses on Goerli testnet
const DAI_ADDRESS = "0xdf1742fe5b0bfc12331d8eaec6b478dfdbd31464";
const WETH_ADDRESS = "0xb4fbf271143f4fbf7b91a5ded31805e42b2208d6";
const USDC_ADDRESS = "0x07865c6e87b9f70255377e024ace6630c1eaa37f";

// DEX router addresses
const UNISWAP_ROUTER = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";
const SUSHISWAP_ROUTER = "0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506";

// Uniswap Router ABI (minimal interface for price checking)
const ROUTER_ABI = [
  "function getAmountsOut(uint amountIn, address[] memory path) public view returns (uint[] memory amounts)"
];

// Minimum profit threshold in percentage (e.g., 1 = 1%)
const MIN_PROFIT_PERCENTAGE = 1.0;

// Flash loan amount in DAI (100 DAI)
const FLASH_LOAN_AMOUNT = BigNumber.from("100000000000000000000");

// Aave flash loan fee in percentage
const AAVE_FLASH_LOAN_FEE = 0.09; // 0.09%

async function main() {
  logMessage("Starting arbitrage scanner...");

  if (!PRIVATE_KEY || !RPC_URL || !CONTRACT_ADDRESS) {
    logMessage("Missing environment variables. Please check your .env file.");
    return;
  }

  // Setup provider and wallet
  const provider = new providers.JsonRpcProvider(RPC_URL);
  const wallet = new Wallet(PRIVATE_KEY, provider);
  const address = await wallet.getAddress();
  logMessage(`Using wallet address: ${address}`);

  // Connect to the flashloan arbitrage contract
  const flashloanContract = new Contract(
    CONTRACT_ADDRESS,
    FlashloanArbArtifact.abi,
    wallet
  );

  // Connect to DEX routers
  const uniswapRouter = new Contract(UNISWAP_ROUTER, ROUTER_ABI, provider);
  const sushiswapRouter = new Contract(SUSHISWAP_ROUTER, ROUTER_ABI, provider);

  logMessage("Connected to contracts. Starting arbitrage scanning...");
  logMessage(`Monitoring DAI/WETH and WETH/USDC pairs on Uniswap and Sushiswap`);
  logMessage(`Minimum profit threshold: ${MIN_PROFIT_PERCENTAGE}%`);

  // Set up pairs for monitoring
  const tokenPairs = [
    { from: DAI_ADDRESS, to: WETH_ADDRESS, name: "DAI/WETH" },
    { from: WETH_ADDRESS, to: USDC_ADDRESS, name: "WETH/USDC" },
    { from: DAI_ADDRESS, to: USDC_ADDRESS, name: "DAI/USDC" }
  ];

  // Main scanning loop
  while (true) {
    try {
      // Check each token pair for arbitrage opportunities
      for (const pair of tokenPairs) {
        await checkArbitrageOpportunity(
          uniswapRouter,
          sushiswapRouter,
          pair.from,
          pair.to,
          pair.name,
          flashloanContract
        );
      }

      // Wait before next check
      logMessage("Waiting for next scan...");
      await new Promise(resolve => setTimeout(resolve, 10000)); // 10 seconds delay
    } catch (error) {
      logMessage(`Error in scanning loop: ${error}`);
      // Wait before retry
      await new Promise(resolve => setTimeout(resolve, 10000));
    }
  }
}

async function checkArbitrageOpportunity(
  uniswapRouter: Contract,
  sushiswapRouter: Contract,
  tokenFrom: string,
  tokenTo: string,
  pairName: string,
  flashloanContract: Contract
) {
  logMessage(`Checking ${pairName} pair...`);

  try {
    // Check prices on both DEXes
    const amountIn = FLASH_LOAN_AMOUNT;
    
    // Create token path
    const path = [tokenFrom, tokenTo];
    
    // Get amounts out from Uniswap
    const uniswapAmountsOut = await uniswapRouter.getAmountsOut(amountIn, path);
    const uniswapAmountOut = uniswapAmountsOut[1];
    
    // Get amounts out from Sushiswap
    const sushiswapAmountsOut = await sushiswapRouter.getAmountsOut(amountIn, path);
    const sushiswapAmountOut = sushiswapAmountsOut[1];

    logMessage(`${pairName} prices:`);
    logMessage(`- Uniswap: 1 ${tokenFrom.substring(0, 6)}... = ${formatUnits(uniswapAmountOut, 18)} ${tokenTo.substring(0, 6)}...`);
    logMessage(`- Sushiswap: 1 ${tokenFrom.substring(0, 6)}... = ${formatUnits(sushiswapAmountOut, 18)} ${tokenTo.substring(0, 6)}...`);

    // Check if there's a price difference that can be exploited
    let profitPath: { dex: string, router: string }[] = [];
    let expectedProfit = BigNumber.from(0);
    let flashLoanRepayment = amountIn.mul(10000 + Math.floor(AAVE_FLASH_LOAN_FEE * 100)).div(10000);

    // Check Uniswap -> Sushiswap path
    if (uniswapAmountOut.gt(sushiswapAmountOut)) {
      // Buy on Uniswap, sell on Sushiswap
      const reversePath = [tokenTo, tokenFrom];
      const sushiBackAmounts = await sushiswapRouter.getAmountsOut(uniswapAmountOut, reversePath);
      const finalAmount = sushiBackAmounts[1];
      
      if (finalAmount.gt(flashLoanRepayment)) {
        profitPath = [
          { dex: "Uniswap", router: UNISWAP_ROUTER },
          { dex: "Sushiswap", router: SUSHISWAP_ROUTER }
        ];
        expectedProfit = finalAmount.sub(flashLoanRepayment);
      }
    } 
    // Check Sushiswap -> Uniswap path
    else if (sushiswapAmountOut.gt(uniswapAmountOut)) {
      // Buy on Sushiswap, sell on Uniswap
      const reversePath = [tokenTo, tokenFrom];
      const uniBackAmounts = await uniswapRouter.getAmountsOut(sushiswapAmountOut, reversePath);
      const finalAmount = uniBackAmounts[1];
      
      if (finalAmount.gt(flashLoanRepayment)) {
        profitPath = [
          { dex: "Sushiswap", router: SUSHISWAP_ROUTER },
          { dex: "Uniswap", router: UNISWAP_ROUTER }
        ];
        expectedProfit = finalAmount.sub(flashLoanRepayment);
      }
    }

    // If profitable opportunity found
    if (profitPath.length > 0 && expectedProfit.gt(0)) {
      const profitPercentage = expectedProfit.mul(100).div(amountIn).toNumber() / 100;
      
      logMessage(`ARBITRAGE OPPORTUNITY FOUND!`);
      logMessage(`Path: ${profitPath[0].dex} -> ${profitPath[1].dex}`);
      logMessage(`Expected profit: ${formatUnits(expectedProfit, 18)} (${profitPercentage}%)`);
      
      // Check if profit meets minimum threshold
      if (profitPercentage >= MIN_PROFIT_PERCENTAGE) {
        logMessage(`Profit exceeds threshold. Executing arbitrage...`);
        
        // Prepare the pairs and dex indicators for the contract call
        const pairs: [string, string][] = [
          [tokenFrom, tokenTo],
          [tokenTo, tokenFrom]
        ];
        
        // 0 for DEX A (Uniswap), 1 for DEX B (Sushiswap)
        const dexIndicators = [
          profitPath[0].dex === "Uniswap" ? 0 : 1,
          profitPath[1].dex === "Uniswap" ? 0 : 1
        ];
        
        // Execute the arbitrage via the smart contract
        try {
          logMessage("Sending transaction...");
          const tx = await flashloanContract.executeArbitrage(
            tokenFrom,
            amountIn,
            pairs,
            dexIndicators,
            { gasLimit: 1000000 } // Adjust as needed
          );
          
          logMessage(`Transaction sent: ${tx.hash}`);
          logMessage("Waiting for confirmation...");
          
          const receipt = await tx.wait();
          logMessage(`Transaction confirmed in block ${receipt.blockNumber}`);
          logMessage(`Gas used: ${receipt.gasUsed.toString()}`);
          
          // Log to a file for record keeping
          const csvLogEntry = `${new Date().toISOString()}, ${pairName}, ${profitPath[0].dex}->${profitPath[1].dex}, ${formatUnits(expectedProfit, 18)}, ${profitPercentage}%, ${tx.hash}\n`;
          fs.appendFileSync(path.join(__dirname, "../arbitrage_log.csv"), csvLogEntry);
        } catch (error) {
          logMessage(`Error executing arbitrage: ${error}`);
        }
      } else {
        logMessage(`Profit below threshold (${MIN_PROFIT_PERCENTAGE}%). Skipping execution.`);
      }
    } else {
      logMessage("No profitable arbitrage opportunity found at this time.");
    }
  } catch (error) {
    logMessage(`Error checking ${pairName} pair: ${error}`);
  }
}

// Utility function to format units (similar to ethers.utils.formatUnits)
function formatUnits(value: BigNumber, decimals: number): string {
  const divisor = BigNumber.from(10).pow(decimals);
  const quotient = value.div(divisor);
  const remainder = value.mod(divisor);
  
  let result = quotient.toString();
  if (remainder.gt(0)) {
    const remainderStr = remainder.toString().padStart(decimals, "0");
    result += "." + remainderStr.replace(/0+$/, "");
  }
  
  return result;
}

// Run the main function and handle errors
main().catch(error => {
  logMessage(`Fatal error: ${error}`);
  process.exit(1);
});
