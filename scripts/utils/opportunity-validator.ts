import { providers, BigNumber } from 'ethers';
import { GasStrategy } from './gas-strategy';

/**
 * Represents an arbitrage opportunity
 */
export interface ArbitrageOpportunity {
  tokenBorrow: string;            // Address of token to borrow
  flashLoanAmount: BigNumber;     // Amount to borrow
  expectedProfit: BigNumber;      // Expected profit in tokens
  tokenName?: string;             // Optional token name for logging
  path?: string[];                // Token path for the arbitrage
  dexes?: number[];               // DEX indices to use for each hop
  fees?: number[];                // Fee tiers for V3 swaps
  profitInUsd?: number;           // Estimated profit in USD
}

/**
 * Result of validating an opportunity
 */
export interface ValidationResult {
  valid: boolean;
  reason?: string;        // Reason for rejection
  adjustedProfit?: BigNumber; // Profit after slippage and gas adjustments
  gasCost?: BigNumber;    // Estimated gas cost
  profitability?: number; // Profit percentage
}

/**
 * Validates arbitrage opportunities to ensure they are profitable
 * after considering gas costs, slippage, and minimum profit thresholds
 */
export class OpportunityValidator {
  private gasStrategy: GasStrategy;
  private minProfitUsd: number;
  private slippageTolerance: number;
  private minProfitPercentage: number;
  
  /**
   * Create a new opportunity validator
   * 
   * @param gasStrategy Gas strategy to use for gas price calculations
   * @param minProfitUsd Minimum profit in USD to consider an opportunity valid
   * @param slippageTolerance Percentage slippage tolerance (0-100)
   * @param minProfitPercentage Minimum profit percentage after gas costs
   */
  constructor(
    gasStrategy: GasStrategy,
    minProfitUsd: number = 10,          // Min $10 profit by default
    slippageTolerance: number = 3,      // 3% slippage tolerance
    minProfitPercentage: number = 0.5   // 0.5% min profit after gas
  ) {
    this.gasStrategy = gasStrategy;
    this.minProfitUsd = minProfitUsd;
    this.slippageTolerance = slippageTolerance;
    this.minProfitPercentage = minProfitPercentage;
  }
  
  /**
   * Validate an arbitrage opportunity
   * 
   * @param opportunity The arbitrage opportunity to validate
   * @param provider The ethers provider
   * @param gasLimit Estimated gas limit for the transaction
   * @param tokenPriceUsd Price of the profit token in USD
   * @returns Validation result with reason if invalid
   */
  async validate(
    opportunity: ArbitrageOpportunity,
    provider: providers.Provider,
    gasLimit: number,
    tokenPriceUsd: number
  ): Promise<ValidationResult> {
    const tokenName = opportunity.tokenName || 'tokens';
    const usdValue = this.getUsdValue(opportunity.expectedProfit, tokenPriceUsd);
    
    // 1. Check minimum profit threshold in USD
    if (usdValue < this.minProfitUsd) {
      return {
        valid: false,
        reason: `Profit too low: $${usdValue.toFixed(2)} < $${this.minProfitUsd}`
      };
    }
    
    // 2. Apply slippage to expected profit
    const slippageMultiplier = (100 - this.slippageTolerance) / 100;
    const adjustedProfit = opportunity.expectedProfit
      .mul(Math.floor(slippageMultiplier * 1000))
      .div(1000);
    
    // 3. Calculate gas cost
    const gasPrice = await this.gasStrategy.getGasPrice(provider, opportunity.expectedProfit);
    const gasCost = gasPrice.mul(BigNumber.from(gasLimit));
    
    // 4. Check if transaction is still profitable after slippage and gas
    if (adjustedProfit.lte(gasCost)) {
      return {
        valid: false,
        reason: `Not profitable after gas costs and slippage: ` +
          `Adjusted profit ${this.formatUnits(adjustedProfit)} ${tokenName} <= ` +
          `Gas cost ${this.formatUnits(gasCost)} ${tokenName}`,
        adjustedProfit,
        gasCost
      };
    }
    
    // 5. Calculate profit percentage
    const profitPercentage = this.calculateProfitPercentage(
      adjustedProfit.sub(gasCost),
      opportunity.flashLoanAmount
    );
    
    // 6. Check if profit percentage meets minimum threshold
    if (profitPercentage < this.minProfitPercentage) {
      return {
        valid: false,
        reason: `Profit percentage too low: ${profitPercentage.toFixed(4)}% < ${this.minProfitPercentage}%`,
        adjustedProfit,
        gasCost,
        profitability: profitPercentage
      };
    }
    
    // All checks passed, opportunity is valid
    return {
      valid: true,
      adjustedProfit,
      gasCost,
      profitability: profitPercentage
    };
  }
  
  /**
   * Calculate USD value from token amount and price
   */
  private getUsdValue(amount: BigNumber, tokenPriceUsd: number): number {
    // This is a simplification - in production you'd need to handle decimals properly
    const amountStr = amount.toString();
    const amountFloat = parseFloat(amountStr) / 1e18; // Assuming 18 decimals
    return amountFloat * tokenPriceUsd;
  }
  
  /**
   * Format BigNumber to human-readable string
   * Simple implementation - in production, handle decimals properly
   */
  private formatUnits(amount: BigNumber): string {
    // Simple implementation assuming 18 decimals
    const amountStr = amount.toString();
    if (amountStr.length <= 18) {
      return '0.' + '0'.repeat(18 - amountStr.length) + amountStr;
    } else {
      const decimalIndex = amountStr.length - 18;
      return amountStr.slice(0, decimalIndex) + '.' + amountStr.slice(decimalIndex);
    }
  }
  
  /**
   * Calculate profit percentage
   */
  private calculateProfitPercentage(profit: BigNumber, principal: BigNumber): number {
    if (principal.isZero()) {
      return 0;
    }
    
    // Calculate profit percentage with precision to avoid integer division issues
    const profitBps = profit.mul(10000).div(principal);
    return profitBps.toNumber() / 100; // Convert basis points to percentage
  }
  
  /**
   * Update the minimum profit threshold
   */
  setMinProfitUsd(minProfitUsd: number): void {
    this.minProfitUsd = minProfitUsd;
  }
  
  /**
   * Update the slippage tolerance
   */
  setSlippageTolerance(slippageTolerance: number): void {
    if (slippageTolerance < 0 || slippageTolerance > 100) {
      throw new Error('Slippage tolerance must be between 0 and 100');
    }
    this.slippageTolerance = slippageTolerance;
  }
  
  /**
   * Update the minimum profit percentage
   */
  setMinProfitPercentage(minProfitPercentage: number): void {
    this.minProfitPercentage = minProfitPercentage;
  }
}
