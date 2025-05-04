import { ExchangeAdapter, ExchangeConfig, MarketData, MarketDataType } from '../exchange-connector';
import axios from 'axios';
import crypto from 'crypto';

/**
 * Binance-specific configuration
 */
export interface BinanceConfig extends ExchangeConfig {
  useTestnet?: boolean;
}

/**
 * Binance exchange adapter
 */
export class BinanceAdapter extends ExchangeAdapter {
  private useTestnet: boolean;
  
  /**
   * Create a new Binance adapter
   * @param config Binance configuration
   */
  constructor(config: BinanceConfig) {
    // Set appropriate endpoints based on testnet flag
    const useTestnet = config.useTestnet || false;
    
    const restEndpoint = useTestnet 
      ? 'https://testnet.binance.vision/api' 
      : 'https://api.binance.com/api';
      
    const wsEndpoint = useTestnet
      ? 'wss://testnet.binance.vision/ws'
      : 'wss://stream.binance.com:9443/ws';
    
    super({
      ...config,
      restEndpoint,
      wsEndpoint
    });
    
    this.useTestnet = useTestnet;
  }
  
  /**
   * Get price for a trading pair
   * @param symbol Trading pair symbol (e.g., "BTCUSDT")
   */
  public async getPrice(symbol: string): Promise<number> {
    try {
      const endpoint = this.getRestEndpoint('/v3/ticker/price');
      const response = await axios.get(endpoint, {
        params: { symbol }
      });
      
      return parseFloat(response.data.price);
    } catch (error) {
      console.error(`Failed to get ${symbol} price from Binance:`, error);
      throw error;
    }
  }
  
  /**
   * Get orderbook for a trading pair
   * @param symbol Trading pair symbol (e.g., "BTCUSDT")
   * @param limit Orderbook depth (default: 100, max: 5000)
   */
  public async getOrderbook(symbol: string, depth: number = 100): Promise<any> {
    try {
      const endpoint = this.getRestEndpoint('/v3/depth');
      const response = await axios.get(endpoint, {
        params: { 
          symbol, 
          limit: Math.min(Math.max(depth, 5), 5000) // Clamp between 5 and 5000
        }
      });
      
      return {
        lastUpdateId: response.data.lastUpdateId,
        bids: response.data.bids.map((bid: string[]) => ({ price: parseFloat(bid[0]), quantity: parseFloat(bid[1]) })),
        asks: response.data.asks.map((ask: string[]) => ({ price: parseFloat(ask[0]), quantity: parseFloat(ask[1]) }))
      };
    } catch (error) {
      console.error(`Failed to get ${symbol} orderbook from Binance:`, error);
      throw error;
    }
  }
  
  /**
   * Subscribe to a WebSocket topic
   * @param topic Topic to subscribe to (e.g., "btcusdt@ticker")
   */
  public subscribe(topic: string): void {
    if (!this.wsClient) {
      console.warn('WebSocket not connected, cannot subscribe to', topic);
      return;
    }
    
    this.subscriptions.add(topic);
    
    // For single subscriptions, just send the subscription message
    if (this.subscriptions.size === 1) {
      this.wsClient.send(JSON.stringify({
        method: 'SUBSCRIBE',
        params: [topic],
        id: Date.now()
      }));
    } else {
      // For multiple subscriptions, resubscribe to all
      this.wsClient.send(JSON.stringify({
        method: 'SUBSCRIBE',
        params: Array.from(this.subscriptions),
        id: Date.now()
      }));
    }
  }
  
  /**
   * Unsubscribe from a WebSocket topic
   * @param topic Topic to unsubscribe from (e.g., "btcusdt@ticker")
   */
  public unsubscribe(topic: string): void {
    if (!this.wsClient) {
      return;
    }
    
    if (this.subscriptions.has(topic)) {
      this.subscriptions.delete(topic);
      
      this.wsClient.send(JSON.stringify({
        method: 'UNSUBSCRIBE',
        params: [topic],
        id: Date.now()
      }));
    }
  }
  
  /**
   * Handle WebSocket message
   * @param message Message data
   */
  protected handleWsMessage(message: any): void {
    // Ignore non-data messages (like subscription responses)
    if (message.id || message.result !== undefined) {
      return;
    }
    
    try {
      // Determine the stream type from the event
      if (message.e === 'trade') {
        // Trade stream
        this.handleTradeMessage(message);
      } else if (message.e === 'ticker') {
        // Ticker stream
        this.handleTickerMessage(message);
      } else if (message.e === 'depthUpdate') {
        // Orderbook stream
        this.handleOrderbookMessage(message);
      } else if (message.e === 'kline') {
        // Kline stream
        this.handleKlineMessage(message);
      }
    } catch (error) {
      console.error('Error handling Binance WebSocket message:', error);
      console.error('Raw message:', message);
    }
  }
  
  /**
   * Handle trade message
   * @param message Trade message
   */
  private handleTradeMessage(message: any): void {
    const data: MarketData = {
      type: MarketDataType.TRADES,
      exchange: this.name,
      symbol: message.s,
      timestamp: message.T,
      data: {
        id: message.t,
        price: parseFloat(message.p),
        quantity: parseFloat(message.q),
        time: message.T,
        isBuyerMaker: message.m,
        isBestMatch: message.M
      }
    };
    
    this.emit('market_data', data);
  }
  
  /**
   * Handle ticker message
   * @param message Ticker message
   */
  private handleTickerMessage(message: any): void {
    const data: MarketData = {
      type: MarketDataType.TICKER,
      exchange: this.name,
      symbol: message.s,
      timestamp: message.E,
      data: {
        priceChange: parseFloat(message.p),
        priceChangePercent: parseFloat(message.P),
        weightedAvgPrice: parseFloat(message.w),
        lastPrice: parseFloat(message.c),
        lastQty: parseFloat(message.Q),
        bidPrice: parseFloat(message.b),
        bidQty: parseFloat(message.B),
        askPrice: parseFloat(message.a),
        askQty: parseFloat(message.A),
        openPrice: parseFloat(message.o),
        highPrice: parseFloat(message.h),
        lowPrice: parseFloat(message.l),
        volume: parseFloat(message.v),
        quoteVolume: parseFloat(message.q),
        openTime: message.O,
        closeTime: message.C,
        firstId: message.F,
        lastId: message.L,
        count: message.n
      }
    };
    
    this.emit('market_data', data);
  }
  
  /**
   * Handle orderbook message
   * @param message Orderbook message
   */
  private handleOrderbookMessage(message: any): void {
    const data: MarketData = {
      type: MarketDataType.ORDERBOOK,
      exchange: this.name,
      symbol: message.s,
      timestamp: message.E,
      data: {
        eventTime: message.E,
        firstUpdateId: message.U,
        finalUpdateId: message.u,
        bids: message.b.map((bid: string[]) => ({ price: parseFloat(bid[0]), quantity: parseFloat(bid[1]) })),
        asks: message.a.map((ask: string[]) => ({ price: parseFloat(ask[0]), quantity: parseFloat(ask[1]) }))
      }
    };
    
    this.emit('market_data', data);
  }
  
  /**
   * Handle kline message
   * @param message Kline message
   */
  private handleKlineMessage(message: any): void {
    const kline = message.k;
    
    const data: MarketData = {
      type: MarketDataType.CANDLES,
      exchange: this.name,
      symbol: message.s,
      timestamp: message.E,
      data: {
        openTime: kline.t,
        closeTime: kline.T,
        symbol: kline.s,
        interval: kline.i,
        firstTradeId: kline.f,
        lastTradeId: kline.L,
        open: parseFloat(kline.o),
        close: parseFloat(kline.c),
        high: parseFloat(kline.h),
        low: parseFloat(kline.l),
        volume: parseFloat(kline.v),
        trades: kline.n,
        final: kline.x,
        quoteVolume: parseFloat(kline.q),
        volumeActive: parseFloat(kline.V),
        quoteVolumeActive: parseFloat(kline.Q)
      }
    };
    
    this.emit('market_data', data);
  }
  
  /**
   * Get REST endpoint for a specific path
   * @param path API path
   */
  protected getRestEndpoint(path: string): string {
    return `${this.restEndpoint}${path}`;
  }
  
  /**
   * Create a signed request for private API endpoints
   * @param endpoint API endpoint
   * @param params Request parameters
   */
  private createSignedRequest(endpoint: string, params: Record<string, any> = {}): Record<string, any> {
    if (!this.apiKey || !this.apiSecret) {
      throw new Error('API key and secret required for authenticated requests');
    }
    
    // Add timestamp
    const timestamp = Date.now();
    params.timestamp = timestamp;
    
    // Create query string
    const queryString = Object.entries(params)
      .sort(([keyA], [keyB]) => keyA.localeCompare(keyB))
      .map(([key, value]) => `${key}=${value}`)
      .join('&');
    
    // Create signature
    const signature = crypto
      .createHmac('sha256', this.apiSecret)
      .update(queryString)
      .digest('hex');
    
    // Add signature to params
    params.signature = signature;
    
    return params;
  }
  
  /**
   * Make a signed API request
   * @param method HTTP method
   * @param endpoint API endpoint
   * @param params Request parameters
   */
  private async makeSignedRequest(
    method: 'GET' | 'POST' | 'DELETE',
    endpoint: string,
    params: Record<string, any> = {}
  ): Promise<any> {
    if (!this.apiKey) {
      throw new Error('API key required for authenticated requests');
    }
    
    const signedParams = this.createSignedRequest(endpoint, params);
    const headers = { 'X-MBX-APIKEY': this.apiKey };
    
    try {
      let response;
      
      if (method === 'GET') {
        response = await axios.get(this.getRestEndpoint(endpoint), {
          headers,
          params: signedParams
        });
      } else if (method === 'POST') {
        response = await axios.post(this.getRestEndpoint(endpoint), null, {
          headers,
          params: signedParams
        });
      } else if (method === 'DELETE') {
        response = await axios.delete(this.getRestEndpoint(endpoint), {
          headers,
          params: signedParams
        });
      }
      
      return response?.data;
    } catch (error) {
      console.error(`Error making signed ${method} request to ${endpoint}:`, error);
      throw error;
    }
  }
}
