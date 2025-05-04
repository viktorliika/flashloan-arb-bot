import { BigNumber, providers } from 'ethers';

/**
 * Interface for common DEX functionality that all adapters must implement
 */
export interface DexAdapter {
  /**
   * Name of the DEX for identification
   */
  readonly name: string;
  
  /**
   * Find all possible pools for a given token pair
   * 
   * @param tokenA First token address
   * @param tokenB Second token address
   * @returns Array of pool information, or empty array if no pools found
   */
  findPools(tokenA: string, tokenB: string): Promise<PoolInfo[]>;
  
  /**
   * Get the expected output amount for a swap
   * 
   * @param poolInfo Pool information
   * @param tokenIn Input token address
   * @param tokenOut Output token address
   * @param amountIn Input amount
   * @returns Expected output amount
   */
  getAmountOut(
    poolInfo: PoolInfo,
    tokenIn: string,
    tokenOut: string,
    amountIn: BigNumber
  ): Promise<BigNumber>;
  
  /**
   * Find all viable arbitrage paths between DEXs
   * 
   * @param startToken The token to start with (and return to for arbitrage)
   * @param middleToken Optional intermediate token for multi-hop paths 
   * @param endToken The token to finish with (usually same as startToken for arbitrage)
   * @returns Array of possible arbitrage paths with pool information
   */
  findArbitragePaths(
    startToken: string,
    middleToken: string | null,
    endToken: string
  ): Promise<ArbitragePath[]>;
  
  /**
   * Simulate executing a swap path to determine the final output amount
   * 
   * @param path Array of token addresses in the path
   * @param pools Array of pool information for each swap
   * @param amountIn Initial input amount
   * @returns Final output amount after all swaps
   */
  simulatePathSwap(
    path: string[],
    pools: PoolInfo[],
    amountIn: BigNumber
  ): Promise<BigNumber>;
  
  /**
   * Create transaction data for executing a swap
   * 
   * @param poolInfo Pool information
   * @param tokenIn Input token address
   * @param tokenOut Output token address
   * @param amountIn Input amount
   * @param minAmountOut Minimum output amount (slippage protection)
   * @returns Transaction data for the swap
   */
  createSwapTransaction(
    poolInfo: PoolInfo,
    tokenIn: string,
    tokenOut: string,
    amountIn: BigNumber,
    minAmountOut: BigNumber
  ): Promise<{to: string, data: string}>;
}

/**
 * Information about a liquidity pool
 */
export interface PoolInfo {
  /**
   * Type of DEX (Uniswap, Sushiswap, Curve, Balancer, etc.)
   */
  dex: string;
  
  /**
   * Pool address
   */
  address: string;
  
  /**
   * Unique identifier for the pool (may be the same as address for some DEXs)
   */
  id: string;
  
  /**
   * Tokens in the pool
   */
  tokens: string[];
  
  /**
   * Optional fee data
   */
  fee?: number;
  
  /**
   * Optional protocol-specific data
   */
  metadata?: any;
}

/**
 * Represents a path for potential arbitrage
 */
export interface ArbitragePath {
  /**
   * Token addresses in order of the path
   */
  path: string[];
  
  /**
   * Pool information for each swap in the path
   */
  pools: PoolInfo[];
}
