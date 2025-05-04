// Use Node's built-in assert instead of chai to avoid ESM issues
const assert = require("assert");
const fs = require("fs");
const path = require("path");

// Import hardhat runtime
const hre = require("hardhat");
const ethers = hre.ethers;

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

describe("FlashloanArb on Forked Mainnet", function() {
  // This test needs to run on a forked mainnet
  let flashloanArb: any;
  let weth: any;
  let dai: any;
  let usdc: any;
  let uniswapV2Router: any;
  let sushiswapRouter: any;
  let aaveLendingPool: any;
  let deployer: any;
  let config: any;

  before(async function() {
    try {
      // Load config
      config = loadForkConfig();
      console.log(`Loaded fork config with FlashloanArb at: ${config.flashloanArb}`);
      
      // Get signer
      [deployer] = await ethers.getSigners();
      console.log(`Using deployer: ${deployer.address}`);
      
      // ABIs for interacting with mainnet contracts
      const ERC20_ABI = [
        "function balanceOf(address owner) view returns (uint256)",
        "function decimals() view returns (uint8)",
        "function symbol() view returns (string)",
        "function name() view returns (string)",
        "function approve(address spender, uint256 amount) returns (bool)",
      ];
      
      const ROUTER_ABI = [
        "function getAmountsOut(uint amountIn, address[] memory path) public view returns (uint[] memory amounts)",
      ];
      
      const LENDING_POOL_ABI = [
        "function FLASHLOAN_PREMIUM_TOTAL() view returns (uint128)",
        "function getReserveData(address asset) view returns (tuple(tuple(uint256 data) configuration, uint128 liquidityIndex, uint128 variableBorrowIndex, uint128 currentLiquidityRate, uint128 currentVariableBorrowRate, uint128 currentStableBorrowRate, uint40 lastUpdateTimestamp, address aTokenAddress, address stableDebtTokenAddress, address variableDebtTokenAddress, address interestRateStrategyAddress, uint8 id))",
      ];
      
      // Connect to deployed FlashloanArb contract - use fully qualified path to avoid ambiguity
      const FlashloanArbArtifact = require("../artifacts/contracts/FlashloanArb.sol/FlashloanArb.json");
      flashloanArb = new ethers.Contract(
        config.flashloanArb,
        FlashloanArbArtifact.abi,
        deployer
      );
      
      // Connect to mainnet tokens
      weth = new ethers.Contract(config.weth, ERC20_ABI, deployer);
      dai = new ethers.Contract(config.dai, ERC20_ABI, deployer);
      usdc = new ethers.Contract(config.usdc, ERC20_ABI, deployer);
      
      // Connect to mainnet DEX routers
      uniswapV2Router = new ethers.Contract(config.uniswapV2Router, ROUTER_ABI, deployer);
      sushiswapRouter = new ethers.Contract(config.sushiswapRouter, ROUTER_ABI, deployer);
      
      // Connect to Aave lending pool
      aaveLendingPool = new ethers.Contract(config.aaveLendingPool, LENDING_POOL_ABI, deployer);
      
    } catch (error) {
      console.error("Setup error:", error);
      throw error;
    }
  });

  it("Should correctly connect to the deployed FlashloanArb contract", async function() {
    const lendingPoolAddress = await flashloanArb.lendingPool();
    const dexARouter = await flashloanArb.dexARouter();
    const dexBRouter = await flashloanArb.dexBRouter();
    
    assert.strictEqual(lendingPoolAddress, config.aaveLendingPool);
    assert.strictEqual(dexARouter, config.uniswapV2Router);
    assert.strictEqual(dexBRouter, config.sushiswapRouter);
  });

  it("Should connect to real tokens on mainnet", async function() {
    // Get token details
    const wethSymbol = await weth.symbol();
    const daiSymbol = await dai.symbol();
    const usdcSymbol = await usdc.symbol();
    
    assert.strictEqual(wethSymbol, "WETH");
    assert.strictEqual(daiSymbol, "DAI");
    assert.strictEqual(usdcSymbol, "USDC");
    
    console.log(`Connected to tokens: ${wethSymbol}, ${daiSymbol}, ${usdcSymbol}`);
  });

  it("Should be able to check prices on Uniswap and Sushiswap", async function() {
    const amountIn = ethers.utils.parseEther("1"); // 1 WETH
    const path = [config.weth, config.dai];
    
    // Get quotes from both DEXes
    const uniswapAmounts = await uniswapV2Router.getAmountsOut(amountIn, path);
    const sushiswapAmounts = await sushiswapRouter.getAmountsOut(amountIn, path);
    
    const uniswapPrice = ethers.utils.formatEther(uniswapAmounts[1]);
    const sushiswapPrice = ethers.utils.formatEther(sushiswapAmounts[1]);
    
    console.log(`Uniswap price: 1 WETH = ${uniswapPrice} DAI`);
    console.log(`Sushiswap price: 1 WETH = ${sushiswapPrice} DAI`);
    
    // Both should return a reasonable amount (greater than 0)
    assert.ok(parseFloat(uniswapPrice) > 0, "Uniswap price should be greater than 0");
    assert.ok(parseFloat(sushiswapPrice) > 0, "Sushiswap price should be greater than 0");
  });

  it("Should verify Aave flash loan fee", async function() {
    // Get the flash loan premium from Aave
    const premium = await aaveLendingPool.FLASHLOAN_PREMIUM_TOTAL();
    
    console.log(`Aave flash loan premium: ${premium.toString()} basis points`);
    
    // Premium should be a reasonable value (e.g., 9 for 0.09%)
    assert.ok(premium.toNumber() > 0, "Flash loan premium should be greater than 0");
    assert.ok(premium.toNumber() < 1000, "Flash loan premium should be less than 1000 basis points (10%)");
  });
});
