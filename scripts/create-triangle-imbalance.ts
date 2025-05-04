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
  const logFile = path.join(__dirname, "../logs", `triangle_imbalance_${new Date().toISOString().split('T')[0]}.log`);
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
const KNOWN_SLOTS = {
  // USDC has a different storage layout
  "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48": 9,
  // DAI slot
  "0x6B175474E89094C44Da98b954EedeAC495271d0F": 2,
  // WETH slot  
  "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2": 3
};

async function main() {
  // We'll create large imbalances in all three pools in the triangle:
  // WETH-DAI, DAI-USDC, and WETH-USDC
  log("Creating triple imbalance for triangle arbitrage...");
  
  // Large imbalance percentage (25% is very significant)
  const imbalancePercent = 25;
  log(`Using ${imbalancePercent}% imbalance for all pools`);
  
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
  
  // Token addresses for all tokens in the triangle
  const wethAddress = config.weth;
  const daiAddress = config.dai;
  const usdcAddress = config.usdc;
  
  // First DEX - Uniswap for all three pairs
  const dex = "uniswap";
  const factory = new ethers.Contract(
    "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f", // Uniswap V2 Factory
    ["function getPair(address tokenA, address tokenB) external view returns (address pair)"],
    deployer
  );
  
  // Get all three pair addresses
  const wethDaiPair = await factory.getPair(wethAddress, daiAddress);
  const daiUsdcPair = await factory.getPair(daiAddress, usdcAddress);
  const wethUsdcPair = await factory.getPair(wethAddress, usdcAddress);
  
  log(`Found WETH-DAI pair at ${wethDaiPair}`);
  log(`Found DAI-USDC pair at ${daiUsdcPair}`);
  log(`Found WETH-USDC pair at ${wethUsdcPair}`);
  
  // Connect to token contracts
  const weth = new ethers.Contract(wethAddress, ERC20_ABI, deployer);
  const dai = new ethers.Contract(daiAddress, ERC20_ABI, deployer);
  const usdc = new ethers.Contract(usdcAddress, ERC20_ABI, deployer);
  
  // Get token information
  const wethDecimals = await weth.decimals();
  const daiDecimals = await dai.decimals();
  const usdcDecimals = await usdc.decimals();
  
  log(`WETH: ${await weth.symbol()} (${wethDecimals} decimals)`);
  log(`DAI: ${await dai.symbol()} (${daiDecimals} decimals)`);
  log(`USDC: ${await usdc.symbol()} (${usdcDecimals} decimals)`);
  
  // Connect to all pairs
  const wethDaiContract = new ethers.Contract(wethDaiPair, PAIR_ABI, deployer);
  const daiUsdcContract = new ethers.Contract(daiUsdcPair, PAIR_ABI, deployer);
  const wethUsdcContract = new ethers.Contract(wethUsdcPair, PAIR_ABI, deployer);
  
  // =================== 1. Create imbalance in WETH-DAI pair ===================
  log("\n=== Creating imbalance in WETH-DAI pair ===");
  
  // Verify token order in pair
  const wethDaiToken0 = await wethDaiContract.token0();
  const wethDaiToken1 = await wethDaiContract.token1();
  
  let wethIsToken0InWethDai = wethAddress.toLowerCase() === wethDaiToken0.toLowerCase();
  log(`In WETH-DAI pair: WETH is token${wethIsToken0InWethDai ? '0' : '1'}`);
  
  // Get reserves
  const [wethDaiReserve0, wethDaiReserve1] = await wethDaiContract.getReserves();
  
  // Format reserves based on token order
  const wethReserveInWethDai = wethIsToken0InWethDai ? wethDaiReserve0 : wethDaiReserve1;
  const daiReserveInWethDai = wethIsToken0InWethDai ? wethDaiReserve1 : wethDaiReserve0;
  
  log(`Current WETH-DAI reserves: ${ethers.utils.formatUnits(wethReserveInWethDai, wethDecimals)} WETH, ${ethers.utils.formatUnits(daiReserveInWethDai, daiDecimals)} DAI`);
  
  // Create imbalance - increase WETH
  const wethToAdd = wethReserveInWethDai.mul(imbalancePercent).div(100);
  const daiToAdd = daiReserveInWethDai.mul(imbalancePercent).div(400); // Add less DAI (divide by 4 = div(400) instead of div(100))
  
  // Get WETH from storage
  await setStorageAt(
    wethAddress,
    getStorageSlotForAddress(deployer.address, KNOWN_SLOTS[wethAddress]),
    wethToAdd.mul(2)
  );
  
  // Get DAI from storage
  await setStorageAt(
    daiAddress,
    getStorageSlotForAddress(deployer.address, KNOWN_SLOTS[daiAddress]),
    daiToAdd.mul(2)
  );
  
  // Transfer tokens to pair
  log(`Adding ${ethers.utils.formatUnits(wethToAdd, wethDecimals)} WETH and ${ethers.utils.formatUnits(daiToAdd, daiDecimals)} DAI to WETH-DAI pair`);
  
  // Transfer tokens
  await weth.transfer(wethDaiPair, wethToAdd, { gasLimit: 300000 });
  await dai.transfer(wethDaiPair, daiToAdd, { gasLimit: 300000 });
  
  // Sync pair
  await wethDaiContract.sync({ gasLimit: 300000 });
  
  // Get new reserves
  const [newWethDaiReserve0, newWethDaiReserve1] = await wethDaiContract.getReserves();
  
  // Format based on token order
  const newWethReserveInWethDai = wethIsToken0InWethDai ? newWethDaiReserve0 : newWethDaiReserve1;
  const newDaiReserveInWethDai = wethIsToken0InWethDai ? newWethDaiReserve1 : newWethDaiReserve0;
  
  log(`New WETH-DAI reserves: ${ethers.utils.formatUnits(newWethReserveInWethDai, wethDecimals)} WETH, ${ethers.utils.formatUnits(newDaiReserveInWethDai, daiDecimals)} DAI`);
  
  // =================== 2. Create imbalance in DAI-USDC pair ===================
  log("\n=== Creating imbalance in DAI-USDC pair ===");
  
  // Verify token order
  const daiUsdcToken0 = await daiUsdcContract.token0();
  const daiUsdcToken1 = await daiUsdcContract.token1();
  
  let daiIsToken0InDaiUsdc = daiAddress.toLowerCase() === daiUsdcToken0.toLowerCase();
  log(`In DAI-USDC pair: DAI is token${daiIsToken0InDaiUsdc ? '0' : '1'}`);
  
  // Get reserves
  const [daiUsdcReserve0, daiUsdcReserve1] = await daiUsdcContract.getReserves();
  
  // Format reserves based on token order
  const daiReserveInDaiUsdc = daiIsToken0InDaiUsdc ? daiUsdcReserve0 : daiUsdcReserve1;
  const usdcReserveInDaiUsdc = daiIsToken0InDaiUsdc ? daiUsdcReserve1 : daiUsdcReserve0;
  
  log(`Current DAI-USDC reserves: ${ethers.utils.formatUnits(daiReserveInDaiUsdc, daiDecimals)} DAI, ${ethers.utils.formatUnits(usdcReserveInDaiUsdc, usdcDecimals)} USDC`);
  
  // Create imbalance - increase DAI
  const daiToAddForDaiUsdc = daiReserveInDaiUsdc.mul(imbalancePercent).div(100);
  const usdcToAdd = usdcReserveInDaiUsdc.mul(imbalancePercent).div(400); // Add less USDC (divide by 4 = div(400) instead of div(100))
  
  // Get more DAI from storage
  await setStorageAt(
    daiAddress,
    getStorageSlotForAddress(deployer.address, KNOWN_SLOTS[daiAddress]),
    daiToAddForDaiUsdc.mul(2)
  );
  
  // Get USDC from storage
  await setStorageAt(
    usdcAddress,
    getStorageSlotForAddress(deployer.address, KNOWN_SLOTS[usdcAddress]),
    usdcToAdd.mul(2)
  );
  
  // Transfer tokens to pair
  log(`Adding ${ethers.utils.formatUnits(daiToAddForDaiUsdc, daiDecimals)} DAI and ${ethers.utils.formatUnits(usdcToAdd, usdcDecimals)} USDC to DAI-USDC pair`);
  
  // Transfer tokens
  await dai.transfer(daiUsdcPair, daiToAddForDaiUsdc, { gasLimit: 300000 });
  await usdc.transfer(daiUsdcPair, usdcToAdd, { gasLimit: 300000 });
  
  // Sync pair
  await daiUsdcContract.sync({ gasLimit: 300000 });
  
  // Get new reserves
  const [newDaiUsdcReserve0, newDaiUsdcReserve1] = await daiUsdcContract.getReserves();
  
  // Format based on token order
  const newDaiReserveInDaiUsdc = daiIsToken0InDaiUsdc ? newDaiUsdcReserve0 : newDaiUsdcReserve1;
  const newUsdcReserveInDaiUsdc = daiIsToken0InDaiUsdc ? newDaiUsdcReserve1 : newDaiUsdcReserve0;
  
  log(`New DAI-USDC reserves: ${ethers.utils.formatUnits(newDaiReserveInDaiUsdc, daiDecimals)} DAI, ${ethers.utils.formatUnits(newUsdcReserveInDaiUsdc, usdcDecimals)} USDC`);
  
  // =================== 3. Create imbalance in WETH-USDC pair ===================
  log("\n=== Creating imbalance in WETH-USDC pair ===");
  
  // Verify token order
  const wethUsdcToken0 = await wethUsdcContract.token0();
  const wethUsdcToken1 = await wethUsdcContract.token1();
  
  let wethIsToken0InWethUsdc = wethAddress.toLowerCase() === wethUsdcToken0.toLowerCase();
  log(`In WETH-USDC pair: WETH is token${wethIsToken0InWethUsdc ? '0' : '1'}`);
  
  // Get reserves
  const [wethUsdcReserve0, wethUsdcReserve1] = await wethUsdcContract.getReserves();
  
  // Format reserves based on token order
  const wethReserveInWethUsdc = wethIsToken0InWethUsdc ? wethUsdcReserve0 : wethUsdcReserve1;
  const usdcReserveInWethUsdc = wethIsToken0InWethUsdc ? wethUsdcReserve1 : wethUsdcReserve0;
  
  log(`Current WETH-USDC reserves: ${ethers.utils.formatUnits(wethReserveInWethUsdc, wethDecimals)} WETH, ${ethers.utils.formatUnits(usdcReserveInWethUsdc, usdcDecimals)} USDC`);
  
  // Create imbalance - increase USDC
  const wethToAddForWethUsdc = wethReserveInWethUsdc.mul(imbalancePercent).div(400); // Add less WETH (divide by 4 = div(400) instead of div(100))
  const usdcToAddForWethUsdc = usdcReserveInWethUsdc.mul(imbalancePercent).div(100);
  
  // Get more WETH from storage
  await setStorageAt(
    wethAddress,
    getStorageSlotForAddress(deployer.address, KNOWN_SLOTS[wethAddress]),
    wethToAddForWethUsdc.mul(2)
  );
  
  // Get more USDC from storage
  await setStorageAt(
    usdcAddress,
    getStorageSlotForAddress(deployer.address, KNOWN_SLOTS[usdcAddress]),
    usdcToAddForWethUsdc.mul(2)
  );
  
  // Transfer tokens to pair
  log(`Adding ${ethers.utils.formatUnits(wethToAddForWethUsdc, wethDecimals)} WETH and ${ethers.utils.formatUnits(usdcToAddForWethUsdc, usdcDecimals)} USDC to WETH-USDC pair`);
  
  // Transfer tokens
  await weth.transfer(wethUsdcPair, wethToAddForWethUsdc, { gasLimit: 300000 });
  await usdc.transfer(wethUsdcPair, usdcToAddForWethUsdc, { gasLimit: 300000 });
  
  // Sync pair
  await wethUsdcContract.sync({ gasLimit: 300000 });
  
  // Get new reserves
  const [newWethUsdcReserve0, newWethUsdcReserve1] = await wethUsdcContract.getReserves();
  
  // Format based on token order
  const newWethReserveInWethUsdc = wethIsToken0InWethUsdc ? newWethUsdcReserve0 : newWethUsdcReserve1;
  const newUsdcReserveInWethUsdc = wethIsToken0InWethUsdc ? newWethUsdcReserve1 : newWethUsdcReserve0;
  
  log(`New WETH-USDC reserves: ${ethers.utils.formatUnits(newWethReserveInWethUsdc, wethDecimals)} WETH, ${ethers.utils.formatUnits(newUsdcReserveInWethUsdc, usdcDecimals)} USDC`);
  
  // =================== Calculate cross-exchange prices ===================
  log("\n=== Cross-exchange price analysis ===");
  
  // Now let's check if we've created an arbitrage opportunity
  const uniswapRouter = new ethers.Contract(config.uniswapV2Router, ROUTER_ABI, deployer);
  const sushiswapRouter = new ethers.Contract(config.sushiswapRouter, ROUTER_ABI, deployer);
  
  // Check WETH -> DAI 
  const wethDaiPathUni = [wethAddress, daiAddress];
  const wethDaiAmountsUni = await uniswapRouter.getAmountsOut(ethers.utils.parseUnits("1", wethDecimals), wethDaiPathUni);
  const wethDaiAmountsSushi = await sushiswapRouter.getAmountsOut(ethers.utils.parseUnits("1", wethDecimals), wethDaiPathUni);
  
  log(`1 WETH -> DAI on Uniswap: ${ethers.utils.formatUnits(wethDaiAmountsUni[1], daiDecimals)} DAI`);
  log(`1 WETH -> DAI on Sushiswap: ${ethers.utils.formatUnits(wethDaiAmountsSushi[1], daiDecimals)} DAI`);
  
  // Check DAI -> USDC
  const daiUsdcPathUni = [daiAddress, usdcAddress];
  const daiUsdcAmountsUni = await uniswapRouter.getAmountsOut(ethers.utils.parseUnits("1", daiDecimals), daiUsdcPathUni);
  const daiUsdcAmountsSushi = await sushiswapRouter.getAmountsOut(ethers.utils.parseUnits("1", daiDecimals), daiUsdcPathUni);
  
  log(`1 DAI -> USDC on Uniswap: ${ethers.utils.formatUnits(daiUsdcAmountsUni[1], usdcDecimals)} USDC`);
  log(`1 DAI -> USDC on Sushiswap: ${ethers.utils.formatUnits(daiUsdcAmountsSushi[1], usdcDecimals)} USDC`);
  
  // Check USDC -> WETH
  const usdcWethPathUni = [usdcAddress, wethAddress];
  const usdcWethAmountsUni = await uniswapRouter.getAmountsOut(ethers.utils.parseUnits("1", usdcDecimals), usdcWethPathUni);
  const usdcWethAmountsSushi = await sushiswapRouter.getAmountsOut(ethers.utils.parseUnits("1", usdcDecimals), usdcWethPathUni);
  
  log(`1 USDC -> WETH on Uniswap: ${ethers.utils.formatUnits(usdcWethAmountsUni[1], wethDecimals)} WETH`);
  log(`1 USDC -> WETH on Sushiswap: ${ethers.utils.formatUnits(usdcWethAmountsSushi[1], wethDecimals)} WETH`);
  
  // Calculate theoretical triangle arbitrage
  log("\n=== Triangle arbitrage analysis ===");
  
  // Starting with 1 WETH
  const startAmount = ethers.utils.parseUnits("1", wethDecimals);
  
  // Best DEX for WETH -> DAI
  const wethToDaiDex = parseFloat(ethers.utils.formatUnits(wethDaiAmountsUni[1], daiDecimals)) > 
                      parseFloat(ethers.utils.formatUnits(wethDaiAmountsSushi[1], daiDecimals)) ? 
                      "Uniswap" : "Sushiswap";
  
  const wethToDaiAmount = wethToDaiDex === "Uniswap" ? wethDaiAmountsUni[1] : wethDaiAmountsSushi[1];
  
  // Best DEX for DAI -> USDC
  const daiToUsdcDex = parseFloat(ethers.utils.formatUnits(daiUsdcAmountsUni[1], usdcDecimals)) > 
                      parseFloat(ethers.utils.formatUnits(daiUsdcAmountsSushi[1], usdcDecimals)) ? 
                      "Uniswap" : "Sushiswap";
  
  // Scale up to use the WETH->DAI amount
  const daiToUsdcAmountsUni_scaled = await uniswapRouter.getAmountsOut(wethToDaiAmount, daiUsdcPathUni);
  const daiToUsdcAmountsSushi_scaled = await sushiswapRouter.getAmountsOut(wethToDaiAmount, daiUsdcPathUni);
  
  const daiToUsdcAmount = daiToUsdcDex === "Uniswap" ? daiToUsdcAmountsUni_scaled[1] : daiToUsdcAmountsSushi_scaled[1];
  
  // Best DEX for USDC -> WETH
  const usdcToWethDex = parseFloat(ethers.utils.formatUnits(usdcWethAmountsUni[1], wethDecimals)) > 
                        parseFloat(ethers.utils.formatUnits(usdcWethAmountsSushi[1], wethDecimals)) ? 
                        "Uniswap" : "Sushiswap";
  
  // Scale up to use the DAI->USDC amount
  const usdcToWethAmountsUni_scaled = await uniswapRouter.getAmountsOut(daiToUsdcAmount, usdcWethPathUni);
  const usdcToWethAmountsSushi_scaled = await sushiswapRouter.getAmountsOut(daiToUsdcAmount, usdcWethPathUni);
  
  const usdcToWethAmount = usdcToWethDex === "Uniswap" ? usdcToWethAmountsUni_scaled[1] : usdcToWethAmountsSushi_scaled[1];
  
  // Calculate profit or loss
  const profit = usdcToWethAmount.sub(startAmount);
  const profitPercent = parseFloat(ethers.utils.formatUnits(profit, wethDecimals)) * 100;
  
  log(`Optimal path: 1 WETH -> ${ethers.utils.formatUnits(wethToDaiAmount, daiDecimals)} DAI (${wethToDaiDex}) -> ${ethers.utils.formatUnits(daiToUsdcAmount, usdcDecimals)} USDC (${daiToUsdcDex}) -> ${ethers.utils.formatUnits(usdcToWethAmount, wethDecimals)} WETH (${usdcToWethDex})`);
  
  if (profit.gt(0)) {
    log(`✅ PROFITABLE! You'd make ${ethers.utils.formatUnits(profit, wethDecimals)} WETH (${profitPercent.toFixed(2)}%) before fees`);
  } else {
    log(`❌ NOT PROFITABLE! You'd lose ${ethers.utils.formatUnits(profit.mul(-1), wethDecimals)} WETH (${Math.abs(profitPercent).toFixed(2)}%)`);
  }
  
  const optimalDexSequence = [
    wethToDaiDex === "Uniswap" ? 0 : 1,
    daiToUsdcDex === "Uniswap" ? 0 : 1,
    usdcToWethDex === "Uniswap" ? 0 : 1
  ];
  
  log(`\nOptimal DEX sequence: [${optimalDexSequence.join(', ')}]`);
  log(`Use this sequence with the executeTriangleArbitrage function for best results.`);
  
  // Summary
  log("\n=== Summary ===");
  log(`Created significant imbalances in all three pools of the triangle arbitrage path.`);
  log(`The optimal arbitrage path is: WETH -> DAI (${wethToDaiDex}) -> USDC (${daiToUsdcDex}) -> WETH (${usdcToWethDex})`);
  log(`For best results, use a larger loan amount and set minimum profit to near zero.`);
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
    console.error("Error creating triangle imbalance:", error);
    process.exit(1);
  });
