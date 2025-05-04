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
  const logFile = path.join(__dirname, "../logs", `create_arb_${new Date().toISOString().split('T')[0]}.log`);
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
  "function swap(uint amount0Out, uint amount1Out, address to, bytes calldata data) external",
  "function skim(address to) external"
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
  imbalancePercent: number;  // How much to imbalance the pool (e.g., 10 for 10%)
  direction: string;  // Which token to increase ("token0" or "token1")
}

async function main() {
  // Default options
  const options: Options = {
    pairToManipulate: "DAI-USDC",
    exchange: "sushiswap",
    imbalancePercent: 5,  // Reduced from 20% to 5% to avoid K constraint failure
    direction: "token0"  // Increase token0 (decreasing token1)
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
  
  log("Creating artificial arbitrage opportunity...");
  log(`Settings: Pair=${options.pairToManipulate}, Exchange=${options.exchange}, Imbalance=${options.imbalancePercent}%, Direction=${options.direction}`);
  
  // Load configuration
  const config = loadForkConfig();
  
  // Use regular signer from hardhat, not an impersonated account
  const [deployer] = await ethers.getSigners();
  log(`Using deployer account: ${deployer.address}`);
  
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
  
  // Calculate amount to manipulate pool
  let amount0Delta: BigNumber;
  let amount1Delta: BigNumber;
  
  if (options.direction === "token0") {
    // We want to increase token0 reserve
    amount0Delta = reserve0.mul(options.imbalancePercent).div(100);
    // Calculate what token1 amount should decrease to maintain k=x*y
    const newReserve0 = reserve0.add(amount0Delta);
    const k = reserve0.mul(reserve1);
    const newReserve1 = k.div(newReserve0);
    amount1Delta = reserve1.sub(newReserve1);
    
    log(`Target: Add ${ethers.utils.formatUnits(amount0Delta, token0Decimals)} ${token0Symbol} and remove ${ethers.utils.formatUnits(amount1Delta, token1Decimals)} ${token1Symbol}`);
  } else {
    // We want to increase token1 reserve
    amount1Delta = reserve1.mul(options.imbalancePercent).div(100);
    // Calculate what token0 amount should decrease to maintain k=x*y
    const newReserve1 = reserve1.add(amount1Delta);
    const k = reserve0.mul(reserve1);
    const newReserve0 = k.div(newReserve1);
    amount0Delta = reserve0.sub(newReserve0);
    
    log(`Target: Add ${ethers.utils.formatUnits(amount1Delta, token1Decimals)} ${token1Symbol} and remove ${ethers.utils.formatUnits(amount0Delta, token0Decimals)} ${token0Symbol}`);
  }
  
  // Here, instead of trying to impersonate accounts, we'll use a more direct approach
  // We'll manipulate the EVM state directly to create token imbalances
  
  // 1. Create some tokens for ourselves using hardhat's debugging features
  if (options.direction === "token0") {
    // Generate token0 for ourselves
    const TOKEN_SLOT = await findTokenBalanceSlot(token0.address, deployer.address);
    if (!TOKEN_SLOT) {
      throw new Error(`Could not find storage slot for ${token0Symbol}`);
    }
    
    log(`Found storage slot for ${token0Symbol} balance: ${TOKEN_SLOT}`);
    
    // Give ourselves enough tokens
    await setStorageAt(
      token0.address,
      getStorageSlotForAddress(deployer.address, TOKEN_SLOT),
      amount0Delta.mul(2) // Double what we need
    );
    
    const newBalance = await token0.balanceOf(deployer.address);
    log(`Set deployer balance of ${token0Symbol} to ${ethers.utils.formatUnits(newBalance, token0Decimals)}`);
    
    // 2. Now we transfer tokens to the pair
    await token0.transfer(pairAddress, amount0Delta);
    log(`Transferred ${ethers.utils.formatUnits(amount0Delta, token0Decimals)} ${token0Symbol} to the pair`);
    
    // 3. Now we need to withdraw token1 from the pair
    // We use a direct swap for this
    log(`Requesting swap to withdraw ${ethers.utils.formatUnits(amount1Delta, token1Decimals)} ${token1Symbol}`);
    await pair.swap(0, amount1Delta, deployer.address, "0x");
    
  } else {
    // Generate token1 for ourselves
    const TOKEN_SLOT = await findTokenBalanceSlot(token1.address, deployer.address);
    if (!TOKEN_SLOT) {
      throw new Error(`Could not find storage slot for ${token1Symbol}`);
    }
    
    log(`Found storage slot for ${token1Symbol} balance: ${TOKEN_SLOT}`);
    
    // Give ourselves enough tokens
    await setStorageAt(
      token1.address,
      getStorageSlotForAddress(deployer.address, TOKEN_SLOT),
      amount1Delta.mul(2) // Double what we need
    );
    
    const newBalance = await token1.balanceOf(deployer.address);
    log(`Set deployer balance of ${token1Symbol} to ${ethers.utils.formatUnits(newBalance, token1Decimals)}`);
    
    // 2. Now we transfer tokens to the pair
    await token1.transfer(pairAddress, amount1Delta);
    log(`Transferred ${ethers.utils.formatUnits(amount1Delta, token1Decimals)} ${token1Symbol} to the pair`);
    
    // 3. Now we need to withdraw token0 from the pair
    // We use a direct swap for this
    log(`Requesting swap to withdraw ${ethers.utils.formatUnits(amount0Delta, token0Decimals)} ${token0Symbol}`);
    await pair.swap(amount0Delta, 0, deployer.address, "0x");
  }
  
  // Verify the reserves changed as expected
  const [newReserve0, newReserve1] = await pair.getReserves();
  log(`New reserves: ${ethers.utils.formatUnits(newReserve0, token0Decimals)} ${token0Symbol}, ${ethers.utils.formatUnits(newReserve1, token1Decimals)} ${token1Symbol}`);
  
  // Calculate price impact
  const oldPrice = reserve1.mul(ethers.BigNumber.from(10).pow(token0Decimals)).div(reserve0.mul(ethers.BigNumber.from(10).pow(token1Decimals)));
  const newPrice = newReserve1.mul(ethers.BigNumber.from(10).pow(token0Decimals)).div(newReserve0.mul(ethers.BigNumber.from(10).pow(token1Decimals)));
  
  const priceChangePercent = Math.abs(newPrice.sub(oldPrice).mul(100).div(oldPrice).toNumber());
  log(`Price impact: ${priceChangePercent}% change in ${token0Symbol}/${token1Symbol} price`);
  
  // Check price difference between exchanges if we manipulated one of them
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
        
        // Estimate flash loan profit for a moderate amount
        const flashLoanAmount = ethers.utils.parseUnits("10", token0Decimals); // 10 token0
        const flashLoanFee = flashLoanAmount.mul(9).div(10000); // 0.09% Aave fee
        
        let buyRouter, sellRouter;
        if (buyExchange === "uniswap") {
          buyRouter = new ethers.Contract(config.uniswapV2Router, ROUTER_ABI, deployer);
          sellRouter = new ethers.Contract(config.sushiswapRouter, ROUTER_ABI, deployer);
        } else {
          buyRouter = new ethers.Contract(config.sushiswapRouter, ROUTER_ABI, deployer);
          sellRouter = new ethers.Contract(config.uniswapV2Router, ROUTER_ABI, deployer);
        }
        
        // Simulate the buys and sells
        const buyAmounts = await buyRouter.getAmountsOut(flashLoanAmount, path);
        const intermediateAmount = buyAmounts[1];
        
        const reversePath = [orderedToken1, orderedToken0];
        const sellAmounts = await sellRouter.getAmountsOut(intermediateAmount, reversePath);
        const finalAmount = sellAmounts[1];
        
        // Calculate profit
        const profit = finalAmount.sub(flashLoanAmount).sub(flashLoanFee);
        const profitPercent = profit.mul(10000).div(flashLoanAmount).toNumber() / 100;
        
        log(`Flash loan simulation:`);
        log(`- Borrow: ${ethers.utils.formatUnits(flashLoanAmount, token0Decimals)} ${token0Symbol}`);
        log(`- Fee: ${ethers.utils.formatUnits(flashLoanFee, token0Decimals)} ${token0Symbol}`);
        log(`- Buy on ${buyExchange}: ${ethers.utils.formatUnits(intermediateAmount, token1Decimals)} ${token1Symbol}`);
        log(`- Sell on ${sellExchange}: ${ethers.utils.formatUnits(finalAmount, token0Decimals)} ${token0Symbol}`);
        
        if (profit.gt(0)) {
          log(`🚀 Profitable arbitrage! Net profit: ${ethers.utils.formatUnits(profit, token0Decimals)} ${token0Symbol} (${profitPercent.toFixed(2)}%)`);
        } else {
          log(`⚠️ Not profitable after fees. Loss: ${ethers.utils.formatUnits(profit.mul(-1), token0Decimals)} ${token0Symbol}`);
          log(`Try increasing the imbalance percentage.`);
        }
      } else {
        log(`⚠️ Insufficient price difference for profitable arbitrage. Try increasing imbalance percentage.`);
      }
    } catch (error) {
      log(`Error calculating arbitrage: ${error}`);
    }
  }
  
  log("Arbitrage opportunity creation completed!");
}

// Helper functions for manipulating storage
async function findTokenBalanceSlot(tokenAddress: string, userAddress: string): Promise<number | null> {
  // We'll try commonly used slots for ERC20 balances
  const slots = [0, 1, 2, 3, 4, 5, 6];
  
  for (const slot of slots) {
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
