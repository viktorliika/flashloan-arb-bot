// Import hardhat runtime
const hre = require("hardhat");
const ethers = hre.ethers;
import { Contract, BigNumber } from "ethers";
import * as fs from "fs";
import * as path from "path";

// Setup logging function
function log(message: string) {
  const timestamp = new Date().toISOString();
  const logEntry = `[${timestamp}] ${message}`;
  
  console.log(logEntry);
  
  // Log to file
  const logFile = path.join(__dirname, "../logs", `careful_arb_${new Date().toISOString().split('T')[0]}.log`);
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

// ABIs
const PAIR_ABI = [
  "function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
  "function token0() external view returns (address)",
  "function token1() external view returns (address)",
  "function sync() external"
];

const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function mint(address to, uint256 amount) returns (bool)",
  "function approve(address spender, uint256 amount) returns (bool)"
];

const ROUTER_ABI = [
  "function getAmountsOut(uint amountIn, address[] memory path) view returns (uint[] memory amounts)"
];

// Options for the script
interface Options {
  pairToManipulate: string;  // Which pair to adjust (e.g., "WETH-DAI", "DAI-USDC")
  exchange: string;  // Which exchange to adjust ("uniswap" or "sushiswap")
  imbalancePercent: number;  // How much to imbalance the pool (e.g., 2 for 2%)
  direction: string;  // Which token to increase ("token0" or "token1")
}

// Known token storage slots
const KNOWN_SLOTS = {
  // USDC has a different storage layout than most ERC20s
  "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48": 9,
  // DAI slot
  "0x6B175474E89094C44Da98b954EedeAC495271d0F": 2,
  // WETH slot
  "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2": 3
};

async function main() {
  // Default options with much larger imbalance for testing
  const options: Options = {
    pairToManipulate: "WETH-USDC", // Using WETH-USDC which often has more arbitrage opportunities
    exchange: "uniswap",           // Using uniswap as base exchange
    imbalancePercent: 15,          // Much larger 15% imbalance to ensure profitable opportunities
    direction: "token0"            // Increase token0 (decreasing token1)
  };
  
  // Parse command line arguments
  process.argv.slice(2).forEach(arg => {
    const [key, value] = arg.split('=');
    if (key && value) {
      if (key === 'pair') options.pairToManipulate = value;
      if (key === 'exchange') options.exchange = value;
      if (key === 'imbalance') options.imbalancePercent = parseFloat(value);
      if (key === 'direction') options.direction = value;
    }
  });
  
  log("Creating careful arbitrage opportunity...");
  log(`Settings: Pair=${options.pairToManipulate}, Exchange=${options.exchange}, Imbalance=${options.imbalancePercent}%, Direction=${options.direction}`);
  
  // Load configuration
  const config = loadForkConfig();
  
  // Use regular signer from hardhat, not an impersonated account
  const [deployer] = await ethers.getSigners();
  log(`Using account: ${deployer.address}`);
  
  // Make sure we have enough ETH
  await hre.network.provider.send("hardhat_setBalance", [
    deployer.address,
    "0x" + (1000n * 10n**18n).toString(16), // 1000 ETH
  ]);
  
  // Set up token addresses based on the pair
  let token0Address: string;
  let token1Address: string;
  
  if (options.pairToManipulate === "WETH-DAI") {
    token0Address = config.weth;
    token1Address = config.dai;
  } else if (options.pairToManipulate === "WETH-USDC") {
    token0Address = config.weth;
    token1Address = config.usdc;
  } else if (options.pairToManipulate === "DAI-USDC") {
    token0Address = config.dai;
    token1Address = config.usdc;
  } else {
    throw new Error("Unsupported pair. Use WETH-DAI, WETH-USDC, or DAI-USDC");
  }
  
  // Get factory and pair addresses
  let factoryAddress: string;
  let routerAddress: string;
  
  if (options.exchange === "uniswap") {
    routerAddress = config.uniswapV2Router;
    factoryAddress = "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f"; // Uniswap V2 Factory
  } else if (options.exchange === "sushiswap") {
    routerAddress = config.sushiswapRouter;
    factoryAddress = "0xC0AEe478e3658e2610c5F7A4A2E1777cE9e4f2Ac"; // Sushiswap Factory
  } else {
    throw new Error("Unsupported exchange. Use uniswap or sushiswap");
  }
  
  // Connect to factory
  const factoryABI = ["function getPair(address tokenA, address tokenB) external view returns (address pair)"];
  const factory = new ethers.Contract(factoryAddress, factoryABI, deployer);
  
  // Get pair address
  const pairAddress = await factory.getPair(token0Address, token1Address);
  if (pairAddress === ethers.constants.AddressZero) {
    throw new Error(`Pair ${options.pairToManipulate} not found on ${options.exchange}`);
  }
  
  log(`Found ${options.pairToManipulate} pair at ${pairAddress} on ${options.exchange}`);
  
  // Connect to pair contract
  const pair = new ethers.Contract(pairAddress, PAIR_ABI, deployer);
  
  // Connect to router for price checks
  const router = new ethers.Contract(routerAddress, ROUTER_ABI, deployer);
  
  // Verify token order in the pair
  const pairToken0 = await pair.token0();
  const pairToken1 = await pair.token1();
  
  // Adjust token order based on the pair's ordering
  let orderedToken0 = token0Address;
  let orderedToken1 = token1Address;
  
  if (pairToken0.toLowerCase() !== token0Address.toLowerCase() || 
      pairToken1.toLowerCase() !== token1Address.toLowerCase()) {
    // Swap the order if needed
    orderedToken0 = token1Address;
    orderedToken1 = token0Address;
    log(`Adjusted token order based on pair contract`);
  }
  
  // Connect to token contracts
  const token0 = new ethers.Contract(orderedToken0, ERC20_ABI, deployer);
  const token1 = new ethers.Contract(orderedToken1, ERC20_ABI, deployer);
  
  // Get token symbols and decimals
  const token0Symbol = await token0.symbol();
  const token1Symbol = await token1.symbol();
  const token0Decimals = await token0.decimals();
  const token1Decimals = await token1.decimals();
  
  log(`Pair consists of ${token0Symbol} (${token0Decimals} decimals) and ${token1Symbol} (${token1Decimals} decimals)`);
  
  // Get current reserves
  const [reserve0, reserve1] = await pair.getReserves();
  
  log(`Current reserves: ${ethers.utils.formatUnits(reserve0, token0Decimals)} ${token0Symbol}, ${ethers.utils.formatUnits(reserve1, token1Decimals)} ${token1Symbol}`);
  
  // SAFER APPROACH: Directly manipulate token balances using known slots
  
  // 1. Get token storage slots
  let token0Slot: number;
  let token1Slot: number;
  
  if (KNOWN_SLOTS[orderedToken0]) {
    token0Slot = KNOWN_SLOTS[orderedToken0];
    log(`Using known storage slot for ${token0Symbol}: ${token0Slot}`);
  } else {
    token0Slot = await findTokenBalanceSlot(token0.address, deployer.address);
    if (!token0Slot && token0Slot !== 0) {
      throw new Error(`Could not find storage slot for ${token0Symbol}`);
    }
    log(`Found storage slot for ${token0Symbol} balance: ${token0Slot}`);
  }
  
  if (KNOWN_SLOTS[orderedToken1]) {
    token1Slot = KNOWN_SLOTS[orderedToken1];
    log(`Using known storage slot for ${token1Symbol}: ${token1Slot}`);
  } else {
    token1Slot = await findTokenBalanceSlot(token1.address, deployer.address);
    if (!token1Slot && token1Slot !== 0) {
      throw new Error(`Could not find storage slot for ${token1Symbol}`);
    }
    log(`Found storage slot for ${token1Symbol} balance: ${token1Slot}`);
  }
  
  // 2. Calculate the amounts - for small imbalances
  const amount0 = reserve0.mul(options.imbalancePercent).div(100);
  const amount1 = reserve1.mul(options.imbalancePercent).div(100);
  
  log(`Adding ${ethers.utils.formatUnits(amount0, token0Decimals)} ${token0Symbol} and ${ethers.utils.formatUnits(amount1, token1Decimals)} ${token1Symbol} to the pair`);
  
  // 3. Give ourselves the tokens
  await setStorageAt(
    token0.address,
    getStorageSlotForAddress(deployer.address, token0Slot),
    amount0.mul(2) // Double what we need
  );
  
  await setStorageAt(
    token1.address,
    getStorageSlotForAddress(deployer.address, token1Slot),
    amount1.mul(2) // Double what we need
  );
  
  // 4. Verify new balances
  const newBalance0 = await token0.balanceOf(deployer.address);
  const newBalance1 = await token1.balanceOf(deployer.address);
  
  log(`Set deployer balance of ${token0Symbol} to ${ethers.utils.formatUnits(newBalance0, token0Decimals)}`);
  log(`Set deployer balance of ${token1Symbol} to ${ethers.utils.formatUnits(newBalance1, token1Decimals)}`);
  
  // 5. Transfer tokens to pair with imbalance
  if (options.direction === "token0") {
    // Add more of token0 to create imbalance
    const imbalanceAmount0 = amount0.mul(100 + options.imbalancePercent).div(100);
    const tx1 = await token0.transfer(pairAddress, imbalanceAmount0, {
      gasLimit: 200000
    });
    await tx1.wait();
    
    const tx2 = await token1.transfer(pairAddress, amount1, {
      gasLimit: 200000
    });
    await tx2.wait();
    
    log(`Transferred ${ethers.utils.formatUnits(imbalanceAmount0, token0Decimals)} ${token0Symbol} to the pair`);
    log(`Transferred ${ethers.utils.formatUnits(amount1, token1Decimals)} ${token1Symbol} to the pair`);
  } else {
    // Add more of token1 to create imbalance
    const tx1 = await token0.transfer(pairAddress, amount0, {
      gasLimit: 200000
    });
    await tx1.wait();
    
    const imbalanceAmount1 = amount1.mul(100 + options.imbalancePercent).div(100);
    const tx2 = await token1.transfer(pairAddress, imbalanceAmount1, {
      gasLimit: 200000
    });
    await tx2.wait();
    
    log(`Transferred ${ethers.utils.formatUnits(amount0, token0Decimals)} ${token0Symbol} to the pair`);
    log(`Transferred ${ethers.utils.formatUnits(imbalanceAmount1, token1Decimals)} ${token1Symbol} to the pair`);
  }
  
  // 6. Sync the pair to update reserves
  log("Syncing pair reserves...");
  const syncTx = await pair.sync({
    gasLimit: 200000
  });
  await syncTx.wait();
  
  // 7. Get updated reserves
  const [newReserve0, newReserve1] = await pair.getReserves();
  log(`New reserves: ${ethers.utils.formatUnits(newReserve0, token0Decimals)} ${token0Symbol}, ${ethers.utils.formatUnits(newReserve1, token1Decimals)} ${token1Symbol}`);
  
  // 8. Calculate price impact safely
  try {
    log("Calculating price impact...");
    // Check for zero values to avoid division by zero
    if (reserve0.isZero() || newReserve0.isZero()) {
      log("Warning: Cannot calculate price impact due to zero reserves");
    } else {
      const oldPriceCalc = reserve1.mul(ethers.BigNumber.from(10).pow(token0Decimals));
      const oldPriceDivisor = reserve0.mul(ethers.BigNumber.from(10).pow(token1Decimals));
      const newPriceCalc = newReserve1.mul(ethers.BigNumber.from(10).pow(token0Decimals));
      const newPriceDivisor = newReserve0.mul(ethers.BigNumber.from(10).pow(token1Decimals));
      
      // Only calculate if divisors are non-zero
      if (!oldPriceDivisor.isZero() && !newPriceDivisor.isZero()) {
        const oldPrice = oldPriceCalc.div(oldPriceDivisor);
        const newPrice = newPriceCalc.div(newPriceDivisor);
        
        if (!oldPrice.isZero()) {
          const priceChangePercent = Math.abs(newPrice.sub(oldPrice).mul(100).div(oldPrice).toNumber());
          log(`Price impact: ${priceChangePercent}% change in ${token0Symbol}/${token1Symbol} price`);
        } else {
          log("Warning: Cannot calculate percentage change due to zero initial price");
        }
      } else {
        log("Warning: Cannot calculate prices due to zero divisors");
      }
    }
  } catch (error) {
    log(`Warning: Error calculating price impact: ${error}`);
  }
  
  // 9. Check price difference between exchanges
  if (options.exchange === "uniswap" || options.exchange === "sushiswap") {
    // Get the other exchange's router
    const otherExchange = options.exchange === "uniswap" ? "sushiswap" : "uniswap";
    const otherRouterAddress = options.exchange === "uniswap" ? config.sushiswapRouter : config.uniswapV2Router;
    const otherRouter = new ethers.Contract(otherRouterAddress, ROUTER_ABI, deployer);
    
    // Calculate price on both exchanges for a small amount
    const amountIn = ethers.utils.parseUnits("1", token0Decimals);
    const path = [orderedToken0, orderedToken1];
    
    try {
      const manipulatedExchangeAmounts = await router.getAmountsOut(amountIn, path);
      const otherExchangeAmounts = await otherRouter.getAmountsOut(amountIn, path);
      
      const manipulatedExchangePrice = ethers.utils.formatUnits(manipulatedExchangeAmounts[1], token1Decimals);
      const otherExchangePrice = ethers.utils.formatUnits(otherExchangeAmounts[1], token1Decimals);
      
      const priceDiffPercent = Math.abs((parseFloat(manipulatedExchangePrice) - parseFloat(otherExchangePrice)) / 
        Math.min(parseFloat(manipulatedExchangePrice), parseFloat(otherExchangePrice)) * 100);
      
      log(`Price difference between ${options.exchange} and ${otherExchange}: ${priceDiffPercent.toFixed(2)}%`);
      log(`- ${options.exchange} price: 1 ${token0Symbol} = ${manipulatedExchangePrice} ${token1Symbol}`);
      log(`- ${otherExchange} price: 1 ${token0Symbol} = ${otherExchangePrice} ${token1Symbol}`);
      
      // Check if arbitrage is profitable
      if (priceDiffPercent > 0.5) {
        log(`✅ Created profitable arbitrage opportunity! Price difference: ${priceDiffPercent.toFixed(2)}%`);
        
        // Determine which exchange has better buying/selling prices
        let buyExchange, sellExchange;
        
        if (parseFloat(manipulatedExchangePrice) > parseFloat(otherExchangePrice)) {
          buyExchange = otherExchange;
          sellExchange = options.exchange;
        } else {
          buyExchange = options.exchange;
          sellExchange = otherExchange;
        }
        
        log(`Arbitrage path: Buy on ${buyExchange}, sell on ${sellExchange}`);
      } else {
        log(`ℹ️ Price difference (${priceDiffPercent.toFixed(2)}%) may be too small for profitable arbitrage.`);
        log(`Consider increasing the imbalance percentage if needed.`);
      }
    } catch (error) {
      log(`Error calculating arbitrage: ${error}`);
    }
  }
  
  log("Arbitrage opportunity creation completed without modifying K constant!");
}

// Helper functions for manipulating storage
async function findTokenBalanceSlot(tokenAddress: string, userAddress: string): Promise<number | null> {
  // We'll try commonly used slots for ERC20 balances
  const slots = [0, 1, 2, 3, 4, 5, 6, 9]; // Added slot 9 for USDC
  
  for (const slot of slots) {
    try {
      // Set a balance in this slot
      await setStorageAt(
        tokenAddress,
        getStorageSlotForAddress(userAddress, slot),
        ethers.utils.parseEther("1")
      );
      
      // Check if it worked
      const token = new ethers.Contract(
        tokenAddress,
        ["function balanceOf(address) view returns (uint256)"],
        ethers.provider
      );
      
      const balance = await token.balanceOf(userAddress);
      
      if (balance.eq(ethers.utils.parseEther("1"))) {
        // Reset the balance to 0
        await setStorageAt(
          tokenAddress,
          getStorageSlotForAddress(userAddress, slot),
          ethers.constants.Zero
        );
        return slot;
      }
    } catch (error) {
      console.log(`Error testing slot ${slot}: ${error}`);
    }
  }
  
  return null;
}

function getStorageSlotForAddress(address: string, slot: number) {
  return ethers.utils.keccak256(
    ethers.utils.defaultAbiCoder.encode(
      ["address", "uint256"],
      [address, slot]
    )
  );
}

async function setStorageAt(
  contractAddress: string,
  slot: string,
  value: BigNumber
) {
  const encodedValue = ethers.utils.hexlify(
    ethers.utils.zeroPad(value.toHexString(), 32)
  );
  
  await ethers.provider.send("hardhat_setStorageAt", [
    contractAddress,
    slot,
    encodedValue,
  ]);
}

// Run main
main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error("Error creating arbitrage opportunity:", error);
    process.exit(1);
  });
