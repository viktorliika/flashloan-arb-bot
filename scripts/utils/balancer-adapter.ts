import { BigNumber, Contract, providers } from 'ethers';

// Balancer Vault address on Ethereum mainnet
const BALANCER_VAULT_ADDRESS = '0xBA12222222228d8Ba445958a75a0704d566BF2C8';

// ABI for Balancer Vault
const BALANCER_VAULT_ABI = [
  'function swap(tuple(bytes32 poolId, uint8 kind, address assetIn, address assetOut, uint256 amount, bytes userData) singleSwap, tuple(address sender, bool fromInternalBalance, address payable recipient, bool toInternalBalance) funds, uint256 limit, uint256 deadline) external payable returns (uint256)',
  'function queryBatchSwap(uint8 kind, tuple(bytes32 poolId, uint8 kind, address assetIn, address assetOut, uint256 amount, bytes userData)[] swaps, address[] assets, tuple(address sender, bool fromInternalBalance, address payable recipient, bool toInternalBalance) funds) external returns (int256[])',
  'function getPool(address pool) external view returns (bytes32)',
  'function getPoolTokens(bytes32 poolId) external view returns (address[] tokens, uint256[] balances, uint256 lastChangeBlock)'
];

// ABI for Balancer Pool
const BALANCER_POOL_ABI = [
  'function getPoolId() external view returns (bytes32)',
  'function getSwapFeePercentage() external view returns (uint256)',
  'function getActualSupply() external view returns (uint256)'
];

// Swap kinds
enum SwapKind {
  GIVEN_IN = 0,
  GIVEN_OUT = 1
}

// Common pool types in Balancer
const POOL_TYPES = {
  WEIGHTED_POOL: 'WeightedPool',
  STABLE_POOL: 'StablePool',
  META_STABLE_POOL: 'MetaStablePool',
  LIQUIDITY_BOOTSTRAPPING_POOL: 'LiquidityBootstrappingPool'
};

// Common Balancer pools for major pairs
const KNOWN_POOLS: Record<string, {
  address: string;
  poolId: string;
  type: string;
  tokens: string[];
}> = {
  // WETH-DAI (80/20 weighted pool)
  'WETH-DAI': {
    address: '0x0b09deA16768f0799065C475bE02919503cB2a35',
    poolId: '0x0b09dea16768f0799065c475be02919503cb2a3500020000000000000000001a',
    type: POOL_TYPES.WEIGHTED_POOL,
    tokens: [
      '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
      '0x6B175474E89094C44Da98b954EedeAC495271d0F'  // DAI
    ]
  },
  // WETH-USDC (80/20 weighted pool)
  'WETH-USDC': {
    address: '0x96646936b91d6B9D7D0c47C496AfBF3D6ec7B6f8',
    poolId: '0x96646936b91d6b9d7d0c47c496afbf3d6ec7b6f8000200000000000000000019',
    type: POOL_TYPES.WEIGHTED_POOL,
    tokens: [
      '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
      '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'  // USDC
    ]
  },
  // DAI-USDC-USDT (Stable Pool)
  'DAI-USDC-USDT': {
    address: '0x06Df3b2bbB68adc8B0e302443692037ED9f91b42',
    poolId: '0x06df3b2bbb68adc8b0e302443692037ed9f91b42000000000000000000000063',
    type: POOL_TYPES.STABLE_POOL,
    tokens: [
      '0x6B175474E89094C44Da98b954EedeAC495271d0F', // DAI
      '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
      '0xdAC17F958D2ee523a2206206994597C13D831ec7'  // USDT
    ]
  }
};

// Token address mapping
const TOKEN_ADDRESSES: Record<string, string> = {
  'WETH': '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
  'DAI': '0x6B175474E89094C44Da98b954EedeAC495271d0F',
  'USDC': '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  'USDT': '0xdAC17F958D2ee523a2206206994597C13D831ec7',
  'WBTC': '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599'
};

/**
 * Utility class for interacting with Balancer V2
 */
export class BalancerAdapter {
  private provider: providers.Provider;
  private vault: Contract;
  private pools: Map<string, Contract> = new Map();
  private poolIds: Map<string, string> = new Map();
  
  /**
   * Create a new Balancer adapter
   * @param provider Ethers provider
   */
  constructor(provider: providers.Provider) {
    this.provider = provider;
    this.vault = new Contract(BALANCER_VAULT_ADDRESS, BALANCER_VAULT_ABI, provider);
    
    // Pre-load known pool IDs
    for (const [key, poolInfo] of Object.entries(KNOWN_POOLS)) {
      this.poolIds.set(poolInfo.address.toLowerCase(), poolInfo.poolId);
    }
  }
  
  /**
   * Find a suitable Balancer pool for a token pair
   * @param tokenA First token address
   * @param tokenB Second token address
   * @returns Pool info or null if not found
   */
  async findPool(tokenA: string, tokenB: string): Promise<{
    poolAddress: string;
    poolId: string;
    tokenAIndex: number;
    tokenBIndex: number;
  } | null> {
    try {
      // First check in known pools
      const poolInfo = this.findKnownPool(tokenA, tokenB);
      if (poolInfo) {
        return poolInfo;
      }
      
      // Here you would implement a more comprehensive search
      // For production, you could use:
      // 1. External API calls to Balancer Subgraph
      // 2. Cache of recent pool discoveries
      // 3. On-chain lookup logic
      
      // For now, return null if not in our hardcoded list
      console.warn(`No Balancer pool found for ${tokenA}-${tokenB}`);
      return null;
    } catch (error) {
      console.error('Error finding Balancer pool:', error);
      return null;
    }
  }
  
  /**
   * Find a pool from the hardcoded known pools
   * @param tokenA First token address
   * @param tokenB Second token address
   * @returns Pool info or null if not found
   */
  private findKnownPool(tokenA: string, tokenB: string): {
    poolAddress: string;
    poolId: string;
    tokenAIndex: number;
    tokenBIndex: number;
  } | null {
    tokenA = tokenA.toLowerCase();
    tokenB = tokenB.toLowerCase();
    
    // Get token symbols for matching
    const symbolA = this.getTokenSymbol(tokenA);
    const symbolB = this.getTokenSymbol(tokenB);
    
    if (!symbolA || !symbolB) return null;
    
    // Look for direct pair (order matters for pool lookup)
    const key1 = `${symbolA}-${symbolB}`;
    const key2 = `${symbolB}-${symbolA}`;
    
    // Check if pool exists for this pair
    let poolInfo = KNOWN_POOLS[key1] || KNOWN_POOLS[key2];
    
    // Also check for pairs within multi-token pools (like stable pools)
    if (!poolInfo) {
      for (const [key, info] of Object.entries(KNOWN_POOLS)) {
        if (key.includes('-')) {
          const tokensA = info.tokens.map(t => t.toLowerCase());
          const indexA = tokensA.indexOf(tokenA);
          const indexB = tokensA.indexOf(tokenB);
          
          if (indexA !== -1 && indexB !== -1) {
            poolInfo = info;
            
            return {
              poolAddress: poolInfo.address,
              poolId: poolInfo.poolId,
              tokenAIndex: indexA,
              tokenBIndex: indexB
            };
          }
        }
      }
      
      return null;
    }
    
    // Find token indices in the pool
    const tokens = poolInfo.tokens.map(t => t.toLowerCase());
    const tokenAIndex = tokens.indexOf(tokenA);
    const tokenBIndex = tokens.indexOf(tokenB);
    
    if (tokenAIndex === -1 || tokenBIndex === -1) {
      return null;
    }
    
    return {
      poolAddress: poolInfo.address,
      poolId: poolInfo.poolId,
      tokenAIndex,
      tokenBIndex
    };
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
   * Get Balancer pool contract
   * @param poolAddress Pool address
   * @returns Pool contract
   */
  async getPool(poolAddress: string): Promise<Contract> {
    if (this.pools.has(poolAddress)) {
      return this.pools.get(poolAddress)!;
    }
    
    const pool = new Contract(poolAddress, BALANCER_POOL_ABI, this.provider);
    this.pools.set(poolAddress, pool);
    return pool;
  }
  
  /**
   * Get the pool ID for a pool
   * @param poolAddress Pool address
   * @returns Pool ID
   */
  async getPoolId(poolAddress: string): Promise<string> {
    // Check cache first
    if (this.poolIds.has(poolAddress.toLowerCase())) {
      return this.poolIds.get(poolAddress.toLowerCase())!;
    }
    
    // Get from contract
    try {
      const pool = await this.getPool(poolAddress);
      const poolId = await pool.getPoolId();
      
      // Cache for future
      this.poolIds.set(poolAddress.toLowerCase(), poolId);
      
      return poolId;
    } catch (error) {
      console.error(`Error getting pool ID for ${poolAddress}:`, error);
      throw error;
    }
  }
  
  /**
   * Calculate the expected output amount for a swap
   * @param poolAddress Pool address
   * @param tokenFrom Input token address
   * @param tokenTo Output token address
   * @param amountIn Input amount
   * @returns Expected output amount
   */
  async getAmountOut(
    poolAddress: string,
    tokenFrom: string,
    tokenTo: string,
    amountIn: BigNumber
  ): Promise<BigNumber> {
    try {
      // Get pool ID
      const poolId = await this.getPoolId(poolAddress);
      
      // Prepare swap parameters
      const singleSwap = {
        poolId,
        kind: SwapKind.GIVEN_IN,
        assetIn: tokenFrom,
        assetOut: tokenTo,
        amount: amountIn,
        userData: '0x'
      };
      
      const funds = {
        sender: '0x0000000000000000000000000000000000000000',
        fromInternalBalance: false,
        recipient: '0x0000000000000000000000000000000000000000',
        toInternalBalance: false
      };
      
      // Query amounts using BatchSwap to avoid state changes
      const assets = [tokenFrom, tokenTo];
      
      // Dummy swap to get price without state change
      const swaps = [{
        poolId,
        kind: SwapKind.GIVEN_IN,
        assetIn: tokenFrom,
        assetOut: tokenTo,
        amount: amountIn,
        userData: '0x'
      }];
      
      // Since queryBatchSwap changes state (revert), we need to estimate it
      try {
        const deltas = await this.vault.callStatic.queryBatchSwap(
          SwapKind.GIVEN_IN,
          swaps,
          assets,
          funds
        );
        
        // First delta is negative (tokens going in), second is positive (tokens coming out)
        // Get the absolute value of the second delta
        return BigNumber.from(deltas[1]).abs();
      } catch (error) {
        console.error('Error estimating amount out:', error);
        return BigNumber.from(0);
      }
    } catch (error) {
      console.error('Error getting amount out from Balancer:', error);
      return BigNumber.from(0);
    }
  }
  
  /**
   * Create transaction data for a Balancer swap
   * @param poolAddress Pool address
   * @param tokenFrom Input token address
   * @param tokenTo Output token address
   * @param amountIn Input amount
   * @param minAmountOut Minimum output amount
   * @returns Transaction data
   */
  async createSwapTransaction(
    poolAddress: string,
    tokenFrom: string,
    tokenTo: string,
    amountIn: BigNumber,
    minAmountOut: BigNumber
  ): Promise<{to: string, data: string}> {
    // Get pool ID
    const poolId = await this.getPoolId(poolAddress);
    
    // Prepare swap parameters
    const singleSwap = {
      poolId,
      kind: SwapKind.GIVEN_IN,
      assetIn: tokenFrom,
      assetOut: tokenTo,
      amount: amountIn,
      userData: '0x'
    };
    
    const funds = {
      sender: '0x0000000000000000000000000000000000000000', // Will be replaced by caller
      fromInternalBalance: false,
      recipient: '0x0000000000000000000000000000000000000000', // Will be replaced by caller
      toInternalBalance: false
    };
    
    // Current timestamp + 5 minutes
    const deadline = Math.floor(Date.now() / 1000) + 300;
    
    // Encode function call
    const data = this.vault.interface.encodeFunctionData('swap', [
      singleSwap,
      funds,
      minAmountOut,
      deadline
    ]);
    
    return {
      to: BALANCER_VAULT_ADDRESS,
      data
    };
  }
  
  /**
   * Find arbitrage paths through Balancer
   * @param startToken Starting token
   * @param middleToken Optional middle token
   * @param endToken Ending token
   * @returns Array of paths with pool information
   */
  async findArbitragePaths(
    startToken: string,
    middleToken: string | null,
    endToken: string
  ): Promise<Array<{
    path: string[];
    pools: string[];
    indices: number[][];
  }>> {
    const paths: Array<{
      path: string[];
      pools: string[];
      indices: number[][];
    }> = [];
    
    if (middleToken) {
      // Try to find a 2-hop path
      const hop1 = await this.findPool(startToken, middleToken);
      const hop2 = await this.findPool(middleToken, endToken);
      
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
      const directPath = await this.findPool(startToken, endToken);
      
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
   * Simulate a swap sequence through Balancer pools
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
        path[i],
        path[i + 1],
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
