import type { WsMessage, OrderbookLevel, Candle } from '@repo/types';

type WsCallback = (data: WsMessage) => void;

export class WebSocketManager {
  private ws: WebSocket | null = null;
  private subscriptions: Map<string, Set<WsCallback>> = new Map();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;
  private isConnecting = false;
  private testnet: boolean;

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
      return new Promise((resolve) => {
        const checkConnection = setInterval(() => {
          if (this.ws?.readyState === WebSocket.OPEN) {
            clearInterval(checkConnection);
            resolve();
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
          this.reconnectAttempts = 0;
          this.resubscribeAll();
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
      });
    }, delay);
  }

  private handleMessage(data: WsMessage): void {
    const channel = data.channel;
    const callbacks = this.subscriptions.get(channel);
    
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
}
