import type { WsMessage } from '@repo/types';

type WsCallback = (data: WsMessage) => void;
type StatusCallback = (connected: boolean) => void;

export class WebSocketManager {
  private ws: WebSocket | null = null;
  private subscriptions: Map<string, Set<WsCallback>> = new Map();
  private statusListeners: Set<StatusCallback> = new Set();
  private reconnectAttempts = 0;
  private reconnectDelay = 1000;
  /** The exponential back-off stops climbing here; retries continue forever. */
  private maxReconnectDelay = 30_000;
  /** The one in-flight connection attempt, shared by every concurrent caller. */
  private pendingConnect: Promise<void> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private testnet: boolean;
  /** Timestamp of the last successful open — used to guard the reconnect counter reset. */
  private connectionOpenedAt: number | null = null;

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

    // Every concurrent caller shares the one in-flight attempt and settles
    // with it. The old path handed late callers a polling interval that could
    // only ever resolve — when the attempt errored instead, they hung forever,
    // their subscriptions never registered, and the interval kept running.
    if (this.pendingConnect) {
      return this.pendingConnect;
    }

    this.pendingConnect = new Promise<void>((resolve, reject) => {
      try {
        const socket = new WebSocket(this.getWsUrl());
        this.ws = socket;

        socket.onopen = () => {
          // A socket that is no longer the current one was abandoned by
          // disconnect(); it must not resubscribe or report the manager online.
          if (this.ws !== socket) return;
          console.log('[WS] Connected');
          this.pendingConnect = null;
          this.connectionOpenedAt = Date.now();
          // The back-off counter is reset in handleReconnect, and only for a
          // connection that lasted. Resetting it here would clear it for a
          // socket that opens and drops immediately, which is the flapping
          // server the back-off is meant to slow down.
          this.startPing();
          this.resubscribeAll();
          this.notifyStatus(true);
          resolve();
        };

        socket.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data) as WsMessage;
            this.handleMessage(data);
          } catch (error) {
            console.error('[WS] Failed to parse message:', error);
          }
        };

        socket.onclose = (event) => {
          console.log('[WS] Disconnected:', event.code, event.reason);
          // disconnect() clears this.ws before closing, so an explicit
          // disconnect lands here with a stale socket and must not reconnect.
          if (this.ws !== socket) return;
          this.pendingConnect = null;
          this.stopPing();
          this.notifyStatus(false);
          this.handleReconnect();
          // A close before open settles the waiters; after open this is a
          // no-op on an already-resolved promise.
          reject(new Error(`WebSocket closed before opening (${event.code})`));
        };

        socket.onerror = (error) => {
          console.error('[WS] Error:', error);
          this.pendingConnect = null;
          reject(error);
        };
      } catch (error) {
        this.pendingConnect = null;
        reject(error);
      }
    });

    return this.pendingConnect;
  }

  /**
   * The exchange culls a connection with no traffic in about a minute. A
   * connection whose subscriptions happen to be quiet — an account with no
   * events, an off-hours market — was dropped and reopened every minute,
   * paying the reconnect churn and a data gap without ever being offline.
   */
  private startPing(): void {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ method: 'ping' }));
      }
    }, 30_000);
  }

  private stopPing(): void {
    if (this.pingTimer !== null) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private handleReconnect(): void {
    // Only reset the counter if the connection was stable for >5s. Anything
    // else — an immediate drop, or a socket that never opened at all because
    // the server is unreachable — keeps the back-off climbing, which is what
    // stops a tight reconnect loop.
    const MIN_STABLE_MS = 5000;
    const wasStable =
      this.connectionOpenedAt !== null &&
      Date.now() - this.connectionOpenedAt >= MIN_STABLE_MS;
    if (wasStable) {
      this.reconnectAttempts = 0;
    }
    this.connectionOpenedAt = null;

    this.reconnectAttempts++;
    // Climb to the cap and keep trying. The old version gave up for good
    // after ten attempts (~17 minutes of backoff), so a phone that lost the
    // network for a while came back to a UI whose socket silently never
    // reconnected until a full reload.
    const delay = Math.min(
      this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1),
      this.maxReconnectDelay,
    );

    console.log(`[WS] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

    setTimeout(() => {
      this.connect().catch((error) => {
        console.error('[WS] Reconnection failed:', error);
      });
    }, delay);
  }

  /**
   * Register a callback that fires whenever the connection status changes.
   * Returns an unsubscribe function.
   */
  onStatusChange(callback: StatusCallback): () => void {
    this.statusListeners.add(callback);
    return () => this.statusListeners.delete(callback);
  }

  private notifyStatus(connected: boolean): void {
    this.statusListeners.forEach((cb) => {
      try { cb(connected); } catch { /* ignore listener errors */ }
    });
  }

  private handleMessage(data: WsMessage): void {
    // userEvents subscriptions are answered on the `user` channel, and the
    // payload does not echo which account it is for — deliver to every
    // userEvents subscriber (one manager serves one account in practice).
    if (data.channel === 'user') {
      this.subscriptions.forEach((callbacks, key) => {
        if (!key.startsWith('userEvents')) return;
        callbacks.forEach((callback) => {
          try {
            callback(data);
          } catch (error) {
            console.error('[WS] Callback error:', error);
          }
        });
      });
      return;
    }

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
    } else if (type === 'userEvents' && params[0]) {
      // The exchange requires the account on this subscription. Sent bare it
      // was rejected, which left the fast balance-refresh path dead and the
      // account connection with zero traffic.
      subscription.user = params[0];
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
    } else if (type === 'userEvents' && params[0]) {
      subscription.user = params[0];
    }

    this.ws.send(JSON.stringify({
      method: 'unsubscribe',
      subscription,
    }));
  }

  disconnect(): void {
    const socket = this.ws;
    // Cleared before close() so the socket's onclose sees a stale reference
    // and skips the reconnect. Status is reported here instead.
    this.ws = null;
    this.subscriptions.clear();
    this.reconnectAttempts = 0;
    this.connectionOpenedAt = null;
    this.pendingConnect = null;
    this.stopPing();

    if (!socket) return;
    const wasOpen = socket.readyState === WebSocket.OPEN;
    socket.close();
    if (wasOpen) {
      this.notifyStatus(false);
    }
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}
