import WebSocket from 'ws';
import { EventEmitter } from 'events';

/**
 * WebSocket client with automatic reconnection
 */
export class ReliableWebSocketClient extends EventEmitter {
  private url: string;
  private ws: WebSocket | null = null;
  private reconnectInterval: number;
  private maxReconnectAttempts: number;
  private reconnectAttempts: number = 0;
  private autoReconnect: boolean = true;
  private pingInterval: NodeJS.Timeout | null = null;
  private pongTimeout: NodeJS.Timeout | null = null;
  private connectTimeout: NodeJS.Timeout | null = null;
  private subscriptions: string[] = [];
  
  /**
   * Create a new WebSocket client
   * @param url WebSocket URL to connect to
   * @param reconnectInterval Time in ms to wait between reconnect attempts
   * @param maxReconnectAttempts Maximum number of reconnect attempts (0 = unlimited)
   */
  constructor(url: string, reconnectInterval = 5000, maxReconnectAttempts = 0) {
    super();
    this.url = url;
    this.reconnectInterval = reconnectInterval;
    this.maxReconnectAttempts = maxReconnectAttempts;
  }
  
  /**
   * Connect to the WebSocket server
   */
  public connect(): void {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      console.log('WebSocket already connected or connecting');
      return;
    }
    
    // Clear any existing timeouts
    this.clearTimeouts();
    
    // Set a connection timeout
    this.connectTimeout = setTimeout(() => {
      if (this.ws && this.ws.readyState !== WebSocket.OPEN) {
        console.log('WebSocket connection timeout, closing socket');
        this.ws.terminate();
        this.reconnect();
      }
    }, 10000); // 10 seconds connection timeout
    
    console.log(`Connecting to WebSocket: ${this.url}`);
    this.ws = new WebSocket(this.url);
    
    this.ws.on('open', this.handleOpen.bind(this));
    this.ws.on('message', this.handleMessage.bind(this));
    this.ws.on('error', this.handleError.bind(this));
    this.ws.on('close', this.handleClose.bind(this));
    this.ws.on('pong', this.handlePong.bind(this));
  }
  
  /**
   * Disconnect from the WebSocket server
   */
  public disconnect(): void {
    this.autoReconnect = false;
    this.clearTimeouts();
    
    if (this.ws) {
      console.log('Disconnecting WebSocket');
      this.ws.terminate();
      this.ws = null;
    }
  }
  
  /**
   * Send data to the WebSocket server
   * @param data Data to send
   */
  public send(data: string | Buffer): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(data);
    } else {
      console.warn('WebSocket not connected, cannot send message');
      this.reconnect();
    }
  }
  
  /**
   * Subscribe to a topic
   * @param topic Topic to subscribe to
   */
  public subscribe(topic: string): void {
    if (!this.subscriptions.includes(topic)) {
      this.subscriptions.push(topic);
    }
    
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.send(JSON.stringify({ 
        type: 'subscribe', 
        topic 
      }));
    }
  }
  
  /**
   * Unsubscribe from a topic
   * @param topic Topic to unsubscribe from
   */
  public unsubscribe(topic: string): void {
    this.subscriptions = this.subscriptions.filter(t => t !== topic);
    
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.send(JSON.stringify({ 
        type: 'unsubscribe', 
        topic 
      }));
    }
  }
  
  /**
   * Handle WebSocket open event
   */
  private handleOpen(): void {
    console.log('WebSocket connected');
    this.reconnectAttempts = 0;
    
    // Clear connection timeout
    if (this.connectTimeout) {
      clearTimeout(this.connectTimeout);
      this.connectTimeout = null;
    }
    
    // Set up ping interval
    this.pingInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        // Start pong timeout
        this.pongTimeout = setTimeout(() => {
          console.log('WebSocket ping timeout, reconnecting');
          this.reconnect();
        }, 5000); // 5 seconds pong timeout
        
        // Send ping
        this.ws.ping();
      }
    }, 30000); // 30 seconds ping interval
    
    // Resubscribe to all topics
    this.subscriptions.forEach(topic => {
      this.subscribe(topic);
    });
    
    this.emit('connected');
  }
  
  /**
   * Handle WebSocket message event
   * @param data Message data
   */
  private handleMessage(data: WebSocket.Data): void {
    try {
      let message;
      
      if (typeof data === 'string') {
        message = JSON.parse(data);
      } else if (data instanceof Buffer) {
        message = JSON.parse(data.toString('utf8'));
      } else {
        console.warn('Received message in unsupported format:', typeof data);
        return;
      }
      
      this.emit('message', message);
    } catch (error) {
      console.error('Error parsing WebSocket message:', error);
      console.error('Raw message:', data);
    }
  }
  
  /**
   * Handle WebSocket error event
   * @param error Error object
   */
  private handleError(error: Error): void {
    console.error('WebSocket error:', error.message);
    this.emit('error', error);
  }
  
  /**
   * Handle WebSocket close event
   * @param code Close code
   * @param reason Close reason
   */
  private handleClose(code: number, reason: string): void {
    console.log(`WebSocket closed: ${code} - ${reason}`);
    this.clearTimeouts();
    
    if (this.autoReconnect) {
      this.reconnect();
    }
    
    this.emit('disconnected', { code, reason });
  }
  
  /**
   * Handle WebSocket pong event
   */
  private handlePong(): void {
    // Clear pong timeout
    if (this.pongTimeout) {
      clearTimeout(this.pongTimeout);
      this.pongTimeout = null;
    }
  }
  
  /**
   * Reconnect to the WebSocket server
   */
  private reconnect(): void {
    if (!this.autoReconnect) return;
    
    this.reconnectAttempts++;
    
    if (this.maxReconnectAttempts > 0 && this.reconnectAttempts > this.maxReconnectAttempts) {
      console.error(`Maximum reconnect attempts (${this.maxReconnectAttempts}) reached, giving up`);
      this.emit('reconnect_failed');
      return;
    }
    
    // Clear any existing timeouts
    this.clearTimeouts();
    
    // Close existing socket
    if (this.ws) {
      this.ws.terminate();
      this.ws = null;
    }
    
    // Exponential backoff
    const delay = Math.min(this.reconnectInterval * Math.pow(1.5, this.reconnectAttempts - 1), 60000);
    
    console.log(`Reconnecting to WebSocket in ${Math.round(delay / 1000)} seconds (attempt ${this.reconnectAttempts})`);
    
    setTimeout(() => {
      this.connect();
    }, delay);
    
    this.emit('reconnecting', { attempts: this.reconnectAttempts });
  }
  
  /**
   * Clear all timeouts
   */
  private clearTimeouts(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    
    if (this.pongTimeout) {
      clearTimeout(this.pongTimeout);
      this.pongTimeout = null;
    }
    
    if (this.connectTimeout) {
      clearTimeout(this.connectTimeout);
      this.connectTimeout = null;
    }
  }
}
