import { BigNumber } from 'ethers';
import * as https from 'https';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Interface for token price providers
 */
export interface PriceProvider {
  getUsdPrice(tokenId: string): Promise<number>;
  getPrices(tokenIds: string[]): Promise<Map<string, number>>;
}

/**
 * Helper function to make HTTPS requests without external dependencies
 */
function httpsRequest(url: string): Promise<any> {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      const { statusCode } = res;
      const contentType = res.headers['content-type'] || '';
      
      let error;
      if (statusCode !== 200) {
        error = new Error(`Request failed with status code: ${statusCode}`);
      } else if (!/^application\/json/.test(contentType)) {
        error = new Error(`Invalid content-type: expected application/json but received ${contentType}`);
      }
      
      if (error) {
        res.resume(); // Consume response to free up memory
        reject(error);
        return;
      }
      
      res.setEncoding('utf8');
      let rawData = '';
      
      res.on('data', (chunk) => { rawData += chunk; });
      res.on('end', () => {
        try {
          const parsedData = JSON.parse(rawData);
          resolve(parsedData);
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', (e) => {
      reject(e);
    });
  });
}

/**
 * Token price cache to reduce API calls
 */
export class PriceCache {
  private cache: Map<string, { price: number, timestamp: number }> = new Map();
  private readonly cacheDuration: number; // in milliseconds
  
  /**
   * Create a new price cache
   * @param cacheDurationMinutes Cache duration in minutes (default 5)
   */
  constructor(cacheDurationMinutes: number = 5) {
    this.cacheDuration = cacheDurationMinutes * 60 * 1000;
    this.loadCache();
  }
  
  /**
   * Get price from cache if available and not expired
   * @param tokenId Token ID
   * @returns Cached price or null if not available
   */
  get(tokenId: string): number | null {
    const cacheEntry = this.cache.get(tokenId);
    if (!cacheEntry) return null;
    
    const now = Date.now();
    if (now - cacheEntry.timestamp > this.cacheDuration) {
      // Cache expired
      return null;
    }
    
    return cacheEntry.price;
  }
  
  /**
   * Set price in cache
   * @param tokenId Token ID
   * @param price Token price
   */
  set(tokenId: string, price: number): void {
    this.cache.set(tokenId, {
      price,
      timestamp: Date.now()
    });
    this.saveCache();
  }
  
  /**
   * Save cache to file
   */
  private saveCache(): void {
    const cacheData: Record<string, { price: number, timestamp: number }> = {};
    
    this.cache.forEach((value, key) => {
      cacheData[key] = value;
    });
    
    try {
      const cacheDir = path.join(__dirname, '../../data');
      if (!fs.existsSync(cacheDir)) {
        fs.mkdirSync(cacheDir, { recursive: true });
      }
      
      fs.writeFileSync(
        path.join(cacheDir, 'price-cache.json'),
        JSON.stringify(cacheData),
        'utf8'
      );
    } catch (error) {
      console.warn('Failed to save price cache:', error);
    }
  }
  
  /**
   * Load cache from file
   */
  private loadCache(): void {
    try {
      const cacheFile = path.join(__dirname, '../../data/price-cache.json');
      
      if (fs.existsSync(cacheFile)) {
        const cacheData = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
        
        for (const [tokenId, value] of Object.entries(cacheData)) {
          const entry = value as { price: number, timestamp: number };
          this.cache.set(tokenId, entry);
        }
        
        console.log(`Loaded ${this.cache.size} entries from price cache`);
      }
    } catch (error) {
      console.warn('Failed to load price cache:', error);
    }
  }
}

/**
 * CoinGecko price provider implementation
 */
export class CoinGeckoPriceProvider implements PriceProvider {
  private cache: PriceCache;
  private apiKey: string | null;
  
  // Token symbol to CoinGecko ID mapping
  private static readonly TOKEN_ID_MAP: Record<string, string> = {
    'WETH': 'ethereum',
    'ETH': 'ethereum',
    'DAI': 'dai',
    'USDC': 'usd-coin',
    'USDT': 'tether',
    'WBTC': 'wrapped-bitcoin',
    'BTC': 'bitcoin',
    'UNI': 'uniswap',
    'LINK': 'chainlink',
    'AAVE': 'aave',
    'COMP': 'compound-governance-token',
    'SNX': 'synthetix-network-token',
    'CRV': 'curve-dao-token',
    'MKR': 'maker'
  };
  
  /**
   * Create a new CoinGecko price provider
   * @param apiKey Optional CoinGecko API key for higher rate limits
   * @param cacheDurationMinutes Cache duration in minutes
   */
  constructor(apiKey: string | null = null, cacheDurationMinutes: number = 5) {
    this.cache = new PriceCache(cacheDurationMinutes);
    this.apiKey = apiKey;
  }
  
  /**
   * Get USD price for a token
   * @param tokenSymbol Token symbol (ETH, DAI, USDC, etc.)
   * @returns USD price
   */
  async getUsdPrice(tokenSymbol: string): Promise<number> {
    const tokenId = this.getTokenId(tokenSymbol);
    
    // Check cache first
    const cachedPrice = this.cache.get(tokenId);
    if (cachedPrice !== null) {
      return cachedPrice;
    }
    
    // Fetch from API
    try {
      let apiUrl = `https://api.coingecko.com/api/v3/simple/price?ids=${tokenId}&vs_currencies=usd`;
      
      if (this.apiKey) {
        apiUrl += `&x_cg_pro_api_key=${this.apiKey}`;
      }
      
      const data = await httpsRequest(apiUrl) as Record<string, { usd: number }>;
      
      if (!data[tokenId]) {
        throw new Error(`Price not found for token ID: ${tokenId}`);
      }
      
      const price = data[tokenId].usd;
      
      // Cache the result
      this.cache.set(tokenId, price);
      
      return price;
    } catch (error) {
      console.error(`Error fetching price for ${tokenSymbol}:`, error);
      
      // Use default fallbacks if API fails
      if (tokenSymbol === 'ETH' || tokenSymbol === 'WETH') {
        return 3000; // Fallback ETH price
      } else if (tokenSymbol === 'BTC' || tokenSymbol === 'WBTC') {
        return 50000; // Fallback BTC price
      } else if (tokenSymbol === 'DAI' || tokenSymbol === 'USDC' || tokenSymbol === 'USDT') {
        return 1; // Stablecoins default to 1 USD
      }
      
      throw error; // Re-throw if no fallback
    }
  }
  
  /**
   * Get prices for multiple tokens in a single request
   * @param tokenSymbols Array of token symbols
   * @returns Map of token symbols to prices
   */
  async getPrices(tokenSymbols: string[]): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    const tokensToFetch: string[] = [];
    
    // Check cache first
    for (const symbol of tokenSymbols) {
      const tokenId = this.getTokenId(symbol);
      const cachedPrice = this.cache.get(tokenId);
      
      if (cachedPrice !== null) {
        result.set(symbol, cachedPrice);
      } else {
        tokensToFetch.push(symbol);
      }
    }
    
    // If all prices were in cache, return immediately
    if (tokensToFetch.length === 0) {
      return result;
    }
    
    // Fetch remaining prices
    const tokenIds = tokensToFetch.map(symbol => this.getTokenId(symbol));
    
    try {
      let apiUrl = `https://api.coingecko.com/api/v3/simple/price?ids=${tokenIds.join(',')}&vs_currencies=usd`;
      
      if (this.apiKey) {
        apiUrl += `&x_cg_pro_api_key=${this.apiKey}`;
      }
      
      const data = await httpsRequest(apiUrl) as Record<string, { usd: number }>;
      
      // Process results and update cache
      for (let i = 0; i < tokensToFetch.length; i++) {
        const symbol = tokensToFetch[i];
        const tokenId = tokenIds[i];
        
        if (data[tokenId]) {
          const price = data[tokenId].usd;
          result.set(symbol, price);
          this.cache.set(tokenId, price);
        } else {
          // Use fallbacks if needed
          if (symbol === 'ETH' || symbol === 'WETH') {
            result.set(symbol, 3000);
          } else if (symbol === 'BTC' || symbol === 'WBTC') {
            result.set(symbol, 50000);
          } else if (symbol === 'DAI' || symbol === 'USDC' || symbol === 'USDT') {
            result.set(symbol, 1);
          } else {
            console.warn(`Price not found for token: ${symbol} (ID: ${tokenId})`);
          }
        }
      }
    } catch (error) {
      console.error('Error fetching prices:', error);
      
      // Use fallbacks for all remaining tokens
      for (const symbol of tokensToFetch) {
        if (!result.has(symbol)) {
          if (symbol === 'ETH' || symbol === 'WETH') {
            result.set(symbol, 3000);
          } else if (symbol === 'BTC' || symbol === 'WBTC') {
            result.set(symbol, 50000);
          } else if (symbol === 'DAI' || symbol === 'USDC' || symbol === 'USDT') {
            result.set(symbol, 1);
          }
        }
      }
    }
    
    return result;
  }
  
  /**
   * Convert token symbol to CoinGecko ID
   * @param tokenSymbol Token symbol
   * @returns CoinGecko token ID
   */
  private getTokenId(tokenSymbol: string): string {
    const upperSymbol = tokenSymbol.toUpperCase();
    
    if (upperSymbol in CoinGeckoPriceProvider.TOKEN_ID_MAP) {
      return CoinGeckoPriceProvider.TOKEN_ID_MAP[upperSymbol];
    }
    
    // For unknown tokens, convert to lowercase and remove spaces
    // This is a best-effort approach that might work for some tokens
    return tokenSymbol.toLowerCase().replace(/\s+/g, '-');
  }
}

/**
 * Helper function to convert token amount to USD value
 * @param amount Token amount as BigNumber
 * @param decimals Token decimals
 * @param price Token price in USD
 * @returns USD value
 */
export function tokenAmountToUsd(amount: BigNumber, decimals: number, price: number): number {
  const amountStr = amount.toString();
  const decimalDivider = Math.pow(10, decimals);
  return parseFloat(amountStr) / decimalDivider * price;
}

/**
 * Helper function to convert USD amount to token units
 * @param usdAmount USD amount
 * @param decimals Token decimals
 * @param price Token price in USD
 * @returns Token amount as BigNumber
 */
export function usdToTokenAmount(usdAmount: number, decimals: number, price: number): BigNumber {
  const tokenAmount = (usdAmount / price) * Math.pow(10, decimals);
  return BigNumber.from(Math.floor(tokenAmount).toString());
}
