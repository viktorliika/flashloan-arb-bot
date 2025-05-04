// Import hardhat runtime
const hre = require("hardhat");
const ethers = hre.ethers;
import * as fs from "fs";
import * as path from "path";

// Load forked mainnet configuration
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

// Setup logging function
function log(message: string) {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

// ABIs for liquidity pool inspection
const UNISWAP_V2_PAIR_ABI = [
  "function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
  "function token0() external view returns (address)",
  "function token1() external view returns (address)"
];

const FACTORY_ABI = [
  "function getPair(address tokenA, address tokenB) external view returns (address pair)"
];

const ERC20_ABI = [
  "function decimals() external view returns (uint8)",
  "function symbol() external view returns (string)",
  "function name() external view returns (string)"
];

async function main() {
  log("Starting pool liquidity check on forked mainnet...");
  
  // Load configuration
  const config = loadForkConfig();
  log(`Loaded fork config with network ID: ${config.networkId}`);
  
  // Get signer
  const [deployer] = await ethers.getSigners();
  log(`Using account: ${deployer.address}`);
  
  // Connect to tokens
  const weth = new ethers.Contract(config.weth, ERC20_ABI, deployer);
  const dai = new ethers.Contract(config.dai, ERC20_ABI, deployer);
  const usdc = new ethers.Contract(config.usdc, ERC20_ABI, deployer);
  
  // Get token details
  const wethSymbol = await weth.symbol();
  const wethDecimals = await weth.decimals();
  const daiSymbol = await dai.symbol();
  const daiDecimals = await dai.decimals();
  const usdcSymbol = await usdc.symbol();
  const usdcDecimals = await usdc.decimals();
  
  log(`Token details:`);
  log(`- ${wethSymbol}: Decimals = ${wethDecimals}`);
  log(`- ${daiSymbol}: Decimals = ${daiDecimals}`);
  log(`- ${usdcSymbol}: Decimals = ${usdcDecimals}`);
  
  // Factory addresses
  const UNISWAP_V2_FACTORY = "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f";
  const SUSHISWAP_FACTORY = "0xC0AEe478e3658e2610c5F7A4A2E1777cE9e4f2Ac";
  
  // Connect to factories
  const uniswapFactory = new ethers.Contract(UNISWAP_V2_FACTORY, FACTORY_ABI, deployer);
  const sushiswapFactory = new ethers.Contract(SUSHISWAP_FACTORY, FACTORY_ABI, deployer);
  
  // Pairs to check
  const pairsToCheck = [
    { nameA: wethSymbol, tokenA: config.weth, nameB: daiSymbol, tokenB: config.dai, decimalsA: wethDecimals, decimalsB: daiDecimals },
    { nameA: wethSymbol, tokenA: config.weth, nameB: usdcSymbol, tokenB: config.usdc, decimalsA: wethDecimals, decimalsB: usdcDecimals },
    { nameA: daiSymbol, tokenA: config.dai, nameB: usdcSymbol, tokenB: config.usdc, decimalsA: daiDecimals, decimalsB: usdcDecimals }
  ];
  
  // Check each pair on both DEXes
  for (const pair of pairsToCheck) {
    log(`\nAnalyzing ${pair.nameA}/${pair.nameB} pair:`);
    
    // Check on Uniswap V2
    await checkPairLiquidity(
      "Uniswap V2",
      uniswapFactory,
      pair.tokenA,
      pair.tokenB,
      pair.nameA,
      pair.nameB,
      pair.decimalsA,
      pair.decimalsB
    );
    
    // Check on Sushiswap
    await checkPairLiquidity(
      "Sushiswap",
      sushiswapFactory,
      pair.tokenA,
      pair.tokenB,
      pair.nameA,
      pair.nameB,
      pair.decimalsA,
      pair.decimalsB
    );
  }
}

async function checkPairLiquidity(
  dexName: string,
  factory: any,
  tokenA: string,
  tokenB: string,
  nameA: string,
  nameB: string,
  decimalsA: number,
  decimalsB: number
) {
  try {
    // Get pair address
    const pairAddress = await factory.getPair(tokenA, tokenB);
    
    if (pairAddress === ethers.constants.AddressZero) {
      log(`  ${dexName}: Pair does not exist`);
      return;
    }
    
    // Connect to pair contract
    const pair = new ethers.Contract(pairAddress, UNISWAP_V2_PAIR_ABI, ethers.provider);
    
    // Get token order in the pair
    const token0 = await pair.token0();
    const token1 = await pair.token1();
    
    // Get reserves
    const [reserve0, reserve1] = await pair.getReserves();
    
    // Determine which reserve corresponds to which token
    const [reserveA, reserveB] = token0.toLowerCase() === tokenA.toLowerCase() 
      ? [reserve0, reserve1]
      : [reserve1, reserve0];
    
    // Format reserves with proper decimal places
    const formattedReserveA = ethers.utils.formatUnits(reserveA, decimalsA);
    const formattedReserveB = ethers.utils.formatUnits(reserveB, decimalsB);
    
    log(`  ${dexName}: Pair address: ${pairAddress}`);
    log(`  ${dexName}: ${nameA} reserve: ${formattedReserveA}`);
    log(`  ${dexName}: ${nameB} reserve: ${formattedReserveB}`);
    
    // Calculate price in both directions
    const priceAtoB = Number(formattedReserveB) / Number(formattedReserveA);
    const priceBtoA = Number(formattedReserveA) / Number(formattedReserveB);
    
    log(`  ${dexName}: Price ${nameA}/${nameB}: ${priceAtoB.toFixed(6)}`);
    log(`  ${dexName}: Price ${nameB}/${nameA}: ${priceBtoA.toFixed(6)}`);
    
    // Calculate raw price (considering decimals)
    const rawPriceAtoB = reserveB.mul(ethers.BigNumber.from(10).pow(decimalsA)).div(reserveA.mul(ethers.BigNumber.from(10).pow(decimalsB)));
    log(`  ${dexName}: Raw price ratio (considering decimal adjustments): ${rawPriceAtoB.toString()}`);
    
  } catch (error) {
    log(`  ${dexName}: Error checking pair: ${error}`);
  }
}

// Run the main function
main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
