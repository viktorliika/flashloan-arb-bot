// Import hardhat runtime
const hre = require("hardhat");
const ethers = hre.ethers;
import { BigNumber, Contract } from "ethers";
import * as fs from "fs";
import * as path from "path";

// Import our utility modules
import { CurveAdapter } from "./utils/curve-adapter";
import { DynamicGasStrategy } from "./utils/gas-strategy";
import { OpportunityValidator, ArbitrageOpportunity } from "./utils/opportunity-validator";
import { TransactionExecutor } from "./utils/transaction-executor";
import { CoinGeckoPriceProvider, tokenAmountToUsd } from "./utils/price-feed";

// Setup logging function
function log(message: string) {
  const timestamp = new Date().toISOString();
  const logEntry = `[${timestamp}] ${message}`;
  
  console.log(logEntry);
  
  // Log to file
  const logsDir = path.join(__dirname, "../logs");
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir);
  }
  
  const logFile = path.join(logsDir, `curve_arb_${new Date().toISOString().split('T')[0]}.log`);
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
const MIN_PROFIT_USD = 10;          // $10 minimum profit to execute

// ABIs
const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function name() view returns (string)",
  "function approve(address spender, uint256 amount) returns (bool)"
];

const UNISWAP_V2_ROUTER_ABI = [
  "function getAmountsOut(uint amountIn, address[] memory path) public view returns (uint[] memory amounts)",
  "function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)"
];

const UNISWAP_V3_QUOTER_ABI = [
  "function quoteExactInputSingle(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint160 sqrtPriceLimitX96) external view returns (uint256 amountOut)"
];

const FLASHLOAN_ARB_V2_ABI = [
  "function executeArbitrage(address loanAsset, uint256 loanAmount, address[] calldata path, uint8[] calldata dexForTrade, uint24[] calldata feeTiers) external",
  "function executeTriangleArbitrage(address loanAsset, uint256 loanAmount, address[] calldata path, uint8[] calldata dexes, uint24[] calldata fees) external",
  "function setMinProfitAmount(uint256 _newMinProfitAmount) external"
];

// Uniswap V3 fee tiers
const FEE_TIERS = [
  { tier: 100, name: "0.01%" },
  { tier: 500, name: "0.05%" },
  { tier: 3000, name: "0.3%" },
  { tier: 10000, name: "1%" }
];

// Token price in USD for approximate profit calculation
const TOKEN_PRICES_USD: { [key: string]: number } = {
  WETH: 3000,
  DAI: 1,
  USDC: 1,
  USDT: 1
};

async function main() {
  log("Starting Curve arbitrage scanner...");
  
  // Load fork configuration
  const config = loadForkConfig();
  log(`Loaded fork config with network ID: ${config.networkId}`);
  
  // Get signer
  const [deployer] = await ethers.getSigners();
  log(`Using account: ${deployer.address}`);
  
  // Initialize our utility modules
  const curveAdapter = new CurveAdapter(ethers.provider);
  const gasStrategy = new DynamicGasStrategy(20); // 20% max gas percentage
  const validator = new OpportunityValidator(
    gasStrategy,
    MIN_PROFIT_USD,                  // $10 min profit
    2,                               // 2% slippage tolerance
    MIN_PROFIT_PERCENTAGE            // 0.2% min profit percentage
  );
  const executor = new TransactionExecutor(
    ethers.provider,
    gasStrategy,
    3,                // 3 retry attempts
    2000,             // 2s backoff
    false             // Not using Flashbots for testing
  );
  
  // Connect to the FlashloanArbV2 contract
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
        FLASHLOAN_ARB_V2_ABI,
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
    config.uniswapV3Quoter || "0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6", // Use default if not in config
    UNISWAP_V3_QUOTER_ABI,
    deployer
  );
  
  // Get token decimals
  const wethDecimals = await weth.decimals();
  const daiDecimals = await dai.decimals();
  const usdcDecimals = await usdc.decimals();
  
  log(`WETH decimals: ${wethDecimals}`);
  log(`DAI decimals: ${daiDecimals}`);
  log(`USDC decimals: ${usdcDecimals}`);
  
  // Flash loan amounts 
  const flashLoanAmounts: {[key: string]: BigNumber} = {
    [config.weth]: ethers.utils.parseUnits("5", wethDecimals),    // 5 WETH
    [config.dai]: ethers.utils.parseUnits("5000", daiDecimals),   // 5,000 DAI 
    [config.usdc]: ethers.utils.parseUnits("5000", usdcDecimals)  // 5,000 USDC
  };
  
  // Token pairs to monitor
  const tokenPairs = [
    { 
      from: config.weth, 
      to: config.dai, 
      name: "WETH/DAI", 
      fromDecimals: wethDecimals, 
      toDecimals: daiDecimals,
      fromUsdPrice: TOKEN_PRICES_USD.WETH,
      toUsdPrice: TOKEN_PRICES_USD.DAI
    },
    { 
      from: config.weth, 
      to: config.usdc, 
      name: "WETH/USDC", 
      fromDecimals: wethDecimals, 
      toDecimals: usdcDecimals,
      fromUsdPrice: TOKEN_PRICES_USD.WETH,
      toUsdPrice: TOKEN_PRICES_USD.USDC
    },
    { 
      from: config.dai, 
      to: config.usdc, 
      name: "DAI/USDC", 
      fromDecimals: daiDecimals, 
      toDecimals: usdcDecimals,
      fromUsdPrice: TOKEN_PRICES_USD.DAI,
      toUsdPrice: TOKEN_PRICES_USD.USDC
    }
  ];
  
  log("Starting arbitrage scanning between Curve and other DEXs...");
  
  // Main scanning loop
  let scanCount = 0;
  const MAX_SCANS = 10; // Limit the number of scans for testing purposes
  
  while (scanCount < MAX_SCANS) {
    try {
      scanCount++;
      log(`Scan #${scanCount} of ${MAX_SCANS}`);
      
      // Check all token pairs
      for (const pair of tokenPairs) {
        await checkCurveArbitrageOpportunity(
          curveAdapter,
          uniswapV2Router,
          sushiswapRouter,
          uniswapV3Quoter,
          pair.from,
          pair.to,
          pair.name,
          flashLoanAmounts[pair.from],
          pair.fromDecimals,
          pair.toDecimals,
          pair.fromUsdPrice,
          // For testing - run validation but don't execute
          false, 
          validator,
          executor,
          arbContract,
          deployer
        );
      }
      
      // Sleep between scans
      await new Promise(resolve => setTimeout(resolve, 3000));
      log("Waiting for next scan cycle...");
    } catch (error) {
      log(`Error in main loop: ${error}`);
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }
  
  log("Scan complete. Total scans: " + scanCount);
}

/**
 * Check for arbitrage opportunities between Curve and other DEXs
 */
async function checkCurveArbitrageOpportunity(
  curveAdapter: CurveAdapter,
  uniswapV2Router: Contract,
  sushiswapRouter: Contract,
  uniswapV3Quoter: Contract,
  tokenFrom: string,
  tokenTo: string,
  pairName: string,
  amountIn: BigNumber,
  fromDecimals: number,
  toDecimals: number,
  tokenPriceUsd: number,
  executeIfProfitable: boolean,
  validator: OpportunityValidator,
  executor: TransactionExecutor,
  arbContract: Contract,
  signer: any
) {
  log(`\nChecking ${pairName} for Curve arbitrage opportunities...`);
  
  try {
    // Step 1: Find the best Curve pool for this pair
    const curvePool = await curveAdapter.findBestPool(tokenFrom, tokenTo);
    if (!curvePool) {
      log(`No Curve pool found for ${pairName}`);
      return;
    }
    
    log(`Found Curve pool at ${curvePool.poolAddress} for ${pairName}`);
    log(`Token indices: ${curvePool.tokenAIndex}, ${curvePool.tokenBIndex}`);
    
    // Step 2: Get the amount out from Curve
    const curveAmountOut = await curveAdapter.getAmountOut(
      curvePool.poolAddress,
      curvePool.tokenAIndex,
      curvePool.tokenBIndex,
      amountIn
    );
    
    // Step 3: Get amounts out from other DEXs
    // Uniswap V2
    const uniV2Path = [tokenFrom, tokenTo];
    const uniV2AmountsOut = await uniswapV2Router.getAmountsOut(amountIn, uniV2Path);
    const uniV2AmountOut = uniV2AmountsOut[1];
    
    // Sushiswap
    const sushiAmountsOut = await sushiswapRouter.getAmountsOut(amountIn, uniV2Path);
    const sushiAmountOut = sushiAmountsOut[1];
    
    // Uniswap V3 (try all fee tiers and get the best)
    let bestV3AmountOut = BigNumber.from(0);
    let bestV3Fee = 0;
    
    for (const feeTier of FEE_TIERS) {
      try {
        const v3AmountOut = await uniswapV3Quoter.quoteExactInputSingle(
          tokenFrom,
          tokenTo,
          feeTier.tier,
          amountIn,
          0 // No price limit
        );
        
        if (v3AmountOut.gt(bestV3AmountOut)) {
          bestV3AmountOut = v3AmountOut;
          bestV3Fee = feeTier.tier;
        }
      } catch (error) {
        // This fee tier might not exist for this pair
        continue;
      }
    }
    
    // Step 4: Log all prices for comparison
    log(`${pairName} prices for ${ethers.utils.formatUnits(amountIn, fromDecimals)} input:`);
    log(`- Curve: ${ethers.utils.formatUnits(curveAmountOut, toDecimals)}`);
    log(`- Uniswap V2: ${ethers.utils.formatUnits(uniV2AmountOut, toDecimals)}`);
    log(`- Sushiswap: ${ethers.utils.formatUnits(sushiAmountOut, toDecimals)}`);
    
    if (bestV3AmountOut.gt(0)) {
      log(`- Uniswap V3 (${bestV3Fee}): ${ethers.utils.formatUnits(bestV3AmountOut, toDecimals)}`);
    } else {
      log(`- Uniswap V3: No valid pools found`);
    }
    
    // Step 5: Calculate flash loan fee for repayment
    const flashLoanFeeAmount = amountIn.mul(Math.floor(AAVE_FLASH_LOAN_FEE * 100)).div(10000);
    const flashLoanRepayment = amountIn.add(flashLoanFeeAmount);
    
    log(`\nFlash loan details:`);
    log(`- Amount borrowed: ${ethers.utils.formatUnits(amountIn, fromDecimals)}`);
    log(`- Flash loan fee: ${ethers.utils.formatUnits(flashLoanFeeAmount, fromDecimals)}`);
    log(`- Repayment required: ${ethers.utils.formatUnits(flashLoanRepayment, fromDecimals)}`);
    
    // Step 6: Check arbitrage opportunities
    
    // 6.1 - Curve -> Uniswap V2
    if (curveAmountOut.gt(uniV2AmountOut)) {
      await checkReversePath(
        "Curve",
        "Uniswap V2",
        curveAmountOut,
        tokenFrom,
        tokenTo,
        pairName,
        amountIn,
        flashLoanRepayment,
        fromDecimals,
        toDecimals,
        uniswapV2Router,
        tokenPriceUsd,
        executeIfProfitable,
        validator,
        executor, 
        arbContract,
        signer
      );
    }
    
    // 6.2 - Curve -> Sushiswap
    if (curveAmountOut.gt(sushiAmountOut)) {
      await checkReversePath(
        "Curve",
        "Sushiswap",
        curveAmountOut,
        tokenFrom,
        tokenTo,
        pairName,
        amountIn,
        flashLoanRepayment,
        fromDecimals,
        toDecimals,
        sushiswapRouter,
        tokenPriceUsd,
        executeIfProfitable,
        validator,
        executor,
        arbContract,
        signer
      );
    }
    
    // 6.3 - Curve -> Uniswap V3
    if (curveAmountOut.gt(bestV3AmountOut) && bestV3AmountOut.gt(0)) {
      // For V3, we would need to implement additional logic
      log(`Potential Curve -> Uniswap V3 arbitrage for ${pairName}`);
      log(`Further implementation needed for V3 reverse path check`);
    }
    
    // 6.4 - Uniswap V2 -> Curve
    if (uniV2AmountOut.gt(curveAmountOut)) {
      // For this direction, we would execute on Uniswap V2 and then reverse on Curve
      log(`Checking arbitrage path: Uniswap V2 -> Curve for ${pairName}`);
      
      // Simulate reverse swap on Curve
      const curveReverseAmountOut = await curveAdapter.getAmountOut(
        curvePool.poolAddress,
        curvePool.tokenBIndex, // Reversed!
        curvePool.tokenAIndex, // Reversed!
        uniV2AmountOut
      );
      
      await processArbitrageResult(
        "Uniswap V2",
        "Curve",
        uniV2AmountOut,
        curveReverseAmountOut,
        tokenFrom,
        tokenTo,
        pairName,
        amountIn,
        flashLoanRepayment,
        fromDecimals,
        toDecimals,
        tokenPriceUsd,
        executeIfProfitable,
        validator,
        executor,
        arbContract,
        signer
      );
    }
    
    // 6.5 - Sushiswap -> Curve
    if (sushiAmountOut.gt(curveAmountOut)) {
      log(`Checking arbitrage path: Sushiswap -> Curve for ${pairName}`);
      
      // Simulate reverse swap on Curve
      const curveReverseAmountOut = await curveAdapter.getAmountOut(
        curvePool.poolAddress,
        curvePool.tokenBIndex, // Reversed!
        curvePool.tokenAIndex, // Reversed!
        sushiAmountOut
      );
      
      await processArbitrageResult(
        "Sushiswap",
        "Curve",
        sushiAmountOut,
        curveReverseAmountOut,
        tokenFrom,
        tokenTo,
        pairName,
        amountIn,
        flashLoanRepayment,
        fromDecimals,
        toDecimals,
        tokenPriceUsd,
        executeIfProfitable,
        validator,
        executor,
        arbContract,
        signer
      );
    }
    
    // 6.6 - Uniswap V3 -> Curve
    if (bestV3AmountOut.gt(curveAmountOut) && bestV3AmountOut.gt(0)) {
      // For V3, we would need to implement additional logic
      log(`Potential Uniswap V3 -> Curve arbitrage for ${pairName}`);
      log(`Further implementation needed for V3 path check`);
    }
    
  } catch (error) {
    log(`Error checking ${pairName} for Curve arbitrage: ${error}`);
  }
}

async function checkReversePath(
  exchangeA: string,
  exchangeB: string,
  amountOutA: BigNumber,
  tokenFrom: string,
  tokenTo: string,
  pairName: string,
  amountIn: BigNumber,
  flashLoanRepayment: BigNumber,
  fromDecimals: number,
  toDecimals: number,
  routerB: Contract,
  tokenPriceUsd: number,
  executeIfProfitable: boolean,
  validator: OpportunityValidator,
  executor: TransactionExecutor,
  arbContract: Contract,
  signer: any
) {
  try {
    log(`\nChecking arbitrage path: ${exchangeA} -> ${exchangeB}:`);
    log(`- Step 1: Swap ${ethers.utils.formatUnits(amountIn, fromDecimals)} ${pairName.split('/')[0]} -> ${ethers.utils.formatUnits(amountOutA, toDecimals)} ${pairName.split('/')[1]} on ${exchangeA}`);
    
    // Simulate the reverse swap
    const reversePath = [tokenTo, tokenFrom];
    const reverseAmounts = await routerB.getAmountsOut(amountOutA, reversePath);
    const reverseAmountOut = reverseAmounts[reverseAmounts.length - 1];
    
    await processArbitrageResult(
      exchangeA,
      exchangeB,
      amountOutA,
      reverseAmountOut,
      tokenFrom,
      tokenTo,
      pairName,
      amountIn,
      flashLoanRepayment,
      fromDecimals,
      toDecimals,
      tokenPriceUsd,
      executeIfProfitable,
      validator,
      executor,
      arbContract,
      signer
    );
  } catch (error) {
    log(`Error checking ${exchangeA} -> ${exchangeB} path: ${error}`);
  }
}

async function processArbitrageResult(
  exchangeA: string,
  exchangeB: string,
  amountOutA: BigNumber,
  reverseAmountOut: BigNumber,
  tokenFrom: string,
  tokenTo: string,
  pairName: string,
  amountIn: BigNumber,
  flashLoanRepayment: BigNumber,
  fromDecimals: number,
  toDecimals: number,
  tokenPriceUsd: number,
  executeIfProfitable: boolean,
  validator: OpportunityValidator,
  executor: TransactionExecutor,
  arbContract: Contract,
  signer: any
) {
  log(`- Step 2: Swap ${ethers.utils.formatUnits(amountOutA, toDecimals)} ${pairName.split('/')[1]} -> ${ethers.utils.formatUnits(reverseAmountOut, fromDecimals)} ${pairName.split('/')[0]} on ${exchangeB}`);
  
  if (reverseAmountOut.gt(flashLoanRepayment)) {
    const profit = reverseAmountOut.sub(flashLoanRepayment);
    const profitPercent = profit.mul(10000).div(amountIn).toNumber() / 100;
    
    log(`- POTENTIALLY PROFITABLE! Net profit: ${ethers.utils.formatUnits(profit, fromDecimals)} ${pairName.split('/')[0]} (${profitPercent.toFixed(4)}%)`);
    
    // Create an opportunity object for validation
    const opportunity: ArbitrageOpportunity = {
      tokenBorrow: tokenFrom,
      flashLoanAmount: amountIn,
      expectedProfit: profit,
      tokenName: pairName.split('/')[0],
      path: [tokenFrom, tokenTo, tokenFrom], // Triangle path
      dexes: [
        exchangeA === 'Curve' ? 2 : exchangeA === 'Uniswap V2' ? 0 : 1,
        exchangeB === 'Curve' ? 2 : exchangeB === 'Uniswap V2' ? 0 : 1,
      ],
      fees: [3000, 3000], // Default fee tiers (can be optimized)
      profitInUsd: parseFloat(ethers.utils.formatUnits(profit, fromDecimals)) * tokenPriceUsd
    };
    
    // Validate the opportunity
    const validationResult = await validator.validate(
      opportunity,
      ethers.provider,
      500000, // Gas limit estimation
      tokenPriceUsd
    );
    
    if (validationResult.valid) {
      log(`🚀 VALIDATED ARBITRAGE OPPORTUNITY: ${exchangeA} -> ${exchangeB} for ${pairName}`);
      log(`Adjusted profit: ${ethers.utils.formatUnits(validationResult.adjustedProfit!, fromDecimals)} ${pairName.split('/')[0]}`);
      log(`Profitability: ${validationResult.profitability!.toFixed(4)}%`);
      
      // Record opportunity in log
      const csvLogEntry = `${new Date().toISOString()},${pairName},${exchangeA}->${exchangeB},${ethers.utils.formatUnits(profit, fromDecimals)},${profitPercent.toFixed(4)}%,CURVE_SCAN\n`;
      
      try {
        const csvPath = path.join(__dirname, "../curve_arbitrage_log.csv");
        fs.writeFileSync(csvPath, csvLogEntry, { flag: 'a' });
      } catch (error) {
        log(`Error writing to CSV: ${error}`);
      }
      
      // Execute the arbitrage if requested
      if (executeIfProfitable) {
        log(`Executing arbitrage transaction...`);
        
        try {
          const tx = await executor.executeContractMethod(
            arbContract,
            "executeTriangleArbitrage",
            [
              opportunity.tokenBorrow,
              opportunity.flashLoanAmount,
              opportunity.path,
              opportunity.dexes,
              opportunity.fees || [3000, 3000]
            ],
            signer,
            opportunity.expectedProfit,
            500000 // Gas limit
          );
          
          if (tx) {
            log(`✅ Transaction executed successfully! Hash: ${tx.transactionHash}`);
          } else {
            log(`Transaction submission failed or was not confirmed.`);
          }
        } catch (error) {
          log(`❌ Error executing arbitrage: ${error}`);
        }
      } else {
        log(`Execution skipped (simulation mode).`);
      }
    } else {
      log(`Opportunity validation failed: ${validationResult.reason}`);
    }
  } else {
    const loss = flashLoanRepayment.sub(reverseAmountOut);
    log(`- NOT PROFITABLE. Would lose ${ethers.utils.formatUnits(loss, fromDecimals)} ${pairName.split('/')[0]}`);
  }
}

// Run the main function
main().catch(error => {
  console.error("Fatal error:", error);
  process.exit(1);
});
