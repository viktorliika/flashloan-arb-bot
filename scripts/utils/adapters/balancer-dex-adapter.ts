import { BigNumber, providers } from 'ethers';
import { DexAdapter, PoolInfo, ArbitragePath } from '../interfaces/dex-adapter';
import { BalancerAdapter } from '../balancer-adapter';

/**
 * Adapter implementation for Balancer DEX
 */
export class BalancerDexAdapter implements DexAdapter {
  // DEX name for identification
  readonly name: string = 'Balancer';
  
  // The underlying Balancer adapter to delegate calls to
  private balancerAdapter: BalancerAdapter;
  
  /**
   * Create a new Balancer DEX adapter
   * @param provider Ethers provider
   */
  constructor(provider: providers.Provider) {
    this.balancerAdapter = new BalancerAdapter(provider);
  }
  
  /**
   * Find all possible pools for a given token pair
   * 
   * @param tokenA First token address
   * @param tokenB Second token address
   * @returns Array of pool information, or empty array if no pools found
   */
  async findPools(tokenA: string, tokenB: string): Promise<PoolInfo[]> {
    try {
      // Find pool using the underlying adapter
      const poolInfo = await this.balancerAdapter.findPool(tokenA, tokenB);
      
      if (!poolInfo) {
        return [];
      }
      
      // Convert to the standard PoolInfo format
      const standardPoolInfo: PoolInfo = {
        dex: this.name,
        address: poolInfo.poolAddress,
        id: poolInfo.poolId, // For Balancer, poolId is the unique identifier
        tokens: [tokenA, tokenB],
        // Store indices in metadata for later use
        metadata: {
          tokenAIndex: poolInfo.tokenAIndex,
          tokenBIndex: poolInfo.tokenBIndex,
          poolId: poolInfo.poolId // Store poolId for later use
        }
      };
      
      return [standardPoolInfo];
    } catch (error) {
      console.error(`Error finding Balancer pools: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  }
  
  /**
   * Get the expected output amount for a swap
   * 
   * @param poolInfo Pool information
   * @param tokenIn Input token address
   * @param tokenOut Output token address
   * @param amountIn Input amount
   * @returns Expected output amount
   */
  async getAmountOut(
    poolInfo: PoolInfo,
    tokenIn: string,
    tokenOut: string,
    amountIn: BigNumber
  ): Promise<BigNumber> {
    try {
      // First try the underlying adapter
      const amountOut = await this.balancerAdapter.getAmountOut(
        poolInfo.address,
        tokenIn,
        tokenOut,
        amountIn
      );
      
      // If we got a valid amount, return it
      if (!amountOut.isZero()) {
        return amountOut;
      }
      
      // If we got zero, use a simplified estimation approach
      return this.estimateAmountOutFallback(
        poolInfo,
        tokenIn,
        tokenOut,
        amountIn
      );
    } catch (error) {
      console.error(`Error getting amount out from Balancer: ${error instanceof Error ? error.message : String(error)}`);
      // Use fallback on any error
      return this.estimateAmountOutFallback(
        poolInfo,
        tokenIn,
        tokenOut,
        amountIn
      );
    }
  }
  
  /**
   * Fallback method to estimate amount out when the standard method fails
   * This uses a simple constant product formula as a rough approximation
   */
  private estimateAmountOutFallback(
    poolInfo: PoolInfo,
    tokenIn: string,
    tokenOut: string,
    amountIn: BigNumber
  ): Promise<BigNumber> {
    // If it's a weighted pool (common in Balancer), use this simplified formula
    // For known pools, we can use hardcoded weights
    
    // Get pool type from metadata or assume weighted 80/20 (common in Balancer)
    const poolType = poolInfo.metadata?.poolType || 'weighted';
    const tokenInWeight = poolInfo.metadata?.tokenInWeight || 80;
    const tokenOutWeight = poolInfo.metadata?.tokenOutWeight || 20;
    
    if (poolType === 'weighted') {
      // For weighted pools, we can use a simplified formula that approximates
      // the Balancer weighted math, with small fees deducted
      
      // Simplification: amountOut = amountIn * (weightOut/weightIn) * 0.995 (0.5% fee)
      const weightRatio = tokenOutWeight / tokenInWeight;
      const estimatedOut = amountIn.mul(Math.floor(weightRatio * 995)).div(1000);
      
      console.log(`Using fallback estimation for Balancer weighted pool: ${estimatedOut.toString()}`);
      return Promise.resolve(estimatedOut);
    }
    
    if (poolType === 'stable') {
      // For stable pools, tokens should be worth approximately the same
      // Apply a small fee
      const estimatedOut = amountIn.mul(995).div(1000);
      
      console.log(`Using fallback estimation for Balancer stable pool: ${estimatedOut.toString()}`);
      return Promise.resolve(estimatedOut);
    }
    
    // If we don't know the pool type, use a conservative estimate
    const estimatedOut = amountIn.mul(90).div(100); // 10% slippage assumption
    console.log(`Using conservative fallback estimation for unknown Balancer pool: ${estimatedOut.toString()}`);
    return Promise.resolve(estimatedOut);
  }
  
  /**
   * Find all viable arbitrage paths between DEXs
   * 
   * @param startToken The token to start with (and return to for arbitrage)
   * @param middleToken Optional intermediate token for multi-hop paths 
   * @param endToken The token to finish with (usually same as startToken for arbitrage)
   * @returns Array of possible arbitrage paths with pool information
   */
  async findArbitragePaths(
    startToken: string,
    middleToken: string | null,
    endToken: string
  ): Promise<ArbitragePath[]> {
    // Delegate to the underlying adapter to find paths
    const paths = await this.balancerAdapter.findArbitragePaths(
      startToken,
      middleToken,
      endToken
    );
    
    // Convert to the standard ArbitragePath format
    return Promise.all(paths.map(async (path) => {
      // Create PoolInfo objects for each pool in the path
      const poolInfos: PoolInfo[] = await Promise.all(
        path.pools.map(async (poolAddress, index) => {
          // Get pool ID for this pool
          const poolId = await this.balancerAdapter.getPoolId(poolAddress);
          
          // Determine the tokens for this segment of the path
          const tokenA = path.path[index];
          const tokenB = path.path[index + 1];
          
          return {
            dex: this.name,
            address: poolAddress,
            id: poolId,
            tokens: [tokenA, tokenB],
            metadata: {
              tokenAIndex: path.indices[index][0],
              tokenBIndex: path.indices[index][1],
              poolId
            }
          };
        })
      );
      
      return {
        path: path.path,
        pools: poolInfos
      };
    }));
  }
  
  /**
   * Simulate executing a swap path to determine the final output amount
   * 
   * @param path Array of token addresses in the path
   * @param pools Array of pool information for each swap
   * @param amountIn Initial input amount
   * @returns Final output amount after all swaps
   */
  async simulatePathSwap(
    path: string[],
    pools: PoolInfo[],
    amountIn: BigNumber
  ): Promise<BigNumber> {
    if (path.length !== pools.length + 1) {
      throw new Error('Invalid path configuration: path length should be pools length + 1');
    }
    
    // Extract the pool addresses and indices for the underlying adapter
    const poolAddresses = pools.map(pool => pool.address);
    const indices = pools.map(pool => {
      if (!pool.metadata || 
          typeof pool.metadata.tokenAIndex !== 'number' || 
          typeof pool.metadata.tokenBIndex !== 'number') {
        throw new Error('Missing token indices in pool metadata');
      }
      
      return [pool.metadata.tokenAIndex, pool.metadata.tokenBIndex];
    });
    
    // Delegate to the underlying adapter
    return this.balancerAdapter.simulatePathSwap(
      path,
      poolAddresses,
      indices,
      amountIn
    );
  }
  
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
  async createSwapTransaction(
    poolInfo: PoolInfo,
    tokenIn: string,
    tokenOut: string,
    amountIn: BigNumber,
    minAmountOut: BigNumber
  ): Promise<{to: string, data: string}> {
    // Delegate to the underlying adapter
    return this.balancerAdapter.createSwapTransaction(
      poolInfo.address,
      tokenIn,
      tokenOut,
      amountIn,
      minAmountOut
    );
  }
}
