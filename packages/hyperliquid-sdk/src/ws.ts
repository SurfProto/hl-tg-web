import type { WsMessage, OrderbookLevel, Candle } from '@repo/types';

type WsCallback = (data: WsMessage) => void;

type StatusCallback = (connected: boolean) => void;

export class WebSocketManager {
  private ws: WebSocket | null = null;
  private subscriptions: Map<string, Set<WsCallback>> = new Map();
  private statusListeners: Set<StatusCallback> = new Set();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;
  private isConnecting = false;
  private testnet: boolean;
  // Timestamp when the connection last reached OPEN state; used to detect rapid disconnects
  private connectedAt = 0;
  private readonly MIN_STABLE_DURATION_MS = 2000;

  constructor(testnet: boolean = false) {
    this.testnet = testnet;
  }

  private getWsUrl(): string {
    return this.testnet
      ? 'wss://api.hyperliquid-testnet.xyz/ws'
      : 'wss://api.hyperliquid.xyz/ws';
  }

  connect(): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) {
      return Promise.resolve();
    }

    if (this.isConnecting) {
      return new Promise((resolve, reject) => {
        const deadline = Date.now() + 10_000;
        const checkConnection = setInterval(() => {
          if (this.ws?.readyState === WebSocket.OPEN) {
            clearInterval(checkConnection);
            resolve();
          } else if (Date.now() > deadline) {
            clearInterval(checkConnection);
            reject(new Error('[WS] Timed out waiting for in-progress connection'));
          }
        }, 100);
      });
    }

    this.isConnecting = true;

    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.getWsUrl());

        this.ws.onopen = () => {
          console.log('[WS] Connected');
          this.isConnecting = false;
          this.connectedAt = Date.now();
          this.resubscribeAll();
          this.statusListeners.forEach(cb => cb(true));
          resolve();
        };

        this.ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data) as WsMessage;
            this.handleMessage(data);
          } catch (error) {
            console.error('[WS] Failed to parse message:', error);
          }
        };

        this.ws.onclose = (event) => {
          console.log('[WS] Disconnected:', event.code, event.reason);
          this.isConnecting = false;
          // If the connection dropped within MIN_STABLE_DURATION_MS of opening, don't reset
          // the reconnect counter — this prevents rapid-cycling from burning through all retries.
          const stableDuration = this.connectedAt > 0 ? Date.now() - this.connectedAt : 0;
          if (stableDuration >= this.MIN_STABLE_DURATION_MS) {
            this.reconnectAttempts = 0;
          }
          this.connectedAt = 0;
          this.statusListeners.forEach(cb => cb(false));
          this.handleReconnect();
        };

        this.ws.onerror = (error) => {
          console.error('[WS] Error:', error);
          this.isConnecting = false;
          reject(error);
        };
      } catch (error) {
        this.isConnecting = false;
        reject(error);
      }
    });
  }

  private handleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[WS] Max reconnection attempts reached');
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
    
    console.log(`[WS] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
    
    setTimeout(() => {
      this.connect().catch((error) => {
        console.error('[WS] Reconnection failed:', error);
        // Continue the retry chain so exponential backoff keeps running
        this.handleReconnect();
      });
    }, delay);
  }

  private handleMessage(data: WsMessage): void {
    let channelKey: string = data.channel;

    if (data.channel === 'l2Book') {
      channelKey = `l2Book:${data.data.coin}`;
    } else if (data.channel === 'trades' && data.data.length > 0) {
      channelKey = `trades:${data.data[0].coin}`;
    } else if (data.channel === 'candle') {
      channelKey = `candle:${data.data.s}:${data.data.i}`;
    }

    const callbacks = this.subscriptions.get(channelKey);
    if (callbacks) {
      callbacks.forEach((callback) => {
        try {
          callback(data);
        } catch (error) {
          console.error('[WS] Callback error:', error);
        }
      });
    }
  }

  private resubscribeAll(): void {
    this.subscriptions.forEach((_, channel) => {
      this.sendSubscription(channel);
    });
  }

  private sendSubscription(channel: string): void {
    if (this.ws?.readyState !== WebSocket.OPEN) {
      return;
    }

    // Parse channel to get subscription type and parameters
    const [type, ...params] = channel.split(':');
    
    const subscription: Record<string, unknown> = { type };
    
    if (type === 'l2Book' && params[0]) {
      subscription.coin = params[0];
    } else if (type === 'trades' && params[0]) {
      subscription.coin = params[0];
    } else if (type === 'candle' && params[0] && params[1]) {
      subscription.coin = params[0];
      subscription.interval = params[1];
    }

    this.ws.send(JSON.stringify({
      method: 'subscribe',
      subscription,
    }));
  }

  subscribe(channel: string, callback: WsCallback): () => void {
    if (!this.subscriptions.has(channel)) {
      this.subscriptions.set(channel, new Set());
      this.sendSubscription(channel);
    }

    this.subscriptions.get(channel)!.add(callback);

    // Return unsubscribe function
    return () => {
      const callbacks = this.subscriptions.get(channel);
      if (callbacks) {
        callbacks.delete(callback);
        
        if (callbacks.size === 0) {
          this.subscriptions.delete(channel);
          this.sendUnsubscription(channel);
        }
      }
    };
  }

  private sendUnsubscription(channel: string): void {
    if (this.ws?.readyState !== WebSocket.OPEN) {
      return;
    }

    const [type, ...params] = channel.split(':');
    
    const subscription: Record<string, unknown> = { type };
    
    if (type === 'l2Book' && params[0]) {
      subscription.coin = params[0];
    } else if (type === 'trades' && params[0]) {
      subscription.coin = params[0];
    } else if (type === 'candle' && params[0] && params[1]) {
      subscription.coin = params[0];
      subscription.interval = params[1];
    }

    this.ws.send(JSON.stringify({
      method: 'unsubscribe',
      subscription,
    }));
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.subscriptions.clear();
    this.reconnectAttempts = 0;
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /**
   * Subscribe to connection status changes. Returns an unsubscribe function.
   * The callback is called immediately with the current status, then on every change.
   */
  onStatusChange(cb: StatusCallback): () => void {
    cb(this.isConnected());
    this.statusListeners.add(cb);
    return () => this.statusListeners.delete(cb);
  }
}
