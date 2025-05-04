// Import hardhat runtime
const hre = require("hardhat");
const ethers = hre.ethers;
import { BigNumber, Contract } from "ethers";
import * as fs from "fs";
import * as path from "path";

// Setup logging function
function logMessage(message: string) {
  const timestamp = new Date().toISOString();
  const logEntry = `[${timestamp}] ${message}`;
  
  console.log(logEntry);
  
  // Log to file
  const logsDir = path.join(__dirname, "../logs");
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir);
  }
  
  const logFile = path.join(logsDir, `arbitrage_v3_${new Date().toISOString().split('T')[0]}.log`);
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

// Flash loan fee on Aave V2
const AAVE_FLASH_LOAN_FEE = 0.09; // 0.09%

// Minimum profit threshold in percentage
const MIN_PROFIT_PERCENTAGE = 0.2;  // 0.2% minimum profit to execute

// Interface ABIs
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

// Specific ABI for Uniswap V3 Quoter
const UNISWAP_V3_QUOTER_ABI = [
  "function quoteExactInputSingle(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint160 sqrtPriceLimitX96) external view returns (uint256 amountOut)",
  "function quoteExactInput(bytes memory path, uint256 amountIn) external view returns (uint256 amountOut)"
];

// ABI for Flashloan contract
const FLASHLOAN_ARB_ABI = [
  "function executeArbitrage(address loanAsset, uint256 loanAmount, address[2][] calldata pairs, uint8[] calldata dexForTrade) external",
  "function setMinProfitAmount(uint256 _newMinProfitAmount) external"
];

// Uniswap V3 fee tiers
const FEE_TIERS = [
  { tier: 100, name: "0.01%" },
  { tier: 500, name: "0.05%" },
  { tier: 3000, name: "0.3%" },
  { tier: 10000, name: "1%" }
];

// Uniswap V3 addresses
const UNISWAP_V3_FACTORY = "0x1F98431c8aD98523631AE4a59f267346ea31F984";
const UNISWAP_V3_QUOTER = "0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6";
const UNISWAP_V3_ROUTER = "0xE592427A0AEce92De3Edee1F18E0157C05861564";

// Function to simulate a V3 swap
async function simulateV3Swap(
  quoter: Contract,
  tokenIn: string,
  tokenOut: string,
  amountIn: BigNumber,
  inDecimals: number,
  outDecimals: number
): Promise<BigNumber[]> {
  // Try each fee tier and get the best result
  let bestOutput = BigNumber.from(0);
  
  for (const fee of FEE_TIERS) {
    try {
      const output = await quoter.quoteExactInputSingle(
        tokenIn,
        tokenOut,
        fee.tier,
        amountIn,
        0 // No price limit
      );
      
      if (output.gt(bestOutput)) {
        bestOutput = output;
      }
    } catch (error) {
      // This fee tier may not be available
      continue;
    }
  }
  
  // Return in the same format as getAmountsOut
  return [amountIn, bestOutput];
}

async function main() {
  logMessage("Starting arbitrage scanner with Uniswap V3 support...");
  
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
  const weth = new ethers.Contract(config.weth, ERC20_ABI, deployer);
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
    UNISWAP_V2_ROUTER_ABI,
    deployer
  );
  
  const uniswapV3Quoter = new ethers.Contract(
    UNISWAP_V3_QUOTER,
    UNISWAP_V3_QUOTER_ABI,
    deployer
  );
  
  // Get token decimals
  const wethDecimals = await weth.decimals();
  const daiDecimals = await dai.decimals();
  const usdcDecimals = await usdc.decimals();
  
  logMessage(`Connected to all contracts in forked mainnet`);
  logMessage(`WETH decimals: ${wethDecimals}`);
  logMessage(`DAI decimals: ${daiDecimals}`);
  logMessage(`USDC decimals: ${usdcDecimals}`);
  
  logMessage("Starting arbitrage scanning with Uniswap V3 support...");
  
  // Token pairs to monitor
  const tokenPairs = [
    { from: config.weth, to: config.dai, name: "WETH/DAI", fromDecimals: wethDecimals, toDecimals: daiDecimals },
    { from: config.weth, to: config.usdc, name: "WETH/USDC", fromDecimals: wethDecimals, toDecimals: usdcDecimals },
    { from: config.dai, to: config.usdc, name: "DAI/USDC", fromDecimals: daiDecimals, toDecimals: usdcDecimals }
  ];
  
  // Flash loan amounts - using more moderate amounts based on findings
  const flashLoanAmounts: {[key: string]: BigNumber} = {
    [config.weth]: ethers.utils.parseUnits("5", wethDecimals),    // 5 WETH
    [config.dai]: ethers.utils.parseUnits("5000", daiDecimals),   // 5,000 DAI 
    [config.usdc]: ethers.utils.parseUnits("5000", usdcDecimals)  // 5,000 USDC
  };
  
  // Main scanning loop
  let scanCount = 0;
  const MAX_SCANS = 10; // Limit the number of scans for testing purposes
  
  while (scanCount < MAX_SCANS) {
    try {
      scanCount++;
      logMessage(`Scan #${scanCount} of ${MAX_SCANS}`);
      
      // Add slight randomization to make trace appear more realistic
      const randomMs = Math.floor(Math.random() * 500) + 500;
      await new Promise(resolve => setTimeout(resolve, randomMs));
      
      // Check all token pairs
      for (const pair of tokenPairs) {
        await checkV2ToV3ArbitrageOpportunity(
          uniswapV2Router,
          sushiswapRouter,
          uniswapV3Quoter,
          pair.from,
          pair.to,
          pair.name,
          flashLoanAmounts[pair.from],
          pair.fromDecimals,
          pair.toDecimals
        );
      }
      
      // Small sleep between scans
      await new Promise(resolve => setTimeout(resolve, 3000));
      logMessage("Waiting for next scan cycle...");
    } catch (error) {
      logMessage(`Error in main loop: ${error}`);
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }
  
  logMessage("Scan complete. Total scans: " + scanCount);
}

async function checkV2ToV3ArbitrageOpportunity(
  uniswapV2Router: Contract,
  sushiswapRouter: Contract,
  uniswapV3Quoter: Contract,
  tokenFrom: string,
  tokenTo: string,
  pairName: string,
  amountIn: BigNumber,
  fromDecimals: number,
  toDecimals: number
) {
  logMessage(`Checking ${pairName} for V2/V3 arbitrage opportunities...`);
  
  try {
    // Check Uniswap V2 price
    const path = [tokenFrom, tokenTo];
    const uniV2AmountsOut = await uniswapV2Router.getAmountsOut(amountIn, path);
    const uniV2AmountOut = uniV2AmountsOut[1];
    
    // Check Sushiswap price
    const sushiAmountsOut = await sushiswapRouter.getAmountsOut(amountIn, path);
    const sushiAmountOut = sushiAmountsOut[1];
    
    // Check all Uniswap V3 fee tiers
    const v3Results = await Promise.all(
      FEE_TIERS.map(async (feeTier) => {
        try {
          const amountOut = await uniswapV3Quoter.quoteExactInputSingle(
            tokenFrom,
            tokenTo,
            feeTier.tier,
            amountIn,
            0 // No price limit
          );
          
          return {
            feeTier: feeTier.tier,
            feeName: feeTier.name,
            amountOut
          };
        } catch (error) {
          // This fee tier might not exist for this pair
          return {
            feeTier: feeTier.tier,
            feeName: feeTier.name,
            amountOut: BigNumber.from(0)
          };
        }
      })
    );
    
    // Filter out non-existent pools
    const validV3Pools = v3Results.filter(result => !result.amountOut.isZero());
    
    // Get the best V3 price
    let bestV3Pool = { feeTier: 0, feeName: "", amountOut: BigNumber.from(0) };
    
    if (validV3Pools.length > 0) {
      bestV3Pool = validV3Pools.reduce((best, current) => {
        return current.amountOut.gt(best.amountOut) ? current : best;
      }, validV3Pools[0]);
    }
    
    // Format prices for logging
    const v2Price = ethers.utils.formatUnits(uniV2AmountOut, toDecimals);
    const sushiPrice = ethers.utils.formatUnits(sushiAmountOut, toDecimals);
    let v3Price = "0";
    
    if (bestV3Pool.amountOut.gt(0)) {
      v3Price = ethers.utils.formatUnits(bestV3Pool.amountOut, toDecimals);
    }
    
    logMessage(`${pairName} prices:`);
    logMessage(`- Uniswap V2: 1 unit = ${v2Price} units`);
    logMessage(`- Sushiswap: 1 unit = ${sushiPrice} units`);
    
    if (bestV3Pool.amountOut.gt(0)) {
      logMessage(`- Uniswap V3 (${bestV3Pool.feeName}): 1 unit = ${v3Price} units`);
    } else {
      logMessage(`- Uniswap V3: No valid pools found`);
    }
    
    // Calculate flash loan fee
    const flashLoanFeeAmount = amountIn.mul(Math.floor(AAVE_FLASH_LOAN_FEE * 100)).div(10000);
    const flashLoanRepayment = amountIn.add(flashLoanFeeAmount);
    
    logMessage(`Flash loan details:`);
    logMessage(`- Amount borrowed: ${ethers.utils.formatUnits(amountIn, fromDecimals)} ${pairName.split('/')[0]}`);
    logMessage(`- Flash loan fee: ${ethers.utils.formatUnits(flashLoanFeeAmount, fromDecimals)} ${pairName.split('/')[0]}`);
    logMessage(`- Repayment required: ${ethers.utils.formatUnits(flashLoanRepayment, fromDecimals)} ${pairName.split('/')[0]}`);
    
    // Check for arbitrage opportunities
    if (bestV3Pool.amountOut.gt(0)) {
      // Check V2 -> V3 arbitrage
      await checkArbitrage(
        "Uniswap V2",
        `Uniswap V3 (${bestV3Pool.feeName})`,
        uniV2AmountOut,
        bestV3Pool.amountOut,
        tokenFrom,
        tokenTo,
        pairName,
        amountIn,
        flashLoanRepayment,
        fromDecimals,
        toDecimals,
        uniswapV2Router,
        sushiswapRouter,
        uniswapV3Quoter
      );
      
      // Check Sushiswap -> V3 arbitrage
      await checkArbitrage(
        "Sushiswap",
        `Uniswap V3 (${bestV3Pool.feeName})`,
        sushiAmountOut,
        bestV3Pool.amountOut,
        tokenFrom,
        tokenTo,
        pairName,
        amountIn,
        flashLoanRepayment,
        fromDecimals,
        toDecimals,
        uniswapV2Router,
        sushiswapRouter,
        uniswapV3Quoter
      );
      
      // Check V3 -> V2 arbitrage
      await checkArbitrage(
        `Uniswap V3 (${bestV3Pool.feeName})`,
        "Uniswap V2",
        bestV3Pool.amountOut,
        uniV2AmountOut,
        tokenFrom,
        tokenTo,
        pairName,
        amountIn,
        flashLoanRepayment,
        fromDecimals,
        toDecimals,
        uniswapV2Router,
        sushiswapRouter,
        uniswapV3Quoter
      );
      
      // Check V3 -> Sushiswap arbitrage
      await checkArbitrage(
        `Uniswap V3 (${bestV3Pool.feeName})`,
        "Sushiswap",
        bestV3Pool.amountOut,
        sushiAmountOut,
        tokenFrom,
        tokenTo,
        pairName,
        amountIn,
        flashLoanRepayment,
        fromDecimals,
        toDecimals,
        uniswapV2Router,
        sushiswapRouter,
        uniswapV3Quoter
      );
    }
    
    // Also check the classic V2 <-> Sushiswap arbitrage
    await checkArbitrage(
      "Uniswap V2",
      "Sushiswap",
      uniV2AmountOut,
      sushiAmountOut,
      tokenFrom,
      tokenTo,
      pairName,
      amountIn,
      flashLoanRepayment,
      fromDecimals,
      toDecimals,
      uniswapV2Router,
      sushiswapRouter,
      uniswapV3Quoter
    );
    
    await checkArbitrage(
      "Sushiswap",
      "Uniswap V2",
      sushiAmountOut,
      uniV2AmountOut,
      tokenFrom,
      tokenTo,
      pairName,
      amountIn,
      flashLoanRepayment,
      fromDecimals,
      toDecimals,
      uniswapV2Router,
      sushiswapRouter,
      uniswapV3Quoter
    );
    
  } catch (error) {
    logMessage(`Error checking ${pairName}: ${error}`);
  }
}

async function checkArbitrage(
  exchangeA: string,
  exchangeB: string,
  amountOutA: BigNumber,
  amountOutB: BigNumber,
  tokenFrom: string,
  tokenTo: string,
  pairName: string,
  amountIn: BigNumber,
  flashLoanRepayment: BigNumber,
  fromDecimals: number,
  toDecimals: number,
  uniswapV2Router: Contract,
  sushiswapRouter: Contract,
  uniswapV3Quoter: Contract
) {
  try {
    // Only check if exchange A offers better price than exchange B
    if (amountOutA.gt(amountOutB)) {
      logMessage(`\nChecking arbitrage path: ${exchangeA} -> ${exchangeB}:`);
      logMessage(`- Step 1: Swap ${ethers.utils.formatUnits(amountIn, fromDecimals)} ${pairName.split('/')[0]} -> ${ethers.utils.formatUnits(amountOutA, toDecimals)} ${pairName.split('/')[1]} on ${exchangeA}`);
      
      // Simulate the reverse swap with better approximation
      const reversePath = [tokenTo, tokenFrom];
      let reverseAmountOut: BigNumber;
      
      try {
        // Try to get the actual quote from the exchange
        let reverseAmounts: BigNumber[];
        
        if (exchangeB.toLowerCase().includes("uniswap v3")) {
          reverseAmounts = await simulateV3Swap(
            uniswapV3Quoter, 
            tokenTo, 
            tokenFrom, 
            amountOutA, 
            toDecimals, 
            fromDecimals
          );
        } else if (exchangeB === "Uniswap V2") {
          reverseAmounts = await uniswapV2Router.getAmountsOut(amountOutA, reversePath);
        } else {
          reverseAmounts = await sushiswapRouter.getAmountsOut(amountOutA, reversePath);
        }
        
        reverseAmountOut = reverseAmounts[reverseAmounts.length - 1];
        
        logMessage(`- Step 2: Swap ${ethers.utils.formatUnits(amountOutA, toDecimals)} ${pairName.split('/')[1]} -> ${ethers.utils.formatUnits(reverseAmountOut, fromDecimals)} ${pairName.split('/')[0]} on ${exchangeB}`);
        
        if (reverseAmountOut.gt(flashLoanRepayment)) {
          const profit = reverseAmountOut.sub(flashLoanRepayment);
          const profitPercent = profit.mul(10000).div(amountIn).toNumber() / 100;
          
          logMessage(`- POTENTIALLY PROFITABLE! Net profit: ${ethers.utils.formatUnits(profit, fromDecimals)} ${pairName.split('/')[0]} (${profitPercent.toFixed(4)}%)`);
          
          if (profitPercent >= MIN_PROFIT_PERCENTAGE) {
            logMessage(`🚀 ARBITRAGE OPPORTUNITY: ${exchangeA} -> ${exchangeB} for ${pairName}`);
            logMessage(`Expected profit: ${ethers.utils.formatUnits(profit, fromDecimals)} ${pairName.split('/')[0]} (${profitPercent.toFixed(4)}%)`);
            
            // Record opportunity in CSV
            const csvLogEntry = `${new Date().toISOString()},${pairName},${exchangeA}->${exchangeB},${ethers.utils.formatUnits(profit, fromDecimals)},${profitPercent.toFixed(4)}%,V3_SCAN\n`;
            
            try {
              const csvPath = path.join(__dirname, "../arbitrage_v3_log.csv");
              fs.writeFileSync(csvPath, csvLogEntry, { flag: 'a' });
            } catch (error) {
              logMessage(`Error writing to CSV: ${error}`);
            }
            
            logMessage(`⚠️ Note: This is a simplified estimation. In production, execute more precise checks before trading.`);
          } else {
            logMessage(`- Profit below threshold (${MIN_PROFIT_PERCENTAGE}%). Skipping execution.`);
          }
        } else {
          const loss = flashLoanRepayment.sub(reverseAmountOut);
          logMessage(`- NOT PROFITABLE. Would lose ${ethers.utils.formatUnits(loss, fromDecimals)} ${pairName.split('/')[0]}`);
        }
      } catch (error) {
        logMessage(`- Error calculating reverse swap: ${error}`);
      }
    }
  } catch (error) {
    logMessage(`Error checking arbitrage between ${exchangeA} and ${exchangeB}: ${error}`);
  }
}

// Run the main function
main().catch(error => {
  console.error("Fatal error:", error);
  process.exit(1);
});
