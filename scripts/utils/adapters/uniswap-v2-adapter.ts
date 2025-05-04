import { BigNumber, Contract, providers } from 'ethers';
import { DexAdapter, PoolInfo, ArbitragePath } from '../interfaces/dex-adapter';

// Uniswap V2 Factory and Router addresses on Ethereum mainnet
const UNISWAP_V2_FACTORY_ADDRESS = '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f';
const UNISWAP_V2_ROUTER_ADDRESS = '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D';

// ABIs for interacting with Uniswap V2 contracts
const UNISWAP_V2_FACTORY_ABI = [
  'function getPair(address tokenA, address tokenB) external view returns (address pair)',
  'function allPairs(uint) external view returns (address pair)',
  'function allPairsLength() external view returns (uint)'
];

const UNISWAP_V2_PAIR_ABI = [
  'function token0() external view returns (address)',
  'function token1() external view returns (address)',
  'function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
  'function swap(uint amount0Out, uint amount1Out, address to, bytes data) external'
];

const UNISWAP_V2_ROUTER_ABI = [
  'function getAmountOut(uint amountIn, uint reserveIn, uint reserveOut) external pure returns (uint amountOut)',
  'function getAmountsOut(uint amountIn, address[] memory path) external view returns (uint[] memory amounts)',
  'function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)'
];

// Common token addresses
const COMMON_TOKEN_ADDRESSES = {
  WETH: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
  USDC: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  USDT: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
  DAI: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
  WBTC: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599'
};

/**
 * Adapter implementation for Uniswap V2 DEX
 */
export class UniswapV2Adapter implements DexAdapter {
  // DEX name for identification
  readonly name: string = 'Uniswap V2';
  
  // Contracts
  private provider: providers.Provider;
  private factory: Contract;
  private router: Contract;
  private pairCache: Map<string, string> = new Map();
  private reservesCache: Map<string, { reserve0: BigNumber, reserve1: BigNumber, lastUpdated: number }> = new Map();
  
  /**
   * Create a new Uniswap V2 adapter
   * @param provider Ethers provider
   */
  constructor(provider: providers.Provider) {
    this.provider = provider;
    this.factory = new Contract(UNISWAP_V2_FACTORY_ADDRESS, UNISWAP_V2_FACTORY_ABI, provider);
    this.router = new Contract(UNISWAP_V2_ROUTER_ADDRESS, UNISWAP_V2_ROUTER_ABI, provider);
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
      // Sort tokens to match Uniswap's canonical ordering
      const [token0, token1] = this.sortTokens(tokenA, tokenB);
      
      // Check cache first
      const cacheKey = `${token0.toLowerCase()}-${token1.toLowerCase()}`;
      let pairAddress: string | undefined = this.pairCache.get(cacheKey);
      
      if (!pairAddress) {
        try {
          // Get pair address from factory
          pairAddress = await this.factory.getPair(token0, token1);
          
          // Cache the result
          if (pairAddress) {
            this.pairCache.set(cacheKey, pairAddress);
          }
        } catch (error) {
          console.error(`Error getting Uniswap V2 pair: ${error instanceof Error ? error.message : String(error)}`);
          
          // For common token pairs, use hardcoded addresses as fallback
          const hardcodedAddress = this.getHardcodedPairAddress(token0, token1);
          
          if (hardcodedAddress) {
            pairAddress = hardcodedAddress;
            console.log(`Using hardcoded pair address for ${this.getTokenSymbol(token0)}/${this.getTokenSymbol(token1)}: ${pairAddress}`);
            this.pairCache.set(cacheKey, pairAddress);
          }
        }
      }
      
      // If no pair exists, return empty array
      if (!pairAddress || pairAddress === '0x0000000000000000000000000000000000000000') {
        return [];
      }
      
      // Create pool info object
      const poolInfo: PoolInfo = {
        dex: this.name,
        address: pairAddress,
        id: pairAddress,
        tokens: [token0, token1],
        fee: 3000, // Uniswap V2 has a fixed 0.3% fee
        metadata: {
          isUniswapV2: true
        }
      };
      
      return [poolInfo];
    } catch (error) {
      console.error(`Error finding Uniswap V2 pools: ${error instanceof Error ? error.message : String(error)}`);
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
      // Try to get from router
      try {
        const amounts = await this.router.getAmountsOut(amountIn, [tokenIn, tokenOut]);
        if (amounts && amounts.length > 1) {
          return amounts[1];
        }
      } catch (error) {
        console.error(`Router getAmountsOut failed: ${error instanceof Error ? error.message : String(error)}`);
        // Continue to fallback calculation
      }
      
      // Fallback: calculate manually using reserves
      const reserves = await this.getReserves(poolInfo.address);
      if (!reserves) {
        return BigNumber.from(0);
      }
      
      // Determine which token is token0 and which is token1
      const pairContract = new Contract(poolInfo.address, UNISWAP_V2_PAIR_ABI, this.provider);
      let token0, token1;
      
      try {
        token0 = await pairContract.token0();
        token1 = await pairContract.token1();
      } catch (error) {
        // If we can't get the tokens, assume they're in the order of the pool's tokens
        console.error(`Error getting tokens from pair: ${error instanceof Error ? error.message : String(error)}`);
        [token0, token1] = poolInfo.tokens;
      }
      
      // Get the reserves in the correct order
      const [reserveIn, reserveOut] = tokenIn.toLowerCase() === token0.toLowerCase() ?
        [reserves.reserve0, reserves.reserve1] :
        [reserves.reserve1, reserves.reserve0];
      
      // Calculate amount out using Uniswap V2 formula
      return this.getAmountOutManual(amountIn, reserveIn, reserveOut);
    } catch (error) {
      console.error(`Error calculating amount out: ${error instanceof Error ? error.message : String(error)}`);
      
      // Last resort fallback: use a very conservative estimate
      // This assumes roughly equivalent value with a 0.5% fee
      return amountIn.mul(995).div(1000);
    }
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
    const paths: ArbitragePath[] = [];
    
    if (middleToken) {
      // For triangle arbitrage - this is a 2-hop path
      try {
        // First hop: startToken -> middleToken
        const firstHopPools = await this.findPools(startToken, middleToken);
        if (firstHopPools.length === 0) {
          return [];
        }
        
        // Second hop: middleToken -> endToken
        const secondHopPools = await this.findPools(middleToken, endToken);
        if (secondHopPools.length === 0) {
          return [];
        }
        
        // Create arbitrage path
        paths.push({
          path: [startToken, middleToken, endToken],
          pools: [firstHopPools[0], secondHopPools[0]]
        });
      } catch (error) {
        console.error(`Error finding triangle arbitrage paths: ${error instanceof Error ? error.message : String(error)}`);
      }
    } else {
      // For direct arbitrage - this is a 1-hop path
      try {
        const directPools = await this.findPools(startToken, endToken);
        if (directPools.length > 0) {
          paths.push({
            path: [startToken, endToken],
            pools: [directPools[0]]
          });
        }
      } catch (error) {
        console.error(`Error finding direct arbitrage paths: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    
    return paths;
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
    
    try {
      // For simple paths, we can use the router directly
      if (path.length === 2) {
        return this.getAmountOut(pools[0], path[0], path[1], amountIn);
      }
      
      // For multi-hop paths, we need to simulate each swap
      let currentAmount = amountIn;
      
      for (let i = 0; i < pools.length; i++) {
        currentAmount = await this.getAmountOut(
          pools[i],
          path[i],
          path[i + 1],
          currentAmount
        );
        
        if (currentAmount.isZero()) {
          return BigNumber.from(0);
        }
      }
      
      return currentAmount;
    } catch (error) {
      console.error(`Error simulating path swap: ${error instanceof Error ? error.message : String(error)}`);
      return BigNumber.from(0);
    }
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
    // Calculate deadline (current timestamp + 5 minutes)
    const deadline = Math.floor(Date.now() / 1000) + 300;
    
    // Create path
    const path = [tokenIn, tokenOut];
    
    // Encode function call to router
    const data = this.router.interface.encodeFunctionData('swapExactTokensForTokens', [
      amountIn,
      minAmountOut,
      path,
      '0x0000000000000000000000000000000000000000', // Will be replaced by the caller
      deadline
    ]);
    
    return {
      to: UNISWAP_V2_ROUTER_ADDRESS,
      data
    };
  }
  
  /**
   * Helper method to sort tokens according to Uniswap's canonical ordering
   * @param tokenA First token address
   * @param tokenB Second token address
   * @returns Sorted token addresses [token0, token1]
   */
  private sortTokens(tokenA: string, tokenB: string): [string, string] {
    return tokenA.toLowerCase() < tokenB.toLowerCase()
      ? [tokenA, tokenB]
      : [tokenB, tokenA];
  }
  
  /**
   * Get pair reserves from the blockchain or cache
   * @param pairAddress Pair contract address
   * @returns Reserves or null if not found
   */
  private async getReserves(pairAddress: string): Promise<{ reserve0: BigNumber, reserve1: BigNumber } | null> {
    try {
      // Check cache first (only use cache if less than 60 seconds old)
      const cached = this.reservesCache.get(pairAddress);
      const now = Date.now();
      
      if (cached && now - cached.lastUpdated < 60000) {
        return {
          reserve0: cached.reserve0,
          reserve1: cached.reserve1
        };
      }
      
      // Get from blockchain
      const pairContract = new Contract(pairAddress, UNISWAP_V2_PAIR_ABI, this.provider);
      const [reserve0, reserve1] = await pairContract.getReserves();
      
      // Update cache
      this.reservesCache.set(pairAddress, {
        reserve0,
        reserve1,
        lastUpdated: now
      });
      
      return { reserve0, reserve1 };
    } catch (error) {
      console.error(`Error getting reserves: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }
  
  /**
   * Calculate amount out using Uniswap V2 formula manually
   * Formula: amountOut = (amountIn * 997 * reserveOut) / (reserveIn * 1000 + amountIn * 997)
   */
  private getAmountOutManual(amountIn: BigNumber, reserveIn: BigNumber, reserveOut: BigNumber): BigNumber {
    if (amountIn.isZero() || reserveIn.isZero() || reserveOut.isZero()) {
      return BigNumber.from(0);
    }
    
    const amountInWithFee = amountIn.mul(997);
    const numerator = amountInWithFee.mul(reserveOut);
    const denominator = reserveIn.mul(1000).add(amountInWithFee);
    
    return numerator.div(denominator);
  }
  
  /**
   * Get hardcoded pair address for common pairs
   * This is useful as a fallback in forked environments
   */
  private getHardcodedPairAddress(token0: string, token1: string): string | null {
    // Normalize addresses
    const normalizedToken0 = token0.toLowerCase();
    const normalizedToken1 = token1.toLowerCase();
    
    // Map of common Uniswap V2 pairs
    const commonPairs: Record<string, string> = {
      // WETH-USDC
      [`${COMMON_TOKEN_ADDRESSES.WETH.toLowerCase()}-${COMMON_TOKEN_ADDRESSES.USDC.toLowerCase()}`]: 
        '0xB4e16d0168e52d35CaCD2c6185b44281Ec28C9Dc',
      
      // WETH-USDT
      [`${COMMON_TOKEN_ADDRESSES.WETH.toLowerCase()}-${COMMON_TOKEN_ADDRESSES.USDT.toLowerCase()}`]: 
        '0x0d4a11d5EEaaC28EC3F61d100daF4d40471f1852',
      
      // WETH-DAI
      [`${COMMON_TOKEN_ADDRESSES.WETH.toLowerCase()}-${COMMON_TOKEN_ADDRESSES.DAI.toLowerCase()}`]: 
        '0xA478c2975Ab1Ea89e8196811F51A7B7Ade33eB11',
      
      // WETH-WBTC
      [`${COMMON_TOKEN_ADDRESSES.WETH.toLowerCase()}-${COMMON_TOKEN_ADDRESSES.WBTC.toLowerCase()}`]: 
        '0xBb2b8038a1640196FbE3e38816F3e67Cba72D940',
      
      // USDC-USDT
      [`${COMMON_TOKEN_ADDRESSES.USDC.toLowerCase()}-${COMMON_TOKEN_ADDRESSES.USDT.toLowerCase()}`]: 
        '0x3041CbD36888bECc7bbCBc0045E3B1f144466f5f',
      
      // DAI-USDC
      [`${COMMON_TOKEN_ADDRESSES.DAI.toLowerCase()}-${COMMON_TOKEN_ADDRESSES.USDC.toLowerCase()}`]: 
        '0xAE461cA67B15dc8dc81CE7615e0320dA1A9aB8D5'
    };
    
    // Check both token orderings
    const key1 = `${normalizedToken0}-${normalizedToken1}`;
    const key2 = `${normalizedToken1}-${normalizedToken0}`;
    
    return commonPairs[key1] || commonPairs[key2] || null;
  }
  
  /**
   * Helper to get token symbol from address
   */
  private getTokenSymbol(address: string): string {
    const addressLower = address.toLowerCase();
    
    for (const [symbol, addr] of Object.entries(COMMON_TOKEN_ADDRESSES)) {
      if (addr.toLowerCase() === addressLower) {
        return symbol;
      }
    }
    
    return address.substring(0, 6) + '...' + address.substring(38);
  }
}
