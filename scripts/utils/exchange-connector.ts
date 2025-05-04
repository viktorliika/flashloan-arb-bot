import { ReliableWebSocketClient } from './ws-client';
import { EventEmitter } from 'events';
import axios from 'axios';

/**
 * Types of market data to subscribe to
 */
export enum MarketDataType {
  TICKER,
  ORDERBOOK,
  TRADES,
  CANDLES
}

/**
 * Generic market data interface
 */
export interface MarketData {
  type: MarketDataType;
  exchange: string;
  symbol: string;
  timestamp: number;
  data: any;
}

/**
 * Exchange specific configuration
 */
export interface ExchangeConfig {
  name: string;
  restEndpoint: string;
  wsEndpoint: string;
  apiKey?: string;
  apiSecret?: string;
  extraParams?: Record<string, any>;
}

/**
 * Abstract base class for exchange connection adapters
 */
export abstract class ExchangeAdapter extends EventEmitter {
  protected name: string;
  protected restEndpoint: string;
  protected wsEndpoint: string;
  protected wsClient: ReliableWebSocketClient | null = null;
  protected apiKey?: string;
  protected apiSecret?: string;
  protected extraParams: Record<string, any>;
  protected connected: boolean = false;
  protected subscriptions: Set<string> = new Set();
  
  /**
   * Create a new exchange adapter
   * @param config Exchange configuration
   */
  constructor(config: ExchangeConfig) {
    super();
    this.name = config.name;
    this.restEndpoint = config.restEndpoint;
    this.wsEndpoint = config.wsEndpoint;
    this.apiKey = config.apiKey;
    this.apiSecret = config.apiSecret;
    this.extraParams = config.extraParams || {};
  }
  
  /**
   * Connect to the exchange
   */
  public async connect(): Promise<void> {
    if (this.connected) {
      console.log(`Already connected to ${this.name}`);
      return;
    }
    
    try {
      // Initialize WebSocket connection
      if (this.wsEndpoint) {
        this.wsClient = new ReliableWebSocketClient(this.wsEndpoint);
        this.setupWsHandlers();
        this.wsClient.connect();
      }
      
      // Verify REST API connection
      await this.testRestConnection();
      
      this.connected = true;
      console.log(`Connected to ${this.name} exchange`);
    } catch (error) {
      console.error(`Failed to connect to ${this.name} exchange:`, error);
      throw error;
    }
  }
  
  /**
   * Disconnect from the exchange
   */
  public disconnect(): void {
    if (!this.connected) {
      return;
    }
    
    if (this.wsClient) {
      this.wsClient.disconnect();
      this.wsClient = null;
    }
    
    this.subscriptions.clear();
    this.connected = false;
    console.log(`Disconnected from ${this.name} exchange`);
  }
  
  /**
   * Test REST API connection
   */
  protected async testRestConnection(): Promise<void> {
    try {
      await axios.get(this.getRestEndpoint('/ping') || this.restEndpoint);
    } catch (error) {
      console.error(`REST API connection test failed for ${this.name}:`, error);
      throw error;
    }
  }
  
  /**
   * Set up WebSocket event handlers
   */
  protected setupWsHandlers(): void {
    if (!this.wsClient) return;
    
    this.wsClient.on('connected', () => {
      console.log(`WebSocket connected to ${this.name}`);
      this.resubscribe();
      this.emit('connected');
    });
    
    this.wsClient.on('disconnected', (event) => {
      console.log(`WebSocket disconnected from ${this.name}:`, event);
      this.emit('disconnected');
    });
    
    this.wsClient.on('error', (error) => {
      console.error(`WebSocket error from ${this.name}:`, error);
      this.emit('error', error);
    });
    
    this.wsClient.on('message', (message) => {
      this.handleWsMessage(message);
    });
  }
  
  /**
   * Resubscribe to all active subscriptions
   */
  protected resubscribe(): void {
    for (const topic of this.subscriptions) {
      this.subscribe(topic);
    }
  }
  
  /**
   * Get price for a trading pair
   * @param symbol Trading pair symbol
   */
  public abstract getPrice(symbol: string): Promise<number>;
  
  /**
   * Get orderbook for a trading pair
   * @param symbol Trading pair symbol
   * @param depth Orderbook depth
   */
  public abstract getOrderbook(symbol: string, depth?: number): Promise<any>;
  
  /**
   * Subscribe to market data
   * @param symbol Trading pair symbol
   * @param type Type of market data
   */
  public abstract subscribe(topic: string): void;
  
  /**
   * Unsubscribe from market data
   * @param symbol Trading pair symbol
   * @param type Type of market data
   */
  public abstract unsubscribe(topic: string): void;
  
  /**
   * Handle WebSocket message
   * @param message Message data
   */
  protected abstract handleWsMessage(message: any): void;
  
  /**
   * Get REST endpoint for a specific path
   * @param path API path
   */
  protected abstract getRestEndpoint(path: string): string;
  
  /**
   * Get exchange name
   */
  public getName(): string {
    return this.name;
  }
  
  /**
   * Check if connected to the exchange
   */
  public isConnected(): boolean {
    return this.connected;
  }
}

/**
 * Exchange connector managing multiple exchange connections
 */
export class ExchangeConnector extends EventEmitter {
  private adapters: Map<string, ExchangeAdapter> = new Map();
  
  /**
   * Add an exchange adapter
   * @param adapter Exchange adapter
   */
  public addExchange(adapter: ExchangeAdapter): void {
    const name = adapter.getName();
    
    if (this.adapters.has(name)) {
      console.warn(`Exchange ${name} already added, replacing`);
    }
    
    this.adapters.set(name, adapter);
    
    // Forward events from the adapter
    adapter.on('market_data', (data: MarketData) => {
      this.emit('market_data', data);
    });
    
    adapter.on('error', (error: Error) => {
      this.emit('error', { exchange: name, error });
    });
  }
  
  /**
   * Connect to all exchanges
   */
  public async connectAll(): Promise<void> {
    const promises: Promise<void>[] = [];
    
    for (const adapter of this.adapters.values()) {
      promises.push(adapter.connect());
    }
    
    await Promise.all(promises);
  }
  
  /**
   * Disconnect from all exchanges
   */
  public disconnectAll(): void {
    for (const adapter of this.adapters.values()) {
      adapter.disconnect();
    }
  }
  
  /**
   * Get an exchange adapter by name
   * @param name Exchange name
   */
  public getExchange(name: string): ExchangeAdapter | undefined {
    return this.adapters.get(name);
  }
  
  /**
   * Get all connected exchanges
   */
  public getConnectedExchanges(): string[] {
    return Array.from(this.adapters.values())
      .filter(adapter => adapter.isConnected())
      .map(adapter => adapter.getName());
  }
  
  /**
   * Get price from a specific exchange
   * @param exchange Exchange name
   * @param symbol Trading pair symbol
   */
  public async getPrice(exchange: string, symbol: string): Promise<number> {
    const adapter = this.adapters.get(exchange);
    
    if (!adapter) {
      throw new Error(`Exchange ${exchange} not found`);
    }
    
    if (!adapter.isConnected()) {
      throw new Error(`Exchange ${exchange} not connected`);
    }
    
    return adapter.getPrice(symbol);
  }
  
  /**
   * Get price from all exchanges for a symbol
   * @param symbol Trading pair symbol
   */
  public async getPrices(symbol: string): Promise<Record<string, number>> {
    const result: Record<string, number> = {};
    const promises: Promise<void>[] = [];
    
    for (const [name, adapter] of this.adapters.entries()) {
      if (adapter.isConnected()) {
        const promise = adapter.getPrice(symbol)
          .then(price => {
            result[name] = price;
          })
          .catch(error => {
            console.error(`Failed to get price for ${symbol} from ${name}:`, error);
          });
        
        promises.push(promise);
      }
    }
    
    await Promise.allSettled(promises);
    return result;
  }
  
  /**
   * Get orderbook from a specific exchange
   * @param exchange Exchange name
   * @param symbol Trading pair symbol
   * @param depth Orderbook depth
   */
  public async getOrderbook(exchange: string, symbol: string, depth?: number): Promise<any> {
    const adapter = this.adapters.get(exchange);
    
    if (!adapter) {
      throw new Error(`Exchange ${exchange} not found`);
    }
    
    if (!adapter.isConnected()) {
      throw new Error(`Exchange ${exchange} not connected`);
    }
    
    return adapter.getOrderbook(symbol, depth);
  }
  
  /**
   * Subscribe to market data from a specific exchange
   * @param exchange Exchange name
   * @param symbol Trading pair symbol
   * @param type Type of market data
   */
  public subscribe(exchange: string, topic: string): void {
    const adapter = this.adapters.get(exchange);
    
    if (!adapter) {
      throw new Error(`Exchange ${exchange} not found`);
    }
    
    if (!adapter.isConnected()) {
      throw new Error(`Exchange ${exchange} not connected`);
    }
    
    adapter.subscribe(topic);
  }
  
  /**
   * Subscribe to market data from all exchanges
   * @param symbol Trading pair symbol
   * @param type Type of market data
   */
  public subscribeAll(topic: string): void {
    for (const adapter of this.adapters.values()) {
      if (adapter.isConnected()) {
        adapter.subscribe(topic);
      }
    }
  }
}
