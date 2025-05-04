import fs from 'fs';
import path from 'path';
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { HardhatEthersHelpers } from "@nomiclabs/hardhat-ethers/types";

// This is a workaround for accessing ethers from hardhat
declare global {
  interface HardhatRuntimeEnvironment {
    ethers: HardhatEthersHelpers;
  }
}

// Import hardhat runtime
const hre = require("hardhat");
const ethers = hre.ethers;

/**
 * Loads configuration from the centralized pools.json file
 */
export class ConfigLoader {
  private config: any;
  private network: string;

  /**
   * Initialize the config loader
   * @param network Network name to load config for
   */
  constructor(network: string = '') {
    this.network = network || this.detectNetwork();
    this.loadConfig();
  }

  /**
   * Load the configuration file
   */
  private loadConfig() {
    try {
      const configPath = path.join(__dirname, '../../config/pools.json');
      const configData = fs.readFileSync(configPath, 'utf8');
      const allConfig = JSON.parse(configData);
      
      // Get config for the current network or default to mainnet
      this.config = allConfig[this.network] || allConfig['mainnet'];
      
      if (!this.config) {
        throw new Error(`No configuration found for network: ${this.network}`);
      }
    } catch (error) {
      console.error(`Error loading configuration: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  /**
   * Detect the current network from hardhat
   */
  private detectNetwork(): string {
    try {
      const chainId = ethers.provider.network.chainId;
      
      // Map chain IDs to network names
      if (chainId === 1) return 'mainnet';
      if (chainId === 31337) return 'localhost';
      if (chainId === 5) return 'goerli';
      
      // Default to localhost for development
      return 'localhost';
    } catch (error) {
      console.warn(`Could not detect network, defaulting to mainnet: ${error instanceof Error ? error.message : String(error)}`);
      return 'mainnet';
    }
  }

  /**
   * Get token address by symbol
   * @param symbol Token symbol (e.g., "WETH")
   * @returns Token address
   */
  public getTokenAddress(symbol: string): string {
    const token = this.config.tokens[symbol];
    if (!token || !token.address) {
      throw new Error(`Token not found or address not set: ${symbol}`);
    }
    return token.address;
  }

  /**
   * Get all token addresses
   * @returns Object with token symbols as keys and addresses as values
   */
  public getAllTokenAddresses(): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [symbol, token] of Object.entries(this.config.tokens)) {
      if ((token as any).address) {
        result[symbol] = (token as any).address;
      }
    }
    return result;
  }

  /**
   * Get DEX router address
   * @param dexName The name of the DEX (e.g., "uniswapV2")
   * @returns Router address
   */
  public getDexRouter(dexName: string): string {
    const dex = this.config.dexes[dexName];
    if (!dex) {
      throw new Error(`DEX not found: ${dexName}`);
    }
    
    // Different DEXes have different properties
    if (dex.type === 'v2' || dex.type === 'v3') {
      return dex.router;
    } else if (dex.type === 'curve') {
      return dex.router;
    } else if (dex.type === 'balancer') {
      return dex.vault;
    }
    
    throw new Error(`Unsupported DEX type: ${dex.type}`);
  }

  /**
   * Get pools for a token pair
   * @param tokenA First token symbol
   * @param tokenB Second token symbol
   * @returns Array of pools for the token pair
   */
  public getPools(tokenA: string, tokenB: string): any {
    // Try both orders since the config might have them in either order
    let pair = this.config.pools.direct.find(
      (p: any) => (p.tokenA === tokenA && p.tokenB === tokenB) || 
                 (p.tokenA === tokenB && p.tokenB === tokenA)
    );
    
    if (!pair) {
      throw new Error(`No pools found for pair: ${tokenA}-${tokenB}`);
    }
    
    return pair;
  }

  /**
   * Get triangle arbitrage configuration
   * @returns Triangle arbitrage configuration
   */
  public getTriangleConfig(): any {
    return this.config.pools.triangle;
  }

  /**
   * Get flash loan provider configuration
   * @param provider Provider name (e.g., "aave")
   * @returns Flash loan provider configuration
   */
  public getFlashLoanProvider(provider: string = 'aave'): any {
    return this.config.flashLoanProviders[provider];
  }

  /**
   * Get general configuration settings
   * @returns General configuration
   */
  public getGeneralConfig(): any {
    return this.config.config;
  }
}
