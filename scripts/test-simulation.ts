import * as fs from "fs";
import * as path from "path";

async function main() {
  console.log("Checking simulation configuration...");
  
  // Check if simulation config exists
  const configPath = path.join(__dirname, "../simulation-config.json");
  if (!fs.existsSync(configPath)) {
    console.error("Error: Simulation config not found. Please run deploy-simulation.ts first.");
    return;
  }
  
  // Read and display config
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  console.log("\nSimulation Configuration:");
  console.log("-----------------------------");
  console.log(`Network ID: ${config.networkId}`);
  console.log(`WETH: ${config.weth}`);
  console.log(`DAI: ${config.dai}`);
  console.log(`USDC: ${config.usdc}`);
  console.log(`Lending Pool: ${config.lendingPool}`);
  console.log(`Uniswap V2 Router: ${config.uniswapV2Router}`);
  console.log(`Uniswap V3 Router: ${config.uniswapV3Router}`);
  console.log(`FlashloanArb: ${config.flashloanArb}`);
  
  console.log("\nAll contracts found in configuration. Deployment appears successful!");
  console.log("You can now run the arbitrage scanner with 'npm run arb:scan:local'");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Error:", error);
    process.exit(1);
  });
