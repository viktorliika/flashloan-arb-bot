import { HardhatRuntimeEnvironment } from "hardhat/types";
import { HardhatEthersHelpers } from "@nomiclabs/hardhat-ethers/types";
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
 * Deploy the MultiDexArbitrageur contract
 * 
 * This script deploys the MultiDexArbitrageur contract which can execute
 * arbitrage opportunities across multiple DEXes including Uniswap V2,
 * Curve, and Balancer.
 */
async function main() {
  console.log("Deploying MultiDexArbitrageur contract...");
  
  // Get signer
  const [deployer] = await ethers.getSigners();
  console.log(`Deploying with account: ${deployer.address}`);
  
  // Get account balance
  const balance = await deployer.getBalance();
  console.log(`Account balance: ${ethers.utils.formatEther(balance)} ETH`);
  
  // Get lending pool address from config or set to default
  let lendingPoolAddress: string;
  
  // First check if we're on a simulation environment
  try {
    const simulationConfig = JSON.parse(fs.readFileSync(path.join(__dirname, '../simulation-config.json'), 'utf8'));
    lendingPoolAddress = simulationConfig.lendingPool;
    
    if (lendingPoolAddress) {
      console.log(`Using lending pool from simulation config: ${lendingPoolAddress}`);
    } else {
      throw new Error("Lending pool address not found in simulation config");
    }
  } catch (error) {
    // Then check if we're on a fork
    try {
      const forkConfig = JSON.parse(fs.readFileSync(path.join(__dirname, '../fork-config.json'), 'utf8'));
      lendingPoolAddress = forkConfig.lendingPoolAddress;
      
      if (lendingPoolAddress) {
        console.log(`Using lending pool from fork config: ${lendingPoolAddress}`);
      } else {
        throw new Error("Lending pool address not found in fork config");
      }
    } catch (error) {
      // If not a fork or simulation, deploy a mock lending pool
      console.log("No lending pool configuration found. Deploying a mock lending pool...");
      
      const MockLendingPool = await ethers.getContractFactory("MockLendingPool");
      const mockLendingPool = await MockLendingPool.deploy(9); // 0.09% flash loan fee
      await mockLendingPool.deployed();
      
      lendingPoolAddress = mockLendingPool.address;
      console.log(`Mock lending pool deployed at: ${lendingPoolAddress}`);
    }
  }
  
  // Deploy MultiDexArbitrageur
  const MultiDexArbitrageurFactory = await ethers.getContractFactory("MultiDexArbitrageur");
  const arbitrageur = await MultiDexArbitrageurFactory.deploy(lendingPoolAddress);
  
  await arbitrageur.deployed();
  
  console.log(`MultiDexArbitrageur deployed at: ${arbitrageur.address}`);
  
  // Save contract details to a file for easy access
  const contractDetails = {
    network: (await ethers.provider.getNetwork()).name,
    arbitrageur: arbitrageur.address,
    lendingPool: lendingPoolAddress,
    deployer: deployer.address,
    timestamp: new Date().toISOString()
  };
  
  const outDir = path.join(__dirname, "../deployments");
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }
  
  fs.writeFileSync(
    path.join(outDir, "multi-dex-arb-deployment.json"),
    JSON.stringify(contractDetails, null, 2)
  );
  
  console.log("Contract details saved to deployments/multi-dex-arb-deployment.json");
  
  // Verify the contract on the scanner if on a public network
  const networkName = (await ethers.provider.getNetwork()).name;
  if (networkName !== "unknown" && networkName !== "hardhat") {
    console.log("Waiting for block confirmations before verification...");
    await arbitrageur.deployTransaction.wait(6); // wait for 6 confirmations
    
    console.log("Verifying contract on etherscan...");
    try {
      await hre.run("verify:verify", {
        address: arbitrageur.address,
        constructorArguments: [lendingPoolAddress],
      });
      console.log("Contract verified!");
    } catch (error) {
      console.log("Verification failed:", error);
    }
  }
  
  // Return the deployed contract in case we want to run tests
  return arbitrageur;
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
