// Import hardhat runtime
const hre = require("hardhat");
const ethers = hre.ethers;
import * as fs from "fs";
import * as path from "path";

// Setup logging function
function log(message: string) {
  const timestamp = new Date().toISOString();
  const logEntry = `[${timestamp}] ${message}`;
  
  console.log(logEntry);
  
  // Log to file
  const logFile = path.join(__dirname, "../logs", `reduce_min_profit_${new Date().toISOString().split('T')[0]}.log`);
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

// Modified ABI with only setMinProfitAmount to ensure compatibility
const MINIMAL_ABI = [
  "function setMinProfitAmount(uint256 _newMinProfitAmount) external"
];

async function main() {
  log("Starting min profit threshold reduction script...");
  
  try {
    // Load config
    const forkConfig = loadForkConfig();
    
    // Get the signer
    const [deployer] = await ethers.getSigners();
    log(`Using account: ${deployer.address}`);
    
    // Validate contract addresses from config
    if (!forkConfig.flashloanArb) {
      throw new Error("FlashloanArb contract address not found in fork-config.json. Run deploy-fork.ts first");
    }
    
    log(`Original contract address: ${forkConfig.flashloanArb}`);
    if (forkConfig.flashloanArbV2) {
      log(`V2 contract address: ${forkConfig.flashloanArbV2}`);
    }
    
    // Check if the contracts exist on-chain
    const code = await ethers.provider.getCode(forkConfig.flashloanArb);
    if (code === '0x') {
      throw new Error(`No contract found at address ${forkConfig.flashloanArb}. Please check if the fork is running and contracts are deployed.`);
    }
    
    // Connect to flashloan contract (both original and V2) - using minimal ABI
    const flashloanArb = new ethers.Contract(
      forkConfig.flashloanArb,
      MINIMAL_ABI,
      deployer
    );
    
    // Flashloan V2 is optional, only proceed if deployed
    let flashloanArbV2;
    if (forkConfig.flashloanArbV2) {
      const codeV2 = await ethers.provider.getCode(forkConfig.flashloanArbV2);
      if (codeV2 === '0x') {
        log(`⚠️ Warning: No V2 contract found at address ${forkConfig.flashloanArbV2}. Skipping V2 update.`);
      } else {
        flashloanArbV2 = new ethers.Contract(
          forkConfig.flashloanArbV2,
          MINIMAL_ABI,
          deployer
        );
      }
    }
    
    // Set new min profit amount to VIRTUALLY ZERO
    const newMinProfitAmount = ethers.utils.parseUnits("0.000000001", "ether"); // 0.000000001 ETH (1 Gwei)
    
    log(`Setting min profit threshold to ${ethers.utils.formatEther(newMinProfitAmount)} ETH (virtually zero)`);
    
    // Transaction gas settings
    const txOptions = {
      gasLimit: 200000,
      maxFeePerGas: ethers.utils.parseUnits("100", "gwei"),
      maxPriorityFeePerGas: ethers.utils.parseUnits("2", "gwei")
    };
    
    // Update original contract
    log(`Updating original contract at ${forkConfig.flashloanArb}...`);
    const tx = await flashloanArb.setMinProfitAmount(newMinProfitAmount, txOptions);
    await tx.wait();
    log(`✅ Updated min profit for original contract: ${forkConfig.flashloanArb}`);
    
    // Update V2 contract if available
    if (flashloanArbV2) {
      log(`Updating V2 contract at ${forkConfig.flashloanArbV2}...`);
      const tx2 = await flashloanArbV2.setMinProfitAmount(newMinProfitAmount, txOptions);
      await tx2.wait();
      log(`✅ Updated min profit for V2 contract: ${forkConfig.flashloanArbV2}`);
    }
    
    log("\n🎉 Min profit threshold reduced successfully!");
    log("This will allow the contract to execute trades with much smaller profit margins.");
    log("\nNext steps:");
    log("1. npm run triangle:imbalance (to create strong imbalances in all triangle pools)");
    log("2. npm run execute:triangle (to execute the triangle arbitrage)");
    
  } catch (error: any) {
    log(`❌ Error: ${error?.message || String(error)}`);
    
    // Provide troubleshooting guidance
    log("\n🔍 Troubleshooting:");
    log("1. Make sure your forked mainnet is running (npm run fork)");
    log("2. Make sure you've deployed both contracts (npm run deploy:fork and npm run deploy:enhanced)");
    log("3. Check fork-config.json for correct contract addresses");
    log("4. Try restarting your fork and redeploying the contracts");
    throw error;
  }
}

// Run the main function
main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error("Error in min profit reduction:", error);
    process.exit(1);
  });
