// Import hardhat runtime
const hre = require("hardhat");
const ethers = hre.ethers;
import { CoinGeckoPriceProvider, tokenAmountToUsd, usdToTokenAmount } from "./utils/price-feed";

/**
 * Test script to verify the price feed functionality
 */
async function main() {
  console.log("Testing price feed module...");
  
  // Create a price provider instance
  const priceProvider = new CoinGeckoPriceProvider();
  
  // Test fetching individual token prices
  console.log("\nFetching individual token prices:");
  try {
    const ethPrice = await priceProvider.getUsdPrice('ETH');
    console.log(`ETH: $${ethPrice.toFixed(2)}`);
    
    const daiPrice = await priceProvider.getUsdPrice('DAI');
    console.log(`DAI: $${daiPrice.toFixed(2)}`);
    
    const usdcPrice = await priceProvider.getUsdPrice('USDC');
    console.log(`USDC: $${usdcPrice.toFixed(2)}`);
    
    const linkPrice = await priceProvider.getUsdPrice('LINK');
    console.log(`LINK: $${linkPrice.toFixed(2)}`);
  } catch (error) {
    console.error("Error fetching individual prices:", error);
  }
  
  // Test fetching multiple token prices in one call
  console.log("\nFetching multiple token prices:");
  try {
    const prices = await priceProvider.getPrices(['WETH', 'BTC', 'USDT', 'UNI']);
    
    console.log(`WETH: $${prices.get('WETH')?.toFixed(2) || 'N/A'}`);
    console.log(`BTC: $${prices.get('BTC')?.toFixed(2) || 'N/A'}`);
    console.log(`USDT: $${prices.get('USDT')?.toFixed(2) || 'N/A'}`);
    console.log(`UNI: $${prices.get('UNI')?.toFixed(2) || 'N/A'}`);
  } catch (error) {
    console.error("Error fetching multiple prices:", error);
  }
  
  // Test token amount to USD conversion
  console.log("\nTesting amount conversions:");
  try {
    const ethPrice = await priceProvider.getUsdPrice('ETH');
    
    // Convert 1 ETH to USD
    const ethAmount = ethers.utils.parseEther("1.0");
    const usdValue = tokenAmountToUsd(ethAmount, 18, ethPrice);
    console.log(`1 ETH = $${usdValue.toFixed(2)}`);
    
    // Convert $5000 to ETH amount
    const ethTokens = usdToTokenAmount(5000, 18, ethPrice);
    console.log(`$5000 = ${ethers.utils.formatEther(ethTokens)} ETH`);
    
    // Convert 1000 USDC to USD
    const usdcAmount = ethers.utils.parseUnits("1000", 6); // USDC has 6 decimals
    const usdcValue = tokenAmountToUsd(usdcAmount, 6, 1); // Stablecoins are ~$1
    console.log(`1000 USDC = $${usdcValue.toFixed(2)}`);
  } catch (error) {
    console.error("Error in conversion tests:", error);
  }
  
  // Test price cache
  console.log("\nTesting price cache (second fetch should be instant):");
  
  console.time("First ETH price fetch");
  await priceProvider.getUsdPrice('ETH');
  console.timeEnd("First ETH price fetch");
  
  console.time("Second ETH price fetch (cached)");
  await priceProvider.getUsdPrice('ETH');
  console.timeEnd("Second ETH price fetch (cached)");
  
  console.log("\nPrice feed test completed successfully");
}

// Run the main function
main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
