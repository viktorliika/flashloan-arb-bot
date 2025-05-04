import { HardhatRuntimeEnvironment } from "hardhat/types";
import { HardhatEthersHelpers } from "@nomiclabs/hardhat-ethers/types";
import { BigNumber } from "ethers";
import fs from "fs";
import path from "path";

// This is a workaround for accessing ethers from hardhat
declare global {
  interface HardhatRuntimeEnvironment {
    ethers: HardhatEthersHelpers;
  }
}

// Import hardhat runtime
const hre = require("hardhat");
const ethers = hre.ethers;

/**
 * Execute an arbitrage opportunity using the MultiDexArbitrageur contract
 * 
 * This script executes arbitrage opportunities across multiple DEXes 
 * using the MultiDexArbitrageur contract.
 */
async function main() {
  console.log("Executing multi-DEX arbitrage...");
  
  // Load contract details
  let arbitrageurAddress: string;
  let deploymentDetails: any;
  
  try {
    const deploymentPath = path.join(__dirname, '../deployments/multi-dex-arb-deployment.json');
    deploymentDetails = JSON.parse(fs.readFileSync(deploymentPath, 'utf8'));
    arbitrageurAddress = deploymentDetails.arbitrageur;
    console.log(`Loaded arbitrageur contract from deployment: ${arbitrageurAddress}`);
  } catch (error) {
    console.error("Error loading deployment details. Has the contract been deployed?");
    console.error("Run 'npm run deploy:multi-dex-arb' first to deploy the contract.");
    throw error;
  }
  
  // Get signer
  const [signer] = await ethers.getSigners();
  console.log(`Using account: ${signer.address}`);
  
  // Get account balance
  const balance = await signer.getBalance();
  console.log(`Account balance: ${ethers.utils.formatEther(balance)} ETH`);
  
  // Connect to the arbitrageur contract
  const MultiDexArbitrageur = await ethers.getContractFactory("MultiDexArbitrageur");
  const arbitrageur = MultiDexArbitrageur.attach(arbitrageurAddress);
  
  // Example opportunity parameters (these would be detected by the scanner)
  // In a production system, these would come from your scanner
  const exampleOpportunity = {
    // Token to borrow (WETH)
    tokenBorrow: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
    
    // Amount to borrow (10 ETH)
    amountBorrow: ethers.utils.parseEther("10"),
    
    // DEX path: 0 = UniswapV2, 1 = UniswapV3, 2 = Curve, 3 = Balancer
    dexPath: [0, 3],
    
    // Token path (must start and end with tokenBorrow)
    tokenPath: [
      "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", // WETH
      "0x6B175474E89094C44Da98b954EedeAC495271d0F", // DAI
      "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"  // WETH
    ],
    
    // Pool addresses for each swap
    pools: [
      "0xA478c2975Ab1Ea89e8196811F51A7B7Ade33eB11", // UniswapV2 WETH-DAI pool
      "0x0B09deA16768f0799065C475be02919503cB2a35" // Balancer WETH-DAI pool
    ],
    
    // Additional data needed for each DEX
    poolData: [
      "0x", // No additional data needed for UniswapV2
      "0x000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000200b09dea16768f0799065c475be02919503cb2a3500020000000000000000001a" // Balancer pool ID
    ]
  };
  
  console.log("\nExecuting arbitrage with the following parameters:");
  console.log(`- Token to borrow: ${exampleOpportunity.tokenBorrow}`);
  console.log(`- Amount to borrow: ${ethers.utils.formatEther(exampleOpportunity.amountBorrow)} ETH`);
  console.log(`- DEX path: ${exampleOpportunity.dexPath.join(' -> ')}`);
  console.log(`- Token path: ${exampleOpportunity.tokenPath.join(' -> ')}`);
  
  try {
    // Execute the arbitrage
    console.log("\nSending transaction...");
    const tx = await arbitrageur.executeArbitrage(
      exampleOpportunity.tokenBorrow,
      exampleOpportunity.amountBorrow,
      exampleOpportunity.dexPath,
      exampleOpportunity.tokenPath,
      exampleOpportunity.pools,
      exampleOpportunity.poolData
    );
    
    console.log(`Transaction sent: ${tx.hash}`);
    console.log("Waiting for confirmation...");
    
    // Wait for transaction to be mined
    const receipt = await tx.wait();
    console.log(`Transaction confirmed in block ${receipt.blockNumber}`);
    
    // Check for ArbitrageExecuted event to get profit
    const arbitrageEvents = receipt.events?.filter(
      (event: any) => event.event === "ArbitrageExecuted"
    );
    
    if (arbitrageEvents && arbitrageEvents.length > 0) {
      const event = arbitrageEvents[0];
      const profit = event.args?.profit;
      console.log(`\nArbitrage successfully executed!`);
      console.log(`Profit: ${ethers.utils.formatEther(profit)} ETH`);
    } else {
      console.log("Arbitrage executed, but no ArbitrageExecuted event found.");
    }
  } catch (error: unknown) {
    console.error("Error executing arbitrage:", error);
    
    // Try to extract revert reason if available
    if (error && typeof error === 'object' && 'data' in error && error.data) {
      const revertReason = String(error.data);
      console.error("Revert reason:", revertReason);
    }
  }
  
  // Check contract balances after arbitrage
  console.log("\nChecking contract balances:");
  const weth = await ethers.getContractAt(
    "IERC20",
    "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"
  );
  const dai = await ethers.getContractAt(
    "IERC20", 
    "0x6B175474E89094C44Da98b954EedeAC495271d0F"
  );
  
  const wethBalance = await weth.balanceOf(arbitrageurAddress);
  const daiBalance = await dai.balanceOf(arbitrageurAddress);
  
  console.log(`- WETH: ${ethers.utils.formatEther(wethBalance)} WETH`);
  console.log(`- DAI: ${ethers.utils.formatEther(daiBalance)} DAI`);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
