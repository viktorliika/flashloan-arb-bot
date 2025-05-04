// Import hardhat runtime
const hre = require("hardhat");
const ethers = hre.ethers;
import * as fs from "fs";
import * as path from "path";

async function main() {
  console.log("Deploying FlashloanArb to forked mainnet...");
  
  // Mainnet addresses
  const AAVE_LENDING_POOL = "0x7d2768dE32b0b80b7a3454c06BdAc94A69DDc7A9"; // Aave V2 LendingPool
  const UNISWAP_V2_ROUTER = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D"; // Uniswap V2 Router
  const SUSHISWAP_ROUTER = "0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F"; // Sushiswap Router
  
  // Token addresses (for reference in config)
  const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
  const DAI = "0x6B175474E89094C44Da98b954EedeAC495271d0F";
  const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
  
  // Set min profit amount (in wei)
  const MIN_PROFIT_AMOUNT = ethers.utils.parseEther("0.01"); // 0.01 ETH
  
  console.log("Deploying with the following parameters:");
  console.log(`- Aave LendingPool: ${AAVE_LENDING_POOL}`);
  console.log(`- Uniswap V2 Router: ${UNISWAP_V2_ROUTER}`);
  console.log(`- Sushiswap Router: ${SUSHISWAP_ROUTER}`);
  console.log(`- Min Profit Amount: ${ethers.utils.formatEther(MIN_PROFIT_AMOUNT)} ETH`);
  
  // Get the signer
  const [deployer] = await ethers.getSigners();
  console.log(`Deployer address: ${deployer.address}`);
  
  // Add custom gas settings to ensure deployment works on forked network
  const txOverrides = {
    gasLimit: 8000000,
    gasPrice: ethers.utils.parseUnits("70", "gwei"),
  };

  console.log("Using transaction overrides:", txOverrides);

  // Deploy FlashloanArb - using fully qualified name to avoid ambiguity with multiple artifacts
  const FlashloanArb = await ethers.getContractFactory("contracts/FlashloanArb.sol:FlashloanArb");
  const flashloanArb = await FlashloanArb.deploy(
    AAVE_LENDING_POOL,
    UNISWAP_V2_ROUTER, // DEX A (Uniswap V2)
    SUSHISWAP_ROUTER, // DEX B (Sushiswap)
    MIN_PROFIT_AMOUNT,
    txOverrides // Add transaction overrides
  );
  
  await flashloanArb.deployed();
  console.log(`FlashloanArb deployed to: ${flashloanArb.address}`);
  
  // Set router types (Uniswap V2 = 0, Sushiswap = 0)
  console.log("Setting router types...");
  
  // Both are V2-style routers (type 0) - using the same transaction overrides
  await flashloanArb.setDexRouter("A", UNISWAP_V2_ROUTER, 0, txOverrides);
  await flashloanArb.setDexRouter("B", SUSHISWAP_ROUTER, 0, txOverrides);
  
  console.log("Router types set successfully");
  
  // Save config
  const config = {
    networkId: 1, // Mainnet
    aaveLendingPool: AAVE_LENDING_POOL,
    uniswapV2Router: UNISWAP_V2_ROUTER,
    sushiswapRouter: SUSHISWAP_ROUTER,
    flashloanArb: flashloanArb.address,
    weth: WETH,
    dai: DAI,
    usdc: USDC
  };
  
  // Create the config file
  const configPath = path.join(__dirname, "../fork-config.json");
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  console.log("Configuration saved to fork-config.json");
  
  console.log("\nDeployment complete!");
  console.log("You can now run the arbitrage scanner with 'npm run arb:scan:fork'");
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error("Error during deployment:", error);
    process.exit(1);
  });
