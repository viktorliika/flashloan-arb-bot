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
  const logFile = path.join(__dirname, "../logs", `direct_arb_${new Date().toISOString().split('T')[0]}.log`);
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
  "function approve(address spender, uint256 amount) returns (bool)"
];

const ROUTER_ABI = [
  "function getAmountsOut(uint amountIn, address[] memory path) view returns (uint[] memory amounts)"
];

// Known token storage slots
const KNOWN_SLOTS: Record<string, number> = {
  // USDC has a different storage layout
  "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48": 9,
  // DAI slot
  "0x6B175474E89094C44Da98b954EedeAC495271d0F": 2,
  // WETH slot  
  "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2": 3
};

async function main() {
  log("Creating extreme direct arbitrage opportunity...");
  
  // Very large imbalance percentage for testing
  const imbalancePercent = 80;
  log(`Using ${imbalancePercent}% imbalance`);
  
  // Load configuration
  const config = loadForkConfig();
  
  // Use regular signer from hardhat
  const [deployer] = await ethers.getSigners();
  log(`Using account: ${deployer.address}`);
  
  // Make sure we have enough ETH
  await hre.network.provider.send("hardhat_setBalance", [
    deployer.address,
    "0x" + (1000n * 10n**18n).toString(16), // 1000 ETH
  ]);
  
  // Token addresses for the pair
  const wethAddress = config.weth;
  const daiAddress = config.dai;
  
  // Get uniswap factory
  const uniswapFactory = new ethers.Contract(
    "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f", // Uniswap V2 Factory
    ["function getPair(address tokenA, address tokenB) external view returns (address pair)"],
    deployer
  );
  
  // Get sushiswap factory
  const sushiswapFactory = new ethers.Contract(
    "0xC0AEe478e3658e2610c5F7A4A2E1777cE9e4f2Ac", // Sushiswap Factory
    ["function getPair(address tokenA, address tokenB) external view returns (address pair)"],
    deployer
  );
  
  // Get pairs
  const uniswapPair = await uniswapFactory.getPair(wethAddress, daiAddress);
  const sushiswapPair = await sushiswapFactory.getPair(wethAddress, daiAddress);
  
  log(`Found WETH-DAI pair on Uniswap at ${uniswapPair}`);
  log(`Found WETH-DAI pair on Sushiswap at ${sushiswapPair}`);
  
  // Connect to token contracts
  const weth = new ethers.Contract(wethAddress, ERC20_ABI, deployer);
  const dai = new ethers.Contract(daiAddress, ERC20_ABI, deployer);
  
  // Get token information
  const wethDecimals = await weth.decimals();
  const daiDecimals = await dai.decimals();
  
  log(`WETH: ${await weth.symbol()} (${wethDecimals} decimals)`);
  log(`DAI: ${await dai.symbol()} (${daiDecimals} decimals)`);
  
  // Connect to pairs
  const uniswapPairContract = new ethers.Contract(uniswapPair, PAIR_ABI, deployer);
  const sushiswapPairContract = new ethers.Contract(sushiswapPair, PAIR_ABI, deployer);
  
  // =================== Create imbalance in Uniswap WETH-DAI pair ===================
  log("\n=== Creating imbalance in Uniswap WETH-DAI pair ===");
  
  // Verify token order in Uniswap pair
  const uniToken0 = await uniswapPairContract.token0();
  const uniToken1 = await uniswapPairContract.token1();
  
  let wethIsToken0InUniswap = wethAddress.toLowerCase() === uniToken0.toLowerCase();
  log(`In Uniswap WETH-DAI pair: WETH is token${wethIsToken0InUniswap ? '0' : '1'}`);
  
  // Get reserves
  const [uniReserve0, uniReserve1] = await uniswapPairContract.getReserves();
  
  // Format reserves based on token order
  const wethReserveInUniswap = wethIsToken0InUniswap ? uniReserve0 : uniReserve1;
  const daiReserveInUniswap = wethIsToken0InUniswap ? uniReserve1 : uniReserve0;
  
  log(`Current Uniswap reserves: ${ethers.utils.formatUnits(wethReserveInUniswap, wethDecimals)} WETH, ${ethers.utils.formatUnits(daiReserveInUniswap, daiDecimals)} DAI`);
  
  // Create imbalance - add much more WETH than DAI
  // This will make WETH cheaper on Uniswap compared to Sushiswap
  const wethToAddUniswap = wethReserveInUniswap.mul(imbalancePercent).div(100);
  const daiToAddUniswap = daiReserveInUniswap.mul(5).div(100); // Only add 5% DAI
  
  // Get WETH from storage for first pool
  await setStorageAt(
    wethAddress,
    getStorageSlotForAddress(deployer.address, KNOWN_SLOTS[wethAddress]),
    wethToAddUniswap.mul(2)
  );
  
  // Get DAI from storage for first pool
  await setStorageAt(
    daiAddress,
    getStorageSlotForAddress(deployer.address, KNOWN_SLOTS[daiAddress]),
    daiToAddUniswap.mul(2)
  );
  
  // Transfer tokens to Uniswap pair
  log(`Adding ${ethers.utils.formatUnits(wethToAddUniswap, wethDecimals)} WETH and ${ethers.utils.formatUnits(daiToAddUniswap, daiDecimals)} DAI to Uniswap pair`);
  
  await weth.transfer(uniswapPair, wethToAddUniswap, { gasLimit: 300000 });
  await dai.transfer(uniswapPair, daiToAddUniswap, { gasLimit: 300000 });
  
  // Sync Uniswap pair
  await uniswapPairContract.sync({ gasLimit: 300000 });
  
  // Get new reserves
  const [newUniReserve0, newUniReserve1] = await uniswapPairContract.getReserves();
  
  // Format based on token order
  const newWethReserveInUniswap = wethIsToken0InUniswap ? newUniReserve0 : newUniReserve1;
  const newDaiReserveInUniswap = wethIsToken0InUniswap ? newUniReserve1 : newUniReserve0;
  
  log(`New Uniswap reserves: ${ethers.utils.formatUnits(newWethReserveInUniswap, wethDecimals)} WETH, ${ethers.utils.formatUnits(newDaiReserveInUniswap, daiDecimals)} DAI`);
  
  // =================== Create imbalance in Sushiswap WETH-DAI pair ===================
  log("\n=== Creating imbalance in Sushiswap WETH-DAI pair ===");
  
  // Verify token order in Sushiswap pair
  const sushiToken0 = await sushiswapPairContract.token0();
  const sushiToken1 = await sushiswapPairContract.token1();
  
  let wethIsToken0InSushiswap = wethAddress.toLowerCase() === sushiToken0.toLowerCase();
  log(`In Sushiswap WETH-DAI pair: WETH is token${wethIsToken0InSushiswap ? '0' : '1'}`);
  
  // Get reserves
  const [sushiReserve0, sushiReserve1] = await sushiswapPairContract.getReserves();
  
  // Format reserves based on token order
  const wethReserveInSushiswap = wethIsToken0InSushiswap ? sushiReserve0 : sushiReserve1;
  const daiReserveInSushiswap = wethIsToken0InSushiswap ? sushiReserve1 : sushiReserve0;
  
  log(`Current Sushiswap reserves: ${ethers.utils.formatUnits(wethReserveInSushiswap, wethDecimals)} WETH, ${ethers.utils.formatUnits(daiReserveInSushiswap, daiDecimals)} DAI`);
  
  // Create opposite imbalance - add much more DAI than WETH
  // This will make DAI cheaper on Sushiswap compared to Uniswap
  const wethToAddSushiswap = wethReserveInSushiswap.mul(5).div(100); // Only add 5% WETH
  const daiToAddSushiswap = daiReserveInSushiswap.mul(imbalancePercent).div(100);
  
  // Get more WETH from storage
  await setStorageAt(
    wethAddress,
    getStorageSlotForAddress(deployer.address, KNOWN_SLOTS[wethAddress]),
    wethToAddSushiswap.mul(2)
  );
  
  // Get more DAI from storage
  await setStorageAt(
    daiAddress,
    getStorageSlotForAddress(deployer.address, KNOWN_SLOTS[daiAddress]),
    daiToAddSushiswap.mul(2)
  );
  
  // Transfer tokens to Sushiswap pair
  log(`Adding ${ethers.utils.formatUnits(wethToAddSushiswap, wethDecimals)} WETH and ${ethers.utils.formatUnits(daiToAddSushiswap, daiDecimals)} DAI to Sushiswap pair`);
  
  await weth.transfer(sushiswapPair, wethToAddSushiswap, { gasLimit: 300000 });
  await dai.transfer(sushiswapPair, daiToAddSushiswap, { gasLimit: 300000 });
  
  // Sync Sushiswap pair
  await sushiswapPairContract.sync({ gasLimit: 300000 });
  
  // Get new reserves
  const [newSushiReserve0, newSushiReserve1] = await sushiswapPairContract.getReserves();
  
  // Format based on token order
  const newWethReserveInSushiswap = wethIsToken0InSushiswap ? newSushiReserve0 : newSushiReserve1;
  const newDaiReserveInSushiswap = wethIsToken0InSushiswap ? newSushiReserve1 : newSushiReserve0;
  
  log(`New Sushiswap reserves: ${ethers.utils.formatUnits(newWethReserveInSushiswap, wethDecimals)} WETH, ${ethers.utils.formatUnits(newDaiReserveInSushiswap, daiDecimals)} DAI`);
  
  // =================== Calculate cross-exchange prices ===================
  log("\n=== Cross-exchange price analysis ===");
  
  // Connect to routers
  const uniswapRouter = new ethers.Contract(config.uniswapV2Router, ROUTER_ABI, deployer);
  const sushiswapRouter = new ethers.Contract(config.sushiswapRouter, ROUTER_ABI, deployer);
  
  // Check WETH -> DAI prices
  const wethDaiPath = [wethAddress, daiAddress];
  
  // How much DAI do we get for 1 WETH?
  const wethToDaiUniswap = await uniswapRouter.getAmountsOut(
    ethers.utils.parseUnits("1", wethDecimals), 
    wethDaiPath
  );
  
  const wethToDaiSushiswap = await sushiswapRouter.getAmountsOut(
    ethers.utils.parseUnits("1", wethDecimals), 
    wethDaiPath
  );
  
  const daiForWethUniswap = ethers.utils.formatUnits(wethToDaiUniswap[1], daiDecimals);
  const daiForWethSushiswap = ethers.utils.formatUnits(wethToDaiSushiswap[1], daiDecimals);
  
  log(`1 WETH -> ${daiForWethUniswap} DAI on Uniswap`);
  log(`1 WETH -> ${daiForWethSushiswap} DAI on Sushiswap`);
  
  // Check DAI -> WETH prices
  const daiWethPath = [daiAddress, wethAddress];
  
  // How much WETH do we get for 1000 DAI?
  const daiToWethUniswap = await uniswapRouter.getAmountsOut(
    ethers.utils.parseUnits("1000", daiDecimals), 
    daiWethPath
  );
  
  const daiToWethSushiswap = await sushiswapRouter.getAmountsOut(
    ethers.utils.parseUnits("1000", daiDecimals), 
    daiWethPath
  );
  
  const wethForDaiUniswap = ethers.utils.formatUnits(daiToWethUniswap[1], wethDecimals);
  const wethForDaiSushiswap = ethers.utils.formatUnits(daiToWethSushiswap[1], wethDecimals);
  
  log(`1000 DAI -> ${wethForDaiUniswap} WETH on Uniswap`);
  log(`1000 DAI -> ${wethForDaiSushiswap} WETH on Sushiswap`);
  
  // Calculate arbitrage opportunity
  log("\n=== Direct arbitrage analysis ===");
  
  // Here we'll analyze both potential paths:
  // 1. Buy WETH on Uniswap (using DAI), sell WETH on Sushiswap (for DAI)
  // 2. Buy WETH on Sushiswap (using DAI), sell WETH on Uniswap (for DAI)
  
  // Check first path: Buy WETH on Uniswap, sell on Sushiswap
  const daiAmount = ethers.utils.parseUnits("10000", daiDecimals);
  const wethFromUniswap = await uniswapRouter.getAmountsOut(daiAmount, daiWethPath);
  const daiFromSushiswap = await sushiswapRouter.getAmountsOut(wethFromUniswap[1], wethDaiPath);
  
  const startDai = ethers.utils.formatUnits(daiAmount, daiDecimals);
  const wethMiddle = ethers.utils.formatUnits(wethFromUniswap[1], wethDecimals);
  const endDai = ethers.utils.formatUnits(daiFromSushiswap[1], daiDecimals);
  
  const profit1 = daiFromSushiswap[1].sub(daiAmount);
  const profitPercent1 = parseFloat(ethers.utils.formatUnits(profit1, daiDecimals)) / parseFloat(startDai) * 100;
  
  log(`Path 1: ${startDai} DAI -> ${wethMiddle} WETH (Uniswap) -> ${endDai} DAI (Sushiswap)`);
  if (profit1.gt(0)) {
    log(`✅ PROFITABLE! You'd make ${ethers.utils.formatUnits(profit1, daiDecimals)} DAI (${profitPercent1.toFixed(2)}%) before fees`);
  } else {
    log(`❌ NOT PROFITABLE! You'd lose ${ethers.utils.formatUnits(profit1.mul(-1), daiDecimals)} DAI (${Math.abs(profitPercent1).toFixed(2)}%)`);
  }
  
  // Check second path: Buy WETH on Sushiswap, sell on Uniswap
  const wethFromSushiswap = await sushiswapRouter.getAmountsOut(daiAmount, daiWethPath);
  const daiFromUniswap = await uniswapRouter.getAmountsOut(wethFromSushiswap[1], wethDaiPath);
  
  const wethMiddle2 = ethers.utils.formatUnits(wethFromSushiswap[1], wethDecimals);
  const endDai2 = ethers.utils.formatUnits(daiFromUniswap[1], daiDecimals);
  
  const profit2 = daiFromUniswap[1].sub(daiAmount);
  const profitPercent2 = parseFloat(ethers.utils.formatUnits(profit2, daiDecimals)) / parseFloat(startDai) * 100;
  
  log(`Path 2: ${startDai} DAI -> ${wethMiddle2} WETH (Sushiswap) -> ${endDai2} DAI (Uniswap)`);
  if (profit2.gt(0)) {
    log(`✅ PROFITABLE! You'd make ${ethers.utils.formatUnits(profit2, daiDecimals)} DAI (${profitPercent2.toFixed(2)}%) before fees`);
  } else {
    log(`❌ NOT PROFITABLE! You'd lose ${ethers.utils.formatUnits(profit2.mul(-1), daiDecimals)} DAI (${Math.abs(profitPercent2).toFixed(2)}%)`);
  }
  
  // Summary and recommendation
  log("\n=== Summary ===");
  
  if (profit1.gt(profit2)) {
    log(`The best arbitrage path is: DAI -> WETH (Uniswap) -> DAI (Sushiswap)`);
    if (profit1.gt(0)) {
      log(`Expected profit: ${ethers.utils.formatUnits(profit1, daiDecimals)} DAI (${profitPercent1.toFixed(2)}%)`);
    }
  } else {
    log(`The best arbitrage path is: DAI -> WETH (Sushiswap) -> DAI (Uniswap)`);
    if (profit2.gt(0)) {
      log(`Expected profit: ${ethers.utils.formatUnits(profit2, daiDecimals)} DAI (${profitPercent2.toFixed(2)}%)`);
    }
  }
  
  log("\nTo execute this arbitrage:");
  log("1. Ensure your min profit threshold is near zero (npm run reduce:profit)");
  log("2. Use FlashloanArbV2 to execute the arbitrage with just two tokens");
  log("3. Profit should be immediately apparent as the price difference is significant");
}

// Helper functions for storage slots
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
    console.error("Error creating direct arbitrage:", error);
    process.exit(1);
  });
