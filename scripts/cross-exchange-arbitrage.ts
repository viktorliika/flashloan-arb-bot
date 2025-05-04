// Import hardhat runtime
const hre = require("hardhat");
const ethers = hre.ethers;
import { ExchangeConnector } from './utils/exchange-connector';
import { BinanceAdapter } from './utils/adapters/binance-adapter';
import { ConfigLoader } from './utils/config-loader';
import * as fs from 'fs';
import * as path from 'path';
import { createLogger, format, transports } from 'winston';

// Configure logger
const logDir = path.join(__dirname, '../logs');
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir);
}

const logFilename = path.join(logDir, `cross_exchange_arb_${new Date().toISOString().split('T')[0].replace(/-/g, '_')}.log`);
const csvFilename = path.join(__dirname, '../cross_exchange_arb_log.csv');

const logger = createLogger({
  level: 'info',
  format: format.combine(
    format.timestamp(),
    format.printf((info: any) => `${info.timestamp} [${info.level}]: ${info.message}`)
  ),
  transports: [
    new transports.Console(),
    new transports.File({ filename: logFilename })
  ]
});

// Make sure CSV header exists
if (!fs.existsSync(csvFilename)) {
  fs.writeFileSync(csvFilename, 'timestamp,baseAsset,quoteAsset,exchange1,price1,exchange2,price2,spreadPercent,profitUsd\n');
}

// Add a record to the CSV log
function logToCSV(
  baseAsset: string,
  quoteAsset: string,
  exchange1: string,
  price1: number,
  exchange2: string, 
  price2: number,
  spreadPercent: number,
  profitUsd: number
) {
  const timestamp = new Date().toISOString();
  const record = `${timestamp},${baseAsset},${quoteAsset},${exchange1},${price1},${exchange2},${price2},${spreadPercent},${profitUsd}\n`;
  fs.appendFileSync(csvFilename, record);
}

// Configure pairs to monitor for arbitrage
const PAIRS_TO_MONITOR = [
  { base: 'BTC', quote: 'USDT', symbol: 'BTCUSDT', minSpreadPercent: 0.5 },
  { base: 'ETH', quote: 'USDT', symbol: 'ETHUSDT', minSpreadPercent: 0.5 },
  { base: 'BNB', quote: 'USDT', symbol: 'BNBUSDT', minSpreadPercent: 0.5 },
  { base: 'ETH', quote: 'BTC', symbol: 'ETHBTC', minSpreadPercent: 0.3 },
  { base: 'XRP', quote: 'USDT', symbol: 'XRPUSDT', minSpreadPercent: 0.8 },
  { base: 'ADA', quote: 'USDT', symbol: 'ADAUSDT', minSpreadPercent: 0.8 }
];

// Approximate USD values for calculating profit (only needed for non-USD pairs)
const TOKEN_USD_PRICES: Record<string, number> = {
  'BTC': 45000,
  'ETH': 2500,
  'BNB': 350,
  'XRP': 0.5,
  'ADA': 0.4,
  'USDT': 1,
  'USDC': 1,
  'BUSD': 1
};

async function scanForArbitrageOpportunities(connector: ExchangeConnector) {
  logger.info('Scanning for cross-exchange arbitrage opportunities...');
  
  for (const pair of PAIRS_TO_MONITOR) {
    try {
      // Get prices from all connected exchanges
      const prices = await connector.getPrices(pair.symbol);
      
      // Need at least 2 exchanges to compare
      if (Object.keys(prices).length < 2) {
        logger.warn(`Not enough data sources for ${pair.symbol}, only ${Object.keys(prices).length} available`);
        continue;
      }
      
      // Find the lowest and highest prices
      let lowestPrice = Infinity;
      let highestPrice = -Infinity;
      let lowestExchange = '';
      let highestExchange = '';
      
      for (const [exchange, price] of Object.entries(prices)) {
        if (price < lowestPrice) {
          lowestPrice = price;
          lowestExchange = exchange;
        }
        
        if (price > highestPrice) {
          highestPrice = price;
          highestExchange = exchange;
        }
      }
      
      // Calculate the spread
      const spreadPercent = ((highestPrice - lowestPrice) / lowestPrice) * 100;
      
      // Calculate approximate profit in USD
      let profitUsd = 0;
      if (pair.quote === 'USDT' || pair.quote === 'USDC' || pair.quote === 'BUSD') {
        // Direct USD pairs
        profitUsd = highestPrice - lowestPrice;
      } else {
        // For non-USD pairs (e.g., ETHBTC), convert to USD
        const baseUsdPrice = TOKEN_USD_PRICES[pair.base] || 0;
        profitUsd = (highestPrice - lowestPrice) * baseUsdPrice;
      }
      
      // Log all prices
      logger.info(`${pair.symbol} prices: ${Object.entries(prices).map(([ex, p]) => `${ex}: ${p}`).join(', ')}`);
      
      // Check if the spread exceeds the minimum threshold
      if (spreadPercent >= pair.minSpreadPercent) {
        logger.info(`Arbitrage opportunity detected for ${pair.symbol}:`);
        logger.info(`  Buy on ${lowestExchange} at ${lowestPrice}`);
        logger.info(`  Sell on ${highestExchange} at ${highestPrice}`);
        logger.info(`  Spread: ${spreadPercent.toFixed(2)}%`);
        logger.info(`  Estimated profit per unit: $${profitUsd.toFixed(2)}`);
        
        // Log to CSV for analysis
        logToCSV(
          pair.base,
          pair.quote,
          lowestExchange,
          lowestPrice,
          highestExchange,
          highestPrice,
          spreadPercent,
          profitUsd
        );
      }
    } catch (error) {
      logger.error(`Error scanning for arbitrage for ${pair.symbol}:`, error);
    }
  }
}

async function main() {
  try {
    // Load configuration
    const config = new ConfigLoader('mainnet');
    const generalConfig = config.getGeneralConfig();
    
    // Initialize exchange connector
    const connector = new ExchangeConnector();
    
    // Add exchange adapters
    const binanceAdapter = new BinanceAdapter({
      name: 'Binance',
      restEndpoint: '',  // Will be overridden in the adapter
      wsEndpoint: '',    // Will be overridden in the adapter
      useTestnet: false  // Set to true for testing
    });
    
    connector.addExchange(binanceAdapter);
    
    // Add more exchange adapters here
    // e.g., connector.addExchange(new CoinbaseAdapter(...));
    
    // Connect to exchanges
    await connector.connectAll();
    logger.info(`Connected to exchanges: ${connector.getConnectedExchanges().join(', ')}`);
    
    // Initialize scanning interval
    const scanIntervalMs = generalConfig.scanIntervalMs || 10000;
    
    // Subscribe to real-time price updates
    for (const pair of PAIRS_TO_MONITOR) {
      connector.subscribeAll(`${pair.symbol.toLowerCase()}@ticker`);
    }
    
    // Set up event listener for market data
    connector.on('market_data', (data) => {
      // Process real-time market data (optional)
      // This could be used to trigger arbitrage immediately on price changes
    });
    
    // Initial scan
    await scanForArbitrageOpportunities(connector);
    
    // Schedule regular scans
    setInterval(async () => {
      await scanForArbitrageOpportunities(connector);
    }, scanIntervalMs);
    
    logger.info(`Started cross-exchange arbitrage scanner with ${scanIntervalMs}ms interval`);
    
    // Keep the process running
    process.stdin.resume();
    
    // Handle graceful shutdown
    const shutdown = () => {
      logger.info('Shutting down scanner...');
      connector.disconnectAll();
      process.exit(0);
    };
    
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    
  } catch (error) {
    logger.error('Error in cross-exchange arbitrage scanner:', error);
    process.exit(1);
  }
}

main().catch(error => {
  console.error('Unhandled error:', error);
  process.exit(1);
});
