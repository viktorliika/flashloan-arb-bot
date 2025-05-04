import { BigNumber, Contract, providers } from 'ethers';

// Curve Registry address on Ethereum mainnet
const CURVE_REGISTRY_ADDRESS = '0x90E00ACe148ca3b23Ac1bC8C240C2a7Dd9c2d7f5';

// Type definition for pool info
interface PoolInfo {
  poolAddress: string;
  tokenAIndex: number;
  tokenBIndex: number;
}

// Hardcoded pool addresses for common pairs (fallback if registry fails)
const HARDCODED_POOLS: Record<string, PoolInfo> = {
  // Format: 'tokenA-tokenB': { poolAddress, tokenAIndex, tokenBIndex }
  // 3pool (DAI-USDC-USDT)
  'DAI-USDC': { 
    poolAddress: '0xbEbc44782C7dB0a1A60Cb6fe97d0b483032FF1C7', 
    tokenAIndex: 0, 
    tokenBIndex: 1 
  },
  'DAI-USDT': { 
    poolAddress: '0xbEbc44782C7dB0a1A60Cb6fe97d0b483032FF1C7', 
    tokenAIndex: 0, 
    tokenBIndex: 2 
  },
  'USDC-USDT': { 
    poolAddress: '0xbEbc44782C7dB0a1A60Cb6fe97d0b483032FF1C7', 
    tokenAIndex: 1, 
    tokenBIndex: 2 
  },
  // WETH-stETH
  'WETH-STETH': { 
    poolAddress: '0xDC24316b9AE028F1497c275EB9192a3Ea0f67022', 
    tokenAIndex: 0, 
    tokenBIndex: 1 
  }
};

// Token address mapping for hardcoded pools
const TOKEN_ADDRESSES: Record<string, string> = {
  'DAI': '0x6B175474E89094C44Da98b954EedeAC495271d0F',
  'USDC': '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  'USDT': '0xdAC17F958D2ee523a2206206994597C13D831ec7',
  'WETH': '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
  'STETH': '0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84'
};

// ABI for Curve Registry
const CURVE_REGISTRY_ABI = [
  'function get_pool_from_lp_token(address) view returns (address)',
  'function get_n_coins(address) view returns (uint256)',
  'function get_coins(address) view returns (address[8])',
  'function get_pools_for_coin(address) view returns (address[10])'
];

// ABI for Curve Pool
const CURVE_POOL_ABI = [
  'function exchange(int128,int128,uint256,uint256) returns (uint256)',
  'function get_dy(int128,int128,uint256) view returns (uint256)',
  'function coins(uint256) view returns (address)',
  'function balances(uint256) view returns (uint256)'
];

/**
 * Utility class for interacting with Curve Finance pools
 */
export class CurveAdapter {
  private provider: providers.Provider;
  private registry: Contract;
  private pools: Map<string, Contract> = new Map();
  private coinIndices: Map<string, Map<string, number>> = new Map();
  
  /**
   * Create a new Curve adapter
   * @param provider Ethers provider
   */
  constructor(provider: providers.Provider) {
    this.provider = provider;
    this.registry = new Contract(CURVE_REGISTRY_ADDRESS, CURVE_REGISTRY_ABI, provider);
  }
  
  /**
   * Find the best Curve pool for a pair of tokens
   * @param tokenA First token address
   * @param tokenB Second token address
   * @returns Pool address and indices for the tokens
   */
  async findBestPool(tokenA: string, tokenB: string): Promise<{ 
    poolAddress: string, 
    tokenAIndex: number, 
    tokenBIndex: number 
  } | null> {
    // First, try to find a hardcoded pool
    const hardcodedPool = this.findHardcodedPool(tokenA, tokenB);
    if (hardcodedPool) {
      console.log(`Using hardcoded pool for ${this.getTokenSymbol(tokenA)}/${this.getTokenSymbol(tokenB)} at ${hardcodedPool.poolAddress}`);
      return hardcodedPool;
    }
    
    try {
      // Try to use the registry
      // Get pools that include tokenA
      const poolsForA = await this.registry.get_pools_for_coin(tokenA);
      
      // Filter for pools that also include tokenB
      for (const poolAddress of poolsForA) {
        if (poolAddress === '0x0000000000000000000000000000000000000000') continue;
        
        const pool = await this.getPool(poolAddress);
        const [tokenAIndex, tokenBIndex] = await this.findTokenIndices(pool, tokenA, tokenB);
        
        if (tokenAIndex !== -1 && tokenBIndex !== -1) {
          return {
            poolAddress,
            tokenAIndex,
            tokenBIndex
          };
        }
      }
      
      return null;
    } catch (error) {
      console.error('Error finding Curve pool using registry, using fallback pools:', error);
      
      // If registry call failed, try to use hardcoded pools as fallback
      return this.findHardcodedPool(tokenA, tokenB);
    }
  }
  
  /**
   * Find a hardcoded pool for a pair of tokens
   * @param tokenA First token address
   * @param tokenB Second token address 
   * @returns Pool info or null if not found
   */
  private findHardcodedPool(tokenA: string, tokenB: string): { 
    poolAddress: string, 
    tokenAIndex: number, 
    tokenBIndex: number 
  } | null {
    const symbolA = this.getTokenSymbol(tokenA);
    const symbolB = this.getTokenSymbol(tokenB);
    
    if (!symbolA || !symbolB) return null;
    
    // Try both orders
    const key1 = `${symbolA}-${symbolB}`;
    const key2 = `${symbolB}-${symbolA}`;
    
    if (HARDCODED_POOLS[key1]) {
      return HARDCODED_POOLS[key1];
    } 
    
    if (HARDCODED_POOLS[key2]) {
      // Swap indices for reverse order
      const pool = HARDCODED_POOLS[key2];
      return {
        poolAddress: pool.poolAddress,
        tokenAIndex: pool.tokenBIndex,
        tokenBIndex: pool.tokenAIndex
      };
    }
    
    return null;
  }
  
  /**
   * Get token symbol from address
   * @param address Token address
   * @returns Token symbol or null
   */
  private getTokenSymbol(address: string): string | null {
    address = address.toLowerCase();
    
    for (const [symbol, addr] of Object.entries(TOKEN_ADDRESSES)) {
      if (addr.toLowerCase() === address) {
        return symbol;
      }
    }
    
    return null;
  }
  
  /**
   * Get a Curve pool contract by address
   * @param poolAddress Pool address
   * @returns Pool contract
   */
  async getPool(poolAddress: string): Promise<Contract> {
    if (this.pools.has(poolAddress)) {
      return this.pools.get(poolAddress)!;
    }
    
    const pool = new Contract(poolAddress, CURVE_POOL_ABI, this.provider);
    this.pools.set(poolAddress, pool);
    return pool;
  }
  
  /**
   * Find token indices in a pool
   * @param pool Pool contract
   * @param tokenA First token address
   * @param tokenB Second token address
   * @returns Indices for both tokens
   */
  private async findTokenIndices(
    pool: Contract, 
    tokenA: string, 
    tokenB: string
  ): Promise<[number, number]> {
    // Check if we've already cached the indices
    const poolAddress = pool.address.toLowerCase();
    
    if (!this.coinIndices.has(poolAddress)) {
      this.coinIndices.set(poolAddress, new Map());
    }
    
    const poolIndices = this.coinIndices.get(poolAddress)!;
    
    if (poolIndices.has(tokenA.toLowerCase()) && poolIndices.has(tokenB.toLowerCase())) {
      return [
        poolIndices.get(tokenA.toLowerCase())!,
        poolIndices.get(tokenB.toLowerCase())!
      ];
    }
    
    // Find the indices
    try {
      const numCoins = (await this.registry.get_n_coins(pool.address)).toNumber();
      let tokenAIndex = -1;
      let tokenBIndex = -1;
      
      for (let i = 0; i < numCoins; i++) {
        const coinAddress = (await pool.coins(i)).toLowerCase();
        poolIndices.set(coinAddress, i);
        
        if (coinAddress === tokenA.toLowerCase()) {
          tokenAIndex = i;
        }
        if (coinAddress === tokenB.toLowerCase()) {
          tokenBIndex = i;
        }
      }
      
      return [tokenAIndex, tokenBIndex];
    } catch (error) {
      console.error('Error finding token indices:', error);
      return [-1, -1];
    }
  }
  
  /**
   * Get the expected output amount for a swap
   * @param poolAddress Pool address
   * @param tokenAIndex Index of input token
   * @param tokenBIndex Index of output token
   * @param amountIn Input amount
   * @returns Expected output amount
   */
  async getAmountOut(
    poolAddress: string,
    tokenAIndex: number,
    tokenBIndex: number,
    amountIn: BigNumber
  ): Promise<BigNumber> {
    try {
      const pool = await this.getPool(poolAddress);
      const amountOut = await pool.get_dy(
        tokenAIndex,
        tokenBIndex,
        amountIn
      );
      return amountOut;
    } catch (error) {
      console.error('Error getting amount out:', error);
      return BigNumber.from(0);
    }
  }
  
  /**
   * Create transaction data for a Curve swap
   * @param poolAddress Pool address
   * @param tokenAIndex Index of input token
   * @param tokenBIndex Index of output token
   * @param amountIn Input amount
   * @param minAmountOut Minimum output amount
   * @returns Transaction data
   */
  createSwapTransaction(
    poolAddress: string,
    tokenAIndex: number,
    tokenBIndex: number,
    amountIn: BigNumber,
    minAmountOut: BigNumber
  ): {to: string, data: string} {
    const pool = this.pools.get(poolAddress)!;
    
    const data = pool.interface.encodeFunctionData('exchange', [
      tokenAIndex,
      tokenBIndex,
      amountIn,
      minAmountOut
    ]);
    
    return {
      to: poolAddress,
      data
    };
  }
  
  /**
   * Find multiple paths through Curve for more complex arbitrage
   * @param startToken Starting token
   * @param middleToken Optional middle token
   * @param endToken Ending token (can be the same as start for arbitrage)
   * @returns Array of possible paths with pool information
   */
  async findArbitragePaths(
    startToken: string, 
    middleToken: string | null, 
    endToken: string
  ): Promise<Array<{
    path: string[],
    pools: string[],
    indices: number[][]
  }>> {
    const paths: Array<{
      path: string[],
      pools: string[],
      indices: number[][]
    }> = [];
    
    if (middleToken) {
      // Try to find a 2-hop path through the middle token
      const hop1 = await this.findBestPool(startToken, middleToken);
      const hop2 = await this.findBestPool(middleToken, endToken);
      
      if (hop1 && hop2) {
        paths.push({
          path: [startToken, middleToken, endToken],
          pools: [hop1.poolAddress, hop2.poolAddress],
          indices: [
            [hop1.tokenAIndex, hop1.tokenBIndex],
            [hop2.tokenAIndex, hop2.tokenBIndex]
          ]
        });
      }
    } else {
      // Try to find a direct path
      const directPath = await this.findBestPool(startToken, endToken);
      
      if (directPath) {
        paths.push({
          path: [startToken, endToken],
          pools: [directPath.poolAddress],
          indices: [[directPath.tokenAIndex, directPath.tokenBIndex]]
        });
      }
    }
    
    return paths;
  }
  
  /**
   * Simulate a swap sequence through Curve pools
   * @param path Token path
   * @param pools Pool addresses
   * @param indices Token indices in each pool
   * @param amountIn Input amount
   * @returns Final output amount
   */
  async simulatePathSwap(
    path: string[],
    pools: string[],
    indices: number[][],
    amountIn: BigNumber
  ): Promise<BigNumber> {
    if (path.length !== pools.length + 1 || pools.length !== indices.length) {
      throw new Error('Invalid path configuration');
    }
    
    let currentAmount = amountIn;
    
    for (let i = 0; i < pools.length; i++) {
      currentAmount = await this.getAmountOut(
        pools[i],
        indices[i][0],
        indices[i][1],
        currentAmount
      );
      
      if (currentAmount.isZero()) {
        // If any step returns zero, the whole path will yield zero
        return BigNumber.from(0);
      }
    }
    
    return currentAmount;
  }
}
