// Import hardhat runtime environment instead of ethers directly
import { BigNumber } from 'ethers';
import fs from 'fs';
import path from 'path';
import { UniversalScanner, EnhancedArbitrageOpportunity } from './utils/universal-scanner';
import { OpportunityValidator } from './utils/opportunity-validator';
import { DynamicGasStrategy } from './utils/gas-strategy';
import { CoinGeckoPriceProvider } from './utils/price-feed';
import { TransactionExecutor } from './utils/transaction-executor';
import { CurveDexAdapter } from './utils/adapters/curve-dex-adapter';
import { BalancerDexAdapter } from './utils/adapters/balancer-dex-adapter';
import { UniswapV2Adapter } from './utils/adapters/uniswap-v2-adapter';

// Get hardhat runtime
const hre = require("hardhat");
const ethers = hre.ethers;

// Important token addresses on Ethereum mainnet
const TOKENS = {
  WETH: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
  USDC: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  USDT: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
  DAI: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
  WBTC: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599'
};

// Configuration
const MIN_PROFIT_USD = 15;  // Minimum profit in USD
const SCAN_INTERVAL_MS = 10000; // Scan every 10 seconds
const FLASH_LOAN_AMOUNT = ethers.utils.parseEther('10'); // 10 ETH
const SLIPPAGE_TOLERANCE = 3; // 3%
const MIN_PROFIT_PERCENTAGE = 0.5; // 0.5% minimum profit after gas
const EXECUTE_TRADES = false; // Set to true to enable automated execution

// List of token pairs to scan for direct arbitrage
const TRADING_PAIRS = [
  { tokenA: TOKENS.WETH, tokenB: TOKENS.USDC },
  { tokenA: TOKENS.WETH, tokenB: TOKENS.DAI },
  { tokenA: TOKENS.USDC, tokenB: TOKENS.USDT },
  { tokenA: TOKENS.DAI, tokenB: TOKENS.USDC },
  { tokenA: TOKENS.WETH, tokenB: TOKENS.WBTC }
];

// List of tokens to use as intermediaries for triangle arbitrage
const INTERMEDIATE_TOKENS = [
  TOKENS.USDC,
  TOKENS.DAI,
  TOKENS.WBTC
];

/**
 * Setup logging
 */
function setupLogging() {
  const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  const logDir = path.join(__dirname, '../logs');
  
  // Create logs directory if it doesn't exist
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
  
  const logPath = path.join(logDir, `universal_arb_${date}.log`);
  const csvPath = path.join(__dirname, '../arbitrage_universal_log.csv');
  
  // Append CSV header if file doesn't exist
  if (!fs.existsSync(csvPath)) {
    fs.writeFileSync(csvPath, 'timestamp,tokenA,tokenB,sourcePool,destinationPool,amount,profit,profitPercentage,transactionHash\n');
  }
  
  const logToFile = (message: string) => {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}\n`;
    fs.appendFileSync(logPath, logMessage);
    console.log(message);
  };
  
  const logOpportunityToCSV = (opportunity: EnhancedArbitrageOpportunity, txHash?: string) => {
    const timestamp = new Date().toISOString();
    const csvLine = [
      timestamp,
      opportunity.tokenName || opportunity.tokenBorrow,
      opportunity.path?.[1] || 'Unknown',
      opportunity.sourceDex,
      opportunity.destinationDex,
      opportunity.flashLoanAmount.toString(),
      opportunity.expectedProfit.toString(),
      opportunity.priceDifferencePercentage.toFixed(4),
      txHash || 'Not Executed'
    ].join(',');
    
    fs.appendFileSync(csvPath, csvLine + '\n');
  };
  
  return { logToFile, logOpportunityToCSV };
}

/**
 * Main function
 */
async function main() {
  const { logToFile, logOpportunityToCSV } = setupLogging();
  
  logToFile('Starting Universal Arbitrage Scanner');
  logToFile('-----------------------------------------------');
  
  // Get the provider
  const provider = ethers.provider;
  
  // Initialize components
  const gasStrategy = new DynamicGasStrategy(25); // Use 25% max gas percentage
  const priceProvider = new CoinGeckoPriceProvider();
  const validator = new OpportunityValidator(
    gasStrategy, 
    MIN_PROFIT_USD, 
    SLIPPAGE_TOLERANCE, 
    MIN_PROFIT_PERCENTAGE
  );
  
  // Create the universal scanner
  const scanner = new UniversalScanner(provider, validator, priceProvider);
  
  // Register adapters
  logToFile('Registering DEX adapters...');
  scanner.registerAdapter(new CurveDexAdapter(provider));
  scanner.registerAdapter(new BalancerDexAdapter(provider));
  scanner.registerAdapter(new UniswapV2Adapter(provider));
  
  // Log all registered adapters
  const adapters = scanner.getAdapters();
  logToFile(`Registered ${adapters.length} DEX adapters: ${adapters.map(a => a.name).join(', ')}`);
  
  // Create transaction executor if trade execution is enabled
  let txExecutor: TransactionExecutor | null = null;
  if (EXECUTE_TRADES) {
    // Get signer from hardhat
    const [signer] = await ethers.getSigners();
    txExecutor = new TransactionExecutor(provider, gasStrategy);
    logToFile(`Trade execution ENABLED. Using account: ${signer.address}`);
  } else {
    logToFile('Trade execution DISABLED. Running in monitoring mode only.');
  }
  
  // Start scanning loop
  logToFile('Starting scanning loop...');
  
  // Main scanning function
  async function scanForArbitrageOpportunities() {
    try {
      // Scan direct arbitrage for each token pair
      for (const pair of TRADING_PAIRS) {
        logToFile(`Scanning for direct arbitrage between ${pair.tokenA} and ${pair.tokenB}...`);
        
        const directOpportunities = await scanner.scanForDirectArbitrageOpportunities(
          pair.tokenA,
          pair.tokenB,
          FLASH_LOAN_AMOUNT
        );
        
        if (directOpportunities.length > 0) {
          logToFile(`Found ${directOpportunities.length} validated direct arbitrage opportunities.`);
          
          // Process top opportunity
          await processArbitrageOpportunity(directOpportunities[0], 'direct');
        } else {
          logToFile('No profitable direct arbitrage opportunities found.');
        }
      }
      
      // Scan triangle arbitrage with ETH as base
      logToFile('Scanning for triangle arbitrage opportunities...');
      
      const triangleOpportunities = await scanner.scanForTriangleArbitrageOpportunities(
        TOKENS.WETH, // Start with WETH
        INTERMEDIATE_TOKENS, // Try these intermediaries
        FLASH_LOAN_AMOUNT
      );
      
      if (triangleOpportunities.length > 0) {
        logToFile(`Found ${triangleOpportunities.length} validated triangle arbitrage opportunities.`);
        
        // Process top opportunity
        await processArbitrageOpportunity(triangleOpportunities[0], 'triangle');
      } else {
        logToFile('No profitable triangle arbitrage opportunities found.');
      }
    } catch (error) {
      logToFile(`Error during arbitrage scan: ${error instanceof Error ? error.message : String(error)}`);
    }
    
    // Schedule next scan
    setTimeout(scanForArbitrageOpportunities, SCAN_INTERVAL_MS);
  }
  
  // Process an arbitrage opportunity
  async function processArbitrageOpportunity(
    opportunity: EnhancedArbitrageOpportunity, 
    type: 'direct' | 'triangle'
  ) {
    try {
      const formattedProfit = ethers.utils.formatUnits(opportunity.expectedProfit);
      const profitUsd = opportunity.profitInUsd ? 
        `$${opportunity.profitInUsd.toFixed(2)}` : 
        'Unknown USD value';
      
      logToFile('-----------------------------------------------------');
      logToFile(`VALIDATED ARBITRAGE OPPORTUNITY (${type.toUpperCase()})`);
      logToFile(`Source DEX: ${opportunity.sourceDex}`);
      logToFile(`Destination DEX: ${opportunity.destinationDex}`);
      logToFile(`Path: ${opportunity.path?.join(' → ') || 'Unknown'}`);
      logToFile(`Flash loan amount: ${ethers.utils.formatUnits(opportunity.flashLoanAmount)} ${opportunity.tokenName}`);
      logToFile(`Expected profit: ${formattedProfit} ${opportunity.tokenName} (${opportunity.priceDifferencePercentage.toFixed(4)}%, ${profitUsd})`);
      logToFile('-----------------------------------------------------');
      
      // Log to CSV for analysis
      logOpportunityToCSV(opportunity);
      
      // Execute trade if enabled
      if (EXECUTE_TRADES && txExecutor) {
        logToFile('Executing arbitrage opportunity...');
        
        try {
          // Implementation depends on your contract. This is a simplified example.
          const txResult = await executeArbitrage(opportunity);
          
          if (txResult) {
            logToFile(`Transaction executed: ${txResult}`);
            logOpportunityToCSV(opportunity, txResult);
          } else {
            logToFile('No transaction result returned.');
          }
        } catch (error) {
          logToFile(`Error executing arbitrage: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    } catch (error) {
      logToFile(`Error processing arbitrage opportunity: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  // Execute an arbitrage opportunity
  async function executeArbitrage(opportunity: EnhancedArbitrageOpportunity) {
    // This would be implemented based on your specific arbitrage contract
    // For example, calling a flashloan function with the appropriate path and pool addresses
    
    logToFile('Execution not yet implemented. This is a placeholder.');
    return null;
    
    // Example implementation would be something like:
    /*
    const [signer] = await ethers.getSigners();
    const arbContract = await ethers.getContractAt("FlashloanArbV2", contractAddress);
    
    // Build transaction parameters based on opportunity
    const txParams = {
      path: opportunity.path,
      pools: opportunity.pools.map(p => p.address),
      // other params as needed by your contract
    };
    
    // Execute the transaction
    const tx = await txExecutor.executeContractMethod(
      arbContract,
      "executeArbitrage",
      [txParams],
      signer,
      opportunity.expectedProfit,
      1000000 // gas limit
    );
    
    return tx;
    */
  }
  
  // Start the scanning loop
  scanForArbitrageOpportunities();
}

// Execute the script
main()
  .then(() => {
    // Keep running indefinitely
    process.stdin.resume();
  })
  .catch(error => {
    console.error('Unexpected error:', error);
    process.exit(1);
  });
