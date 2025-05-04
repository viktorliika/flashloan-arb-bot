// Use dynamic import for chai
import chai from 'chai';
const { expect } = chai;
import { ethers } from "hardhat";
import { Contract, BigNumber } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

// Mock interfaces
interface IUniswapV2Factory {
  createPair: (tokenA: string, tokenB: string) => Promise<string>;
}

interface IUniswapV2Router {
  factory: () => Promise<string>;
  WETH: () => Promise<string>;
  addLiquidity: (
    tokenA: string,
    tokenB: string,
    amountADesired: BigNumber,
    amountBDesired: BigNumber,
    amountAMin: BigNumber,
    amountBMin: BigNumber,
    to: string,
    deadline: BigNumber
  ) => Promise<any>;
}

describe("FlashloanArb", function() {
  // Increase timeout for testing complex interactions
  this.timeout(60000);

  let flashloanArb: Contract;
  let mockLendingPool: Contract;
  let mockUniswapRouter: Contract;
  let mockSushiswapRouter: Contract;
  let tokenA: Contract;
  let tokenB: Contract;
  let owner: SignerWithAddress;
  let user: SignerWithAddress;
  let feeCollector: SignerWithAddress;

  // Mock flash loan fee (0.09%)
  const FLASH_LOAN_FEE = 9; // 9 basis points, or 0.09%
  
  // Test parameters
  const INITIAL_SUPPLY = ethers.utils.parseUnits("1000000", 18);
  const LIQUIDITY_AMOUNT = ethers.utils.parseUnits("100000", 18);
  const FLASH_LOAN_AMOUNT = ethers.utils.parseUnits("10000", 18);
  const MIN_PROFIT_AMOUNT = ethers.utils.parseUnits("1", 18);

  beforeEach(async function() {
    // Get signers
    [owner, user, feeCollector] = await ethers.getSigners();

    // Deploy mock ERC20 tokens
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    tokenA = await MockERC20.deploy("Token A", "TKNA", INITIAL_SUPPLY);
    tokenB = await MockERC20.deploy("Token B", "TKNB", INITIAL_SUPPLY);
    await tokenA.deployed();
    await tokenB.deployed();

    // Deploy mock lending pool
    const MockLendingPool = await ethers.getContractFactory("MockLendingPool");
    mockLendingPool = await MockLendingPool.deploy(FLASH_LOAN_FEE);
    await mockLendingPool.deployed();

    // Deploy mock Uniswap and Sushiswap routers
    const MockRouter = await ethers.getContractFactory("MockRouter");
    mockUniswapRouter = await MockRouter.deploy("Uniswap");
    mockSushiswapRouter = await MockRouter.deploy("Sushiswap");
    await mockUniswapRouter.deployed();
    await mockSushiswapRouter.deployed();

    // Deploy FlashloanArb contract
    const FlashloanArb = await ethers.getContractFactory("FlashloanArb");
    flashloanArb = await FlashloanArb.deploy(
      mockLendingPool.address,
      mockUniswapRouter.address,
      mockSushiswapRouter.address,
      MIN_PROFIT_AMOUNT
    );
    await flashloanArb.deployed();

    // Set up price difference between DEXes
    // Uniswap: 1 TokenA = 1 TokenB
    // Sushiswap: 1 TokenA = 1.02 TokenB (2% higher)
    await mockUniswapRouter.setExchangeRate(
      tokenA.address, 
      tokenB.address, 
      ethers.utils.parseUnits("1", 18)  // 1:1 ratio
    );
    
    await mockSushiswapRouter.setExchangeRate(
      tokenA.address, 
      tokenB.address, 
      ethers.utils.parseUnits("1.02", 18)  // 1:1.02 ratio
    );
    
    // Mint tokens to the contract for testing
    await tokenA.mint(flashloanArb.address, LIQUIDITY_AMOUNT);
    await tokenB.mint(flashloanArb.address, LIQUIDITY_AMOUNT);
  });

  describe("Deployment", function() {
    it("Should set the right owner", async function() {
      expect(await flashloanArb.owner()).to.equal(owner.address);
    });

    it("Should set the correct contract addresses", async function() {
      expect(await flashloanArb.lendingPool()).to.equal(mockLendingPool.address);
      expect(await flashloanArb.dexARouter()).to.equal(mockUniswapRouter.address);
      expect(await flashloanArb.dexBRouter()).to.equal(mockSushiswapRouter.address);
    });

    it("Should set the minimum profit amount", async function() {
      expect(await flashloanArb.minProfitAmount()).to.equal(MIN_PROFIT_AMOUNT);
    });
  });

  describe("Arbitrage", function() {
    it("Should execute arbitrage with profit", async function() {
      // Implement a mock executeOperation to simulate flash loan callback
      await mockLendingPool.setFlashloanReceiver(flashloanArb.address);
      
      // Setup arbitrage parameters
      const loanAsset = tokenA.address;
      const pairs: [string, string][] = [
        [tokenA.address, tokenB.address],
        [tokenB.address, tokenA.address]
      ];
      
      // 0 = Uniswap, 1 = Sushiswap
      const dexForTrade = [0, 1]; // Buy on Uniswap, sell on Sushiswap
      
      // Execute arbitrage
      const initialBalance = await tokenA.balanceOf(flashloanArb.address);
      
      // Calculate expected profit
      // Buy tokenB on Uniswap with FLASH_LOAN_AMOUNT of tokenA
      const uniswapRate = await mockUniswapRouter.getExchangeRate(tokenA.address, tokenB.address);
      const tokenBReceived = FLASH_LOAN_AMOUNT.mul(uniswapRate).div(ethers.utils.parseUnits("1", 18));
      
      // Sell tokenB on Sushiswap for tokenA
      const sushiswapRate = await mockSushiswapRouter.getExchangeRate(tokenB.address, tokenA.address);
      const tokenAReceived = tokenBReceived.mul(sushiswapRate).div(ethers.utils.parseUnits("1", 18));
      
      // Flash loan fee
      const flashLoanFee = FLASH_LOAN_AMOUNT.mul(FLASH_LOAN_FEE).div(10000);
      const expectedProfit = tokenAReceived.sub(FLASH_LOAN_AMOUNT).sub(flashLoanFee);
      
      // Verify profit is above minimum
      expect(expectedProfit).to.be.gt(MIN_PROFIT_AMOUNT);
      
      // Execute the arbitrage
      await expect(
        flashloanArb.executeArbitrage(loanAsset, FLASH_LOAN_AMOUNT, pairs, dexForTrade)
      ).to.emit(flashloanArb, "ArbitrageExecuted");
      
      // Verify the profit was made
      const finalBalance = await tokenA.balanceOf(flashloanArb.address);
      expect(finalBalance).to.be.gt(initialBalance);
      expect(finalBalance.sub(initialBalance)).to.be.gte(expectedProfit);
    });

    it("Should fail if profit is below minimum", async function() {
      // Set prices to be equal, so no profit opportunity
      await mockUniswapRouter.setExchangeRate(
        tokenA.address, 
        tokenB.address, 
        ethers.utils.parseUnits("1", 18)
      );
      
      await mockSushiswapRouter.setExchangeRate(
        tokenA.address, 
        tokenB.address, 
        ethers.utils.parseUnits("1", 18)
      );
      
      // Setup arbitrage parameters
      const loanAsset = tokenA.address;
      const pairs: [string, string][] = [
        [tokenA.address, tokenB.address],
        [tokenB.address, tokenA.address]
      ];
      
      // 0 = Uniswap, 1 = Sushiswap
      const dexForTrade = [0, 1];
      
      // Mock setup for flash loan
      await mockLendingPool.setFlashloanReceiver(flashloanArb.address);
      
      // Execute arbitrage - should fail with "Insufficient profit"
      await expect(
        flashloanArb.executeArbitrage(loanAsset, FLASH_LOAN_AMOUNT, pairs, dexForTrade)
      ).to.be.revertedWith("Insufficient profit");
    });
  });

  describe("Admin functions", function() {
    it("Should allow owner to withdraw tokens", async function() {
      const withdrawAmount = ethers.utils.parseUnits("1000", 18);
      
      // Check initial balances
      const initialContractBalance = await tokenA.balanceOf(flashloanArb.address);
      const initialOwnerBalance = await tokenA.balanceOf(owner.address);
      
      // Withdraw tokens
      await flashloanArb.withdrawTokens(
        tokenA.address,
        owner.address,
        withdrawAmount
      );
      
      // Check final balances
      const finalContractBalance = await tokenA.balanceOf(flashloanArb.address);
      const finalOwnerBalance = await tokenA.balanceOf(owner.address);
      
      expect(finalContractBalance).to.equal(initialContractBalance.sub(withdrawAmount));
      expect(finalOwnerBalance).to.equal(initialOwnerBalance.add(withdrawAmount));
    });

    it("Should allow owner to update minimum profit amount", async function() {
      const newMinProfit = ethers.utils.parseUnits("5", 18);
      
      await flashloanArb.setMinProfitAmount(newMinProfit);
      
      expect(await flashloanArb.minProfitAmount()).to.equal(newMinProfit);
    });

    it("Should allow owner to update DEX router addresses", async function() {
      const newRouter = "0x1234567890123456789012345678901234567890";
      
      await flashloanArb.setDexRouter("A", newRouter);
      
      expect(await flashloanArb.dexARouter()).to.equal(newRouter);
    });

    it("Should prevent non-owners from calling admin functions", async function() {
      await expect(
        flashloanArb.connect(user).withdrawTokens(
          tokenA.address,
          user.address,
          ethers.utils.parseUnits("1000", 18)
        )
      ).to.be.revertedWith("Ownable: caller is not the owner");
      
      await expect(
        flashloanArb.connect(user).setMinProfitAmount(ethers.utils.parseUnits("5", 18))
      ).to.be.revertedWith("Ownable: caller is not the owner");
      
      await expect(
        flashloanArb.connect(user).setDexRouter("A", user.address)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });
  });
});
