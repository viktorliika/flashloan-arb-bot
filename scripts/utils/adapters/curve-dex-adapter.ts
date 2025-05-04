import { BigNumber, Contract, providers } from 'ethers';
import { DexAdapter, PoolInfo, ArbitragePath } from '../interfaces/dex-adapter';
import { CurveAdapter } from '../curve-adapter';

/**
 * Adapter implementation for Curve DEX
 */
export class CurveDexAdapter implements DexAdapter {
  // DEX name for identification
  readonly name: string = 'Curve';
  
  // The underlying Curve adapter to delegate calls to
  private curveAdapter: CurveAdapter;
  
  /**
   * Create a new Curve DEX adapter
   * @param provider Ethers provider
   */
  constructor(provider: providers.Provider) {
    this.curveAdapter = new CurveAdapter(provider);
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
      // First try to find hardcoded pools
      // We prioritize hardcoded pools for stability in forked environments
      const tokenASymbol = this.getTokenSymbol(tokenA);
      const tokenBSymbol = this.getTokenSymbol(tokenB);
      
      const poolInfos: PoolInfo[] = [];
      
      // Check for hardcoded stable pairs (USDC-USDT-DAI)
      if (this.isStablePair(tokenA, tokenB)) {
        // 3pool is the most liquid stable pool
        const threePoolAddress = '0xbEbc44782C7dB0a1A60Cb6fe97d0b483032FF1C7';
        
        // Get indices based on token addresses
        const tokenAIndex = this.getStablePoolIndex(tokenA);
        const tokenBIndex = this.getStablePoolIndex(tokenB);
        
        if (tokenAIndex !== -1 && tokenBIndex !== -1) {
          const poolInfo: PoolInfo = {
            dex: this.name,
            address: threePoolAddress,
            id: threePoolAddress,
            tokens: [tokenA, tokenB],
            metadata: {
              tokenAIndex: tokenAIndex,
              tokenBIndex: tokenBIndex
            }
          };
          
          poolInfos.push(poolInfo);
          console.log(`Using hardcoded 3pool for ${tokenASymbol}/${tokenBSymbol}`);
        }
      }
      
      // Try to find ETH pools
      if (this.isETHPair(tokenA, tokenB)) {
        const ethPool = this.getETHStablePool(tokenA, tokenB);
        if (ethPool) {
          poolInfos.push(ethPool);
        }
      }
      
      // If we found hardcoded pools, return them
      if (poolInfos.length > 0) {
        return poolInfos;
      }
      
      // Otherwise, try to use the adapter to find pools
      const bestPool = await this.curveAdapter.findBestPool(tokenA, tokenB);
      
      if (bestPool) {
        // Convert to the standard PoolInfo format
        const poolInfo: PoolInfo = {
          dex: this.name,
          address: bestPool.poolAddress,
          id: bestPool.poolAddress, // For Curve, address is a unique identifier
          tokens: [tokenA, tokenB],
          // Store indices in metadata for later use
          metadata: {
            tokenAIndex: bestPool.tokenAIndex,
            tokenBIndex: bestPool.tokenBIndex
          }
        };
        
        return [poolInfo];
      }
      
      return [];
    } catch (error) {
      console.error(`Error finding Curve pools: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  }
  
  /**
   * Check if a pair of tokens is a stable pair (DAI, USDC, USDT)
   */
  private isStablePair(tokenA: string, tokenB: string): boolean {
    const stableTokens = [
      '0x6B175474E89094C44Da98b954EedeAC495271d0F', // DAI
      '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
      '0xdAC17F958D2ee523a2206206994597C13D831ec7'  // USDT
    ].map(addr => addr.toLowerCase());
    
    return stableTokens.includes(tokenA.toLowerCase()) && 
           stableTokens.includes(tokenB.toLowerCase());
  }
  
  /**
   * Get index for a token in the 3pool (DAI=0, USDC=1, USDT=2)
   */
  private getStablePoolIndex(token: string): number {
    const tokenLower = token.toLowerCase();
    
    if (tokenLower === '0x6b175474e89094c44da98b954eedeac495271d0f') {
      return 0; // DAI
    } else if (tokenLower === '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48') {
      return 1; // USDC
    } else if (tokenLower === '0xdac17f958d2ee523a2206206994597c13d831ec7') {
      return 2; // USDT
    }
    
    return -1;
  }
  
  /**
   * Check if one of the tokens is WETH/ETH
   */
  private isETHPair(tokenA: string, tokenB: string): boolean {
    const ethAddresses = [
      '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
      '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'  // ETH
    ].map(addr => addr.toLowerCase());
    
    return ethAddresses.includes(tokenA.toLowerCase()) || 
           ethAddresses.includes(tokenB.toLowerCase());
  }
  
  /**
   * Get an ETH-stable pool if available
   */
  private getETHStablePool(tokenA: string, tokenB: string): PoolInfo | null {
    const ethPool = '0xDC24316b9AE028F1497c275EB9192a3Ea0f67022'; // ETH-stETH pool
    const tokenALower = tokenA.toLowerCase();
    const tokenBLower = tokenB.toLowerCase();
    
    // ETH-stETH pool
    const wethAddress = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'.toLowerCase();
    const stethAddress = '0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84'.toLowerCase();
    
    if ((tokenALower === wethAddress && tokenBLower === stethAddress) ||
        (tokenALower === stethAddress && tokenBLower === wethAddress)) {
      return {
        dex: this.name,
        address: ethPool,
        id: ethPool,
        tokens: [tokenA, tokenB],
        metadata: {
          tokenAIndex: tokenALower === wethAddress ? 0 : 1,
          tokenBIndex: tokenBLower === stethAddress ? 1 : 0
        }
      };
    }
    
    return null;
  }
  
  /**
   * Get token symbol from address
   */
  private getTokenSymbol(address: string): string {
    const symbols: Record<string, string> = {
      '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2': 'WETH',
      '0x6B175474E89094C44Da98b954EedeAC495271d0F': 'DAI',
      '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48': 'USDC',
      '0xdAC17F958D2ee523a2206206994597C13D831ec7': 'USDT',
      '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599': 'WBTC',
      '0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84': 'stETH'
    };
    
    return symbols[address] || address.substring(0, 6);
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
    if (!poolInfo.metadata || 
        typeof poolInfo.metadata.tokenAIndex !== 'number' || 
        typeof poolInfo.metadata.tokenBIndex !== 'number') {
      console.error('Missing token indices in pool metadata');
      return BigNumber.from(0);
    }
    
    // Determine which index is for tokenIn and which is for tokenOut
    const indices = this.determineTokenIndices(
      poolInfo, 
      tokenIn, 
      tokenOut
    );
    
    if (!indices) {
      console.error('Could not determine token indices for Curve swap');
      return BigNumber.from(0);
    }
    
    // Delegate to the underlying adapter
    return this.curveAdapter.getAmountOut(
      poolInfo.address,
      indices.tokenInIndex,
      indices.tokenOutIndex,
      amountIn
    );
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
    const paths = await this.curveAdapter.findArbitragePaths(
      startToken,
      middleToken,
      endToken
    );
    
    // Convert to the standard ArbitragePath format
    return Promise.all(paths.map(async (path) => {
      // Create PoolInfo objects for each pool in the path
      const poolInfos: PoolInfo[] = await Promise.all(
        path.pools.map(async (poolAddress, index) => {
          // Determine the tokens for this segment of the path
          const tokenA = path.path[index];
          const tokenB = path.path[index + 1];
          
          return {
            dex: this.name,
            address: poolAddress,
            id: poolAddress,
            tokens: [tokenA, tokenB],
            metadata: {
              tokenAIndex: path.indices[index][0],
              tokenBIndex: path.indices[index][1]
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
    return this.curveAdapter.simulatePathSwap(
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
    if (!poolInfo.metadata || 
        typeof poolInfo.metadata.tokenAIndex !== 'number' || 
        typeof poolInfo.metadata.tokenBIndex !== 'number') {
      throw new Error('Missing token indices in pool metadata');
    }
    
    // Determine which index is for tokenIn and which is for tokenOut
    const indices = this.determineTokenIndices(
      poolInfo, 
      tokenIn, 
      tokenOut
    );
    
    if (!indices) {
      throw new Error('Could not determine token indices for Curve swap');
    }
    
    // Delegate to the underlying adapter
    return this.curveAdapter.createSwapTransaction(
      poolInfo.address,
      indices.tokenInIndex,
      indices.tokenOutIndex,
      amountIn,
      minAmountOut
    );
  }
  
  /**
   * Helper method to determine the correct token indices for a swap
   * 
   * @param poolInfo Pool information
   * @param tokenIn Input token address
   * @param tokenOut Output token address
   * @returns Object with tokenInIndex and tokenOutIndex, or null if not found
   */
  private determineTokenIndices(
    poolInfo: PoolInfo,
    tokenIn: string,
    tokenOut: string
  ): { tokenInIndex: number, tokenOutIndex: number } | null {
    if (!poolInfo.metadata) {
      return null;
    }
    
    const { tokenAIndex, tokenBIndex } = poolInfo.metadata;
    
    // Normalize addresses for comparison
    const normalizedTokenIn = tokenIn.toLowerCase();
    const normalizedTokenOut = tokenOut.toLowerCase();
    const normalizedTokenA = poolInfo.tokens[0].toLowerCase();
    const normalizedTokenB = poolInfo.tokens[1].toLowerCase();
    
    // Check which direction we're swapping
    if (normalizedTokenIn === normalizedTokenA && normalizedTokenOut === normalizedTokenB) {
      // A to B
      return {
        tokenInIndex: tokenAIndex as number,
        tokenOutIndex: tokenBIndex as number
      };
    } else if (normalizedTokenIn === normalizedTokenB && normalizedTokenOut === normalizedTokenA) {
      // B to A
      return {
        tokenInIndex: tokenBIndex as number,
        tokenOutIndex: tokenAIndex as number
      };
    }
    
    // Unknown direction
    return null;
  }
}
