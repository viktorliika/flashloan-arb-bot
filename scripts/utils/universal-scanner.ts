import { BigNumber, providers } from 'ethers';
import { DexAdapter, PoolInfo, ArbitragePath } from './interfaces/dex-adapter';
import { OpportunityValidator, ArbitrageOpportunity, ValidationResult } from './opportunity-validator';
import { CoinGeckoPriceProvider } from './price-feed';

/**
 * Arbitrage opportunity with enhanced data for validation and execution
 */
export interface EnhancedArbitrageOpportunity extends ArbitrageOpportunity {
  // Source DEX of the opportunity
  sourceDex: string;
  
  // Destination DEX of the opportunity
  destinationDex: string;
  
  // All pools involved in the opportunity
  pools: PoolInfo[];
  
  // Raw price difference percentage
  priceDifferencePercentage: number;
  
  // Timestamp when the opportunity was found
  timestamp: number;
}

/**
 * UniversalScanner coordinates multiple DEX adapters to find arbitrage opportunities
 */
export class UniversalScanner {
  private adapters: DexAdapter[] = [];
  private provider: providers.Provider;
  private validator: OpportunityValidator;
  private priceProvider: CoinGeckoPriceProvider;
  
  /**
   * Create a new universal scanner
   * @param provider Ethereum provider
   * @param validator Opportunity validator
   */
  constructor(
    provider: providers.Provider,
    validator: OpportunityValidator,
    priceProvider: CoinGeckoPriceProvider | null = null
  ) {
    this.provider = provider;
    this.validator = validator;
    this.priceProvider = priceProvider || new CoinGeckoPriceProvider();
  }
  
  /**
   * Register a DEX adapter with the scanner
   * @param adapter The DEX adapter to register
   */
  registerAdapter(adapter: DexAdapter): void {
    // Check if adapter with this name already exists
    const existingAdapterIndex = this.adapters.findIndex(a => a.name === adapter.name);
    
    if (existingAdapterIndex >= 0) {
      // Replace the existing adapter
      this.adapters[existingAdapterIndex] = adapter;
      console.log(`Replaced existing adapter: ${adapter.name}`);
    } else {
      // Add new adapter
      this.adapters.push(adapter);
      console.log(`Registered new adapter: ${adapter.name}`);
    }
  }
  
  /**
   * Get all registered adapters
   * @returns Array of registered DEX adapters
   */
  getAdapters(): DexAdapter[] {
    return [...this.adapters];
  }
  
  /**
   * Create a promise with a timeout
   * @param promise The promise to wrap with a timeout
   * @param timeoutMs Timeout in milliseconds
   * @param defaultValue Value to return on timeout
   */
  private timeoutPromise<T>(promise: Promise<T>, timeoutMs: number, defaultValue: T): Promise<T> {
    return new Promise<T>((resolve) => {
      const timeoutId = setTimeout(() => {
        console.log(`Operation timed out after ${timeoutMs}ms`);
        resolve(defaultValue);
      }, timeoutMs);
      
      promise.then(
        (result) => {
          clearTimeout(timeoutId);
          resolve(result);
        },
        (error) => {
          clearTimeout(timeoutId);
          console.error(`Operation failed with error: ${error}`);
          resolve(defaultValue);
        }
      );
    });
  }
  
  /**
   * Scan for direct arbitrage opportunities between DEXs
   * @param tokenA First token address (usually the token we want to get more of)
   * @param tokenB Second token address
   * @param amountIn Input amount
   * @returns Array of arbitrage opportunities
   */
  async scanForDirectArbitrageOpportunities(
    tokenA: string,
    tokenB: string,
    amountIn: BigNumber
  ): Promise<EnhancedArbitrageOpportunity[]> {
    console.log(`Scanning for direct arbitrage opportunities between ${tokenA} and ${tokenB}...`);
    
    try {
      // Resolve token symbols for better logging
      const tokenASymbol = await this.resolveTokenSymbol(tokenA);
      const tokenBSymbol = await this.resolveTokenSymbol(tokenB);
      console.log(`Token symbols: ${tokenASymbol}/${tokenBSymbol}`);
      
      // Fetch pools from all adapters in parallel with timeout protection
      const poolPromises = this.adapters.map(adapter => 
        this.timeoutPromise(
          adapter.findPools(tokenA, tokenB)
            .then(pools => ({ adapter, pools }))
            .catch(error => {
              console.error(`Error scanning ${adapter.name}: ${error instanceof Error ? error.message : String(error)}`);
              return { adapter, pools: [] };
            }),
          10000, // 10 second timeout
          { adapter, pools: [] } // Default value on timeout
        )
      );
      
      const adapterPools = await Promise.all(poolPromises);
      
      // Log pool counts
      adapterPools.forEach(({ adapter, pools }) => {
        console.log(`Found ${pools.length} pools in ${adapter.name}`);
      });
      
      // Calculate price for each pool and find arbitrage opportunities
      const opportunities: EnhancedArbitrageOpportunity[] = [];
      
      // Simulation: A -> B on DEX 1, then B -> A on DEX 2
      for (let i = 0; i < adapterPools.length; i++) {
        const source = adapterPools[i];
        
        // Skip if no pools found in this DEX
        if (source.pools.length === 0) continue;
        
        // Calculate prices on source DEX
        for (const sourcePool of source.pools) {
          try {
            // A -> B on source DEX
            const amountOutB = await this.timeoutPromise(
              source.adapter.getAmountOut(
                sourcePool, 
                tokenA, 
                tokenB, 
                amountIn
              ),
              5000, // 5 second timeout
              BigNumber.from(0) // Default value on timeout
            );
            
            // Skip if no liquidity or error
            if (amountOutB.isZero()) continue;
            
            // Now try to find arbitrage by going back through other DEXs
            for (let j = 0; j < adapterPools.length; j++) {
              // Skip self-arbitrage within same DEX (unlikely to be profitable)
              if (i === j) continue;
              
              const destination = adapterPools[j];
              
              // Skip if no pools found in this DEX
              if (destination.pools.length === 0) continue;
              
              for (const destPool of destination.pools) {
                try {
                  // B -> A on destination DEX
                  const amountOutA = await this.timeoutPromise(
                    destination.adapter.getAmountOut(
                      destPool,
                      tokenB,
                      tokenA,
                      amountOutB
                    ),
                    5000, // 5 second timeout
                    BigNumber.from(0) // Default value on timeout
                  );
                  
                  // Check if profitable (more A than we started with)
                  if (amountOutA.gt(amountIn)) {
                    const profit = amountOutA.sub(amountIn);
                    const profitPercent = profit.mul(10000).div(amountIn).toNumber() / 100;
                    
                    // Get token symbol for better logging
                    let tokenASymbol = tokenA;
                    try {
                      // Try to resolve token symbol
                      tokenASymbol = await this.resolveTokenSymbol(tokenA);
                    } catch (error) {
                      // Fallback to address if symbol resolution fails
                      console.error(`Error resolving token symbol: ${error instanceof Error ? error.message : String(error)}`);
                    }
                    
                    // Get token price for USD value
                    let tokenAPrice = 0;
                    try {
                      tokenAPrice = await this.priceProvider.getUsdPrice(tokenASymbol);
                    } catch (error) {
                      // Default to a reasonable value if price lookup fails
                      console.error(`Error getting token price: ${error instanceof Error ? error.message : String(error)}`);
                      tokenAPrice = tokenASymbol === 'ETH' || tokenASymbol === 'WETH' ? 3000 : 1;
                    }
                    
                    // Calculate profit in USD
                    const decimals = 18; // Assuming most tokens use 18 decimals, adjust if needed
                    const profitInUsd = parseFloat(profit.toString()) / Math.pow(10, decimals) * tokenAPrice;
                    
                    console.log(`Found arbitrage opportunity: ${source.adapter.name} -> ${destination.adapter.name}`);
                    console.log(`Profit: ${profit.toString()} ${tokenASymbol} (${profitPercent.toFixed(2)}%, $${profitInUsd.toFixed(2)})`);
                    
                    // Create enhanced opportunity object
                    const opportunity: EnhancedArbitrageOpportunity = {
                      tokenBorrow: tokenA,
                      flashLoanAmount: amountIn,
                      expectedProfit: profit,
                      tokenName: tokenASymbol,
                      path: [tokenA, tokenB, tokenA],
                      // Convert dex names to indices for compatibility
                      dexes: [0, 1], // Using generic indices since the original interface expects numbers
                      fees: [], // Optional, will depend on specific DEX
                      profitInUsd,
                      sourceDex: source.adapter.name,
                      destinationDex: destination.adapter.name,
                      pools: [sourcePool, destPool],
                      priceDifferencePercentage: profitPercent,
                      timestamp: Date.now()
                    };
                    
                    opportunities.push(opportunity);
                  }
                } catch (error) {
                  console.error(`Error calculating B->A on ${destination.adapter.name}: ${error instanceof Error ? error.message : String(error)}`);
                }
              }
            }
          } catch (error) {
            console.error(`Error calculating A->B on ${source.adapter.name}: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      }
      
      console.log(`Found ${opportunities.length} potential arbitrage opportunities`);
      
      // Validate all opportunities in parallel
      const validatedOpportunities = await this.validateArbitrageOpportunities(opportunities);
      
      console.log(`${validatedOpportunities.length} opportunities passed validation`);
      
      return validatedOpportunities;
    } catch (error) {
      console.error(`Error in scanning direct arbitrage: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  }
  
  /**
   * Scan for triangle arbitrage opportunities using multiple DEXs
   * @param startToken The token to start with and end with
   * @param intermediateTokens Possible intermediate tokens to route through
   * @param amountIn Input amount
   * @returns Array of arbitrage opportunities
   */
  async scanForTriangleArbitrageOpportunities(
    startToken: string,
    intermediateTokens: string[],
    amountIn: BigNumber
  ): Promise<EnhancedArbitrageOpportunity[]> {
    console.log(`Scanning for triangle arbitrage opportunities starting with ${startToken}...`);
    
    try {
      const opportunities: EnhancedArbitrageOpportunity[] = [];
      
      // Try each intermediate token
      for (const middleToken of intermediateTokens) {
        console.log(`Testing triangle path with middle token: ${middleToken}`);
        
        // Get all possible paths from all adapters in parallel with timeout
        const pathPromises = this.adapters.map(adapter => 
          this.timeoutPromise(
            adapter.findArbitragePaths(startToken, middleToken, startToken)
              .then(paths => ({ adapter, paths }))
              .catch(error => {
                console.error(`Error finding paths in ${adapter.name}: ${error instanceof Error ? error.message : String(error)}`);
                return { adapter, paths: [] };
              }),
            10000, // 10 second timeout
            { adapter, paths: [] } // Default value on timeout
          )
        );
        
        const adapterPaths = await Promise.all(pathPromises);
        
        // Log path counts
        adapterPaths.forEach(({ adapter, paths }) => {
          console.log(`Found ${paths.length} triangle paths in ${adapter.name}`);
        });
        
        // Test all possible combinations of DEX paths
        for (let i = 0; i < adapterPaths.length; i++) {
          const firstHopAdapter = adapterPaths[i];
          
          // For each path in the first adapter
          for (const firstPath of firstHopAdapter.paths) {
            try {
              // If this is a complete path (3 tokens, 2 hops) in one DEX, simulate it
              if (firstPath.path.length === 3 && firstPath.path[0] === startToken && 
                  firstPath.path[1] === middleToken && firstPath.path[2] === startToken) {
                const finalAmount = await this.timeoutPromise(
                  firstHopAdapter.adapter.simulatePathSwap(
                    firstPath.path,
                    firstPath.pools,
                    amountIn
                  ),
                  5000, // 5 second timeout
                  BigNumber.from(0) // Default value on timeout
                );
                
                // If profitable, add to opportunities
                if (finalAmount.gt(amountIn)) {
                  const profit = finalAmount.sub(amountIn);
                  const profitPercent = profit.mul(10000).div(amountIn).toNumber() / 100;
                  
                  // Get token symbol and price
                  const tokenSymbol = await this.resolveTokenSymbol(startToken);
                  const tokenPrice = await this.priceProvider.getUsdPrice(tokenSymbol);
                  const decimals = 18; // Assuming most tokens use 18 decimals
                  const profitInUsd = parseFloat(profit.toString()) / Math.pow(10, decimals) * tokenPrice;
                  
                  console.log(`Found triangle arbitrage in ${firstHopAdapter.adapter.name}`);
                  console.log(`Profit: ${profit.toString()} ${tokenSymbol} (${profitPercent.toFixed(2)}%, $${profitInUsd.toFixed(2)})`);
                  
                  // Create enhanced opportunity object
                  const opportunity: EnhancedArbitrageOpportunity = {
                    tokenBorrow: startToken,
                    flashLoanAmount: amountIn,
                    expectedProfit: profit,
                    tokenName: tokenSymbol,
                    path: firstPath.path,
                    // Using generic dex indices
                    dexes: Array(firstPath.pools.length).fill(0),
                    fees: [], // Optional, will depend on specific DEX
                    profitInUsd,
                    sourceDex: firstHopAdapter.adapter.name,
                    destinationDex: firstHopAdapter.adapter.name, // Same DEX for triangle
                    pools: firstPath.pools,
                    priceDifferencePercentage: profitPercent,
                    timestamp: Date.now()
                  };
                  
                  opportunities.push(opportunity);
                }
              } 
              // Cross-DEX triangle arbitrage (harder, need to match up paths)
              else if (firstPath.path.length === 2 && firstPath.path[0] === startToken && 
                       firstPath.path[1] === middleToken) {
                // We have the first hop, now find a second hop in other DEXs
                for (let j = 0; j < adapterPaths.length; j++) {
                  const secondHopAdapter = adapterPaths[j];
                  
                  // For each path in the second adapter
                  for (const secondPath of secondHopAdapter.paths) {
                    // If this path completes our triangle
                    if (secondPath.path.length === 2 && secondPath.path[0] === middleToken && 
                        secondPath.path[1] === startToken) {
                      try {
                        // Simulate first hop
                        const middleAmount = await this.timeoutPromise(
                          firstHopAdapter.adapter.getAmountOut(
                            firstPath.pools[0],
                            startToken,
                            middleToken,
                            amountIn
                          ),
                          5000, // 5 second timeout
                          BigNumber.from(0) // Default value on timeout
                        );
                        
                        // Skip if no liquidity or error
                        if (middleAmount.isZero()) continue;
                        
                        // Simulate second hop
                        const finalAmount = await this.timeoutPromise(
                          secondHopAdapter.adapter.getAmountOut(
                            secondPath.pools[0],
                            middleToken,
                            startToken,
                            middleAmount
                          ),
                          5000, // 5 second timeout
                          BigNumber.from(0) // Default value on timeout
                        );
                        
                        // If profitable, add to opportunities
                        if (finalAmount.gt(amountIn)) {
                          const profit = finalAmount.sub(amountIn);
                          const profitPercent = profit.mul(10000).div(amountIn).toNumber() / 100;
                          
                          // Get token symbol and price
                          const tokenSymbol = await this.resolveTokenSymbol(startToken);
                          const tokenPrice = await this.priceProvider.getUsdPrice(tokenSymbol);
                          const decimals = 18; // Assuming most tokens use 18 decimals
                          const profitInUsd = parseFloat(profit.toString()) / Math.pow(10, decimals) * tokenPrice;
                          
                          console.log(`Found cross-DEX triangle arbitrage: ${firstHopAdapter.adapter.name} -> ${secondHopAdapter.adapter.name}`);
                          console.log(`Profit: ${profit.toString()} ${tokenSymbol} (${profitPercent.toFixed(2)}%, $${profitInUsd.toFixed(2)})`);
                          
                          // Create enhanced opportunity object
                          const opportunity: EnhancedArbitrageOpportunity = {
                            tokenBorrow: startToken,
                            flashLoanAmount: amountIn,
                            expectedProfit: profit,
                            tokenName: tokenSymbol,
                            path: [startToken, middleToken, startToken],
                            // Using generic dex indices
                            dexes: [0, 1],
                            fees: [], // Optional, will depend on specific DEX
                            profitInUsd,
                            sourceDex: firstHopAdapter.adapter.name,
                            destinationDex: secondHopAdapter.adapter.name,
                            pools: [firstPath.pools[0], secondPath.pools[0]],
                            priceDifferencePercentage: profitPercent,
                            timestamp: Date.now()
                          };
                          
                          opportunities.push(opportunity);
                        }
                      } catch (error) {
                        console.error(`Error simulating cross-DEX triangle: ${error instanceof Error ? error.message : String(error)}`);
                      }
                    }
                  }
                }
              }
            } catch (error) {
              console.error(`Error processing triangle path: ${error instanceof Error ? error.message : String(error)}`);
            }
          }
        }
      }
      
      console.log(`Found ${opportunities.length} potential triangle arbitrage opportunities`);
      
      // Validate all opportunities in parallel
      const validatedOpportunities = await this.validateArbitrageOpportunities(opportunities);
      
      console.log(`${validatedOpportunities.length} triangle opportunities passed validation`);
      
      return validatedOpportunities;
    } catch (error) {
      console.error(`Error in scanning triangle arbitrage: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  }
  
  /**
   * Validate a list of arbitrage opportunities
   * @param opportunities List of opportunities to validate
   * @returns Array of validated opportunities
   */
  private async validateArbitrageOpportunities(
    opportunities: EnhancedArbitrageOpportunity[]
  ): Promise<EnhancedArbitrageOpportunity[]> {
    if (opportunities.length === 0) {
      return [];
    }
    
    try {
      // Sort opportunities by profit percentage (highest first)
      opportunities.sort((a, b) => b.priceDifferencePercentage - a.priceDifferencePercentage);
      
      // Take top 10 opportunities for validation (can be adjusted)
      const topOpportunities = opportunities.slice(0, 10);
      
      // Validate in parallel
      const validationPromises = topOpportunities.map(async (opportunity) => {
        try {
          // Ensure we have a valid token name
          const tokenName = opportunity.tokenName || 'Unknown';
          const tokenPrice = await this.priceProvider.getUsdPrice(tokenName);
          
          const validationResult: ValidationResult = await this.timeoutPromise(
            this.validator.validate(
              opportunity,
              this.provider,
              500000, // Gas limit estimation
              tokenPrice
            ),
            5000, // 5 second timeout
            { valid: false, reason: 'Validation timed out' } // Default value on timeout
          );
          
          if (validationResult.valid) {
            // Update profit with validated amount if provided
            if (validationResult.adjustedProfit) {
              opportunity.expectedProfit = validationResult.adjustedProfit;
              
              // Recalculate USD profit based on adjusted profit
              const decimals = 18; // Assuming most tokens use 18 decimals
              opportunity.profitInUsd = parseFloat(validationResult.adjustedProfit.toString()) / 
                Math.pow(10, decimals) * tokenPrice;
            }
            
            return { opportunity, isValid: true };
          } else {
            console.log(`Opportunity validation failed: ${validationResult.reason}`);
            return { opportunity, isValid: false };
          }
        } catch (error) {
          console.error(`Error validating opportunity: ${error instanceof Error ? error.message : String(error)}`);
          return { opportunity, isValid: false };
        }
      });
      
      const validationResults = await Promise.all(validationPromises);
      
      // Filter out invalid opportunities
      return validationResults
        .filter(result => result.isValid)
        .map(result => result.opportunity);
    } catch (error) {
      console.error(`Error during opportunity validation: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  }
  
  /**
   * Helper to resolve token symbol from address
   * @param tokenAddress Token address
   * @returns Token symbol
   */
  private async resolveTokenSymbol(tokenAddress: string): Promise<string> {
    // In a real implementation, this would query the token contract
    // For simplicity, we'll use a mapping of common tokens
    const tokenMap: Record<string, string> = {
      '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2': 'WETH',
      '0x6B175474E89094C44Da98b954EedeAC495271d0F': 'DAI',
      '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48': 'USDC',
      '0xdAC17F958D2ee523a2206206994597C13D831ec7': 'USDT',
      '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599': 'WBTC'
    };
    
    // Normalize address
    const normalizedAddress = tokenAddress.toLowerCase();
    
    // Lookup in map
    for (const [address, symbol] of Object.entries(tokenMap)) {
      if (address.toLowerCase() === normalizedAddress) {
        return symbol;
      }
    }
    
    // If not found, return a shortened address
    return `${normalizedAddress.substring(0, 6)}...${normalizedAddress.substring(38)}`;
  }
}
