import { BigNumber, providers } from 'ethers';

/**
 * Interface for gas price strategy implementations
 */
export interface GasStrategy {
  getGasPrice(provider: providers.Provider, profitAmount: BigNumber): Promise<BigNumber>;
  getMaxGasSpend(profitAmount: BigNumber): BigNumber;
}

/**
 * Dynamic gas strategy that adjusts gas prices based on expected profit
 * This helps ensure that more profitable opportunities can use higher gas
 * to increase the chance of inclusion, while less profitable ones use lower gas
 */
export class DynamicGasStrategy implements GasStrategy {
  // Maximum percentage of profit we're willing to spend on gas
  private maxGasPercentage: number;
  
  /**
   * @param maxGasPercentage Maximum percentage of profit to spend on gas (1-100)
   */
  constructor(maxGasPercentage: number = 25) {
    // Ensure the percentage is within valid range
    if (maxGasPercentage <= 0 || maxGasPercentage > 100) {
      throw new Error('maxGasPercentage must be between 1 and 100');
    }
    
    this.maxGasPercentage = maxGasPercentage;
  }
  
  /**
   * Get optimal gas price based on expected profit
   * Higher profit = willing to pay more for gas
   */
  async getGasPrice(provider: providers.Provider, profitAmount: BigNumber): Promise<BigNumber> {
    // Get current base gas price
    const baseGasPrice = await provider.getGasPrice();
    
    // Get detailed fee data for EIP-1559 transactions
    const feeData = await provider.getFeeData();
    const baseFee = feeData.maxFeePerGas || baseGasPrice;
    
    // Scale gas price based on profit amount 
    // The more profit, the more we're willing to pay for faster inclusion
    // Using fixed amounts in wei instead of parseEther to avoid dependency issues
    const smallProfit = BigNumber.from("50000000000000000"); // 0.05 ETH
    const mediumProfit = BigNumber.from("100000000000000000"); // 0.1 ETH
    const largeProfit = BigNumber.from("500000000000000000"); // 0.5 ETH
    
    if (profitAmount.lt(smallProfit)) {
      // Small profit - use slightly higher than base fee
      return baseGasPrice.mul(105).div(100); // 5% premium
    } else if (profitAmount.lt(mediumProfit)) {
      // Medium profit - use moderate premium
      return baseGasPrice.mul(115).div(100); // 15% premium
    } else if (profitAmount.lt(largeProfit)) {
      // Good profit - use higher premium
      return baseGasPrice.mul(125).div(100); // 25% premium
    } else {
      // Excellent profit - use aggressive premium to ensure inclusion
      return baseGasPrice.mul(140).div(100); // 40% premium
    }
  }
  
  /**
   * Get maximum gas we're willing to spend based on expected profit
   */
  getMaxGasSpend(profitAmount: BigNumber): BigNumber {
    // Calculate max gas we're willing to spend based on expected profit
    return profitAmount.mul(this.maxGasPercentage).div(100);
  }
  
  /**
   * Check if transaction would be profitable after gas costs
   * @param profitAmount Expected profit amount
   * @param gasPrice Gas price in wei
   * @param gasLimit Gas limit for the transaction
   * @returns Whether the transaction would still be profitable
   */
  isProfitableAfterGas(profitAmount: BigNumber, gasPrice: BigNumber, gasLimit: number): boolean {
    const gasCost = gasPrice.mul(gasLimit);
    return profitAmount.gt(gasCost);
  }
  
  /**
   * Calculate the expected profit after gas costs
   */
  getProfitAfterGas(profitAmount: BigNumber, gasPrice: BigNumber, gasLimit: number): BigNumber {
    const gasCost = gasPrice.mul(gasLimit);
    
    if (profitAmount.lte(gasCost)) {
      return BigNumber.from(0);
    }
    
    return profitAmount.sub(gasCost);
  }
}

/**
 * Conservative gas strategy that prioritizes safety over speed
 * Good for less competitive environments or when testing
 */
export class ConservativeGasStrategy implements GasStrategy {
  private maxGasPercentage: number;
  
  constructor(maxGasPercentage: number = 10) {
    this.maxGasPercentage = maxGasPercentage;
  }
  
  async getGasPrice(provider: providers.Provider, profitAmount: BigNumber): Promise<BigNumber> {
    const baseGasPrice = await provider.getGasPrice();
    
    // Use just slightly above base gas price
    return baseGasPrice.mul(102).div(100); // 2% premium
  }
  
  getMaxGasSpend(profitAmount: BigNumber): BigNumber {
    return profitAmount.mul(this.maxGasPercentage).div(100);
  }
}

/**
 * Aggressive gas strategy for highly competitive environments
 * When every millisecond counts and profit margins are good
 */
export class AggressiveGasStrategy implements GasStrategy {
  private maxGasPercentage: number;
  
  constructor(maxGasPercentage: number = 50) {
    this.maxGasPercentage = maxGasPercentage;
  }
  
  async getGasPrice(provider: providers.Provider, profitAmount: BigNumber): Promise<BigNumber> {
    const baseGasPrice = await provider.getGasPrice();
    
    // Use significantly higher gas price to outbid competitors
    return baseGasPrice.mul(150).div(100); // 50% premium
  }
  
  getMaxGasSpend(profitAmount: BigNumber): BigNumber {
    return profitAmount.mul(this.maxGasPercentage).div(100);
  }
}
