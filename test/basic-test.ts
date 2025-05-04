import { expect } from "chai";
const { ethers } = require("hardhat");

describe("Basic FlashloanArb Test", function() {
  it("Should deploy the FlashloanArb contract", async function() {
    // Mock addresses for test
    const mockLendingPool = "0x368EedF3f56ad10b9bC57eed4Dac65B26Bb667f6";
    const mockUniswapRouter = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";
    const mockSushiswapRouter = "0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506";
    const minProfitAmount = ethers.utils.parseEther("0.1");

    // Deploy the contract
    const FlashloanArb = await ethers.getContractFactory("FlashloanArb");
    const flashloanArb = await FlashloanArb.deploy(
      mockLendingPool,
      mockUniswapRouter,
      mockSushiswapRouter,
      minProfitAmount
    );
    
    await flashloanArb.deployed();
    
    // Simple assertions to check that the contract was deployed correctly
    expect(await flashloanArb.lendingPool()).to.equal(mockLendingPool);
    expect(await flashloanArb.dexARouter()).to.equal(mockUniswapRouter);
    expect(await flashloanArb.dexBRouter()).to.equal(mockSushiswapRouter);
    expect(await flashloanArb.minProfitAmount()).to.equal(minProfitAmount);
  });
});
