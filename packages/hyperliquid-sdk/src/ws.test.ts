import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Candle, WsMessage } from "@repo/types";

import { WebSocketManager } from "./ws";

// The SDK tests run in the node environment. WebSocketManager reads the bare
// WebSocket global and its OPEN constant, so a stub goes on globalThis and the
// tests drive open/close/message by hand.
class FakeSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: FakeSocket[] = [];

  readyState: number = FakeSocket.CONNECTING;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  onerror: ((error: unknown) => void) | null = null;

  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = FakeSocket.CLOSED;
    this.onclose?.({ code: 1000, reason: "client" });
  }

  /** Server accepted the connection. */
  open(): void {
    this.readyState = FakeSocket.OPEN;
    this.onopen?.();
  }

  /** Connection dropped by the server or the network. */
  drop(code = 1006): void {
    this.readyState = FakeSocket.CLOSED;
    this.onclose?.({ code, reason: "dropped" });
  }

  emit(message: WsMessage): void {
    this.onmessage?.({ data: JSON.stringify(message) });
  }

  emitRaw(data: string): void {
    this.onmessage?.({ data });
  }

  fail(error: unknown): void {
    this.onerror?.(error);
  }

  frames(): Array<Record<string, unknown>> {
    return this.sent.map((frame) => JSON.parse(frame));
  }
}

function sockets(): FakeSocket[] {
  return FakeSocket.instances;
}

function latest(): FakeSocket {
  const socket = FakeSocket.instances.at(-1);
  if (!socket) throw new Error("no socket was created");
  return socket;
}

/** Connect and complete the handshake, as the happy path always does. */
async function connected(manager: WebSocketManager) {
  const promise = manager.connect();
  latest().open();
  await promise;
  return latest();
}

function candle(overrides: Partial<Candle> = {}): Candle {
  return {
    t: 0,
    T: 60_000,
    s: "BTC",
    i: "1m",
    o: 1,
    h: 2,
    l: 0.5,
    c: 1.5,
    v: 10,
    n: 3,
    ...overrides,
  };
}

beforeEach(() => {
  FakeSocket.instances = [];
  Object.defineProperty(globalThis, "WebSocket", {
    value: FakeSocket,
    configurable: true,
    writable: true,
  });
  vi.useFakeTimers();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  Reflect.deleteProperty(globalThis, "WebSocket");
});

describe("connect", () => {
  it("targets mainnet by default and testnet when asked", async () => {
    await connected(new WebSocketManager());
    expect(latest().url).toBe("wss://api.hyperliquid.xyz/ws");

    await connected(new WebSocketManager(true));
    expect(latest().url).toBe("wss://api.hyperliquid-testnet.xyz/ws");
  });

  it("resolves once the socket opens", async () => {
    const manager = new WebSocketManager();
    expect(manager.isConnected()).toBe(false);

    await connected(manager);

    expect(manager.isConnected()).toBe(true);
  });

  it("reuses an open socket instead of opening a second one", async () => {
    const manager = new WebSocketManager();
    await connected(manager);

    await manager.connect();

    expect(sockets()).toHaveLength(1);
  });

  it("rejects when the socket errors", async () => {
    const manager = new WebSocketManager();
    const promise = manager.connect();
    latest().fail(new Error("handshake failed"));

    await expect(promise).rejects.toThrow("handshake failed");
  });

  /**
   * The old in-flight path handed late callers a polling interval that could
   * only resolve — when the attempt errored they hung forever, subscriptions
   * never registered, and the interval leaked.
   */
  it("shares one in-flight attempt and fails every caller together", async () => {
    const manager = new WebSocketManager();
    const first = manager.connect();
    const second = manager.connect();

    expect(sockets()).toHaveLength(1);
    latest().fail(new Error("handshake failed"));

    await expect(first).rejects.toThrow("handshake failed");
    await expect(second).rejects.toThrow("handshake failed");
  });

  it("settles a caller whose socket closed before it ever opened", async () => {
    const manager = new WebSocketManager();
    const promise = manager.connect();

    latest().drop();

    await expect(promise).rejects.toThrow(/closed before opening/);
  });
});

describe("keepalive", () => {
  it("pings on an interval so a quiet connection is not culled", async () => {
    // The exchange drops a connection with no traffic in about a minute; a
    // subscription that happened to be quiet was reconnecting every minute.
    const manager = new WebSocketManager();
    const socket = await connected(manager);

    vi.advanceTimersByTime(30_000);
    expect(socket.frames()).toContainEqual({ method: "ping" });
  });

  it("stops pinging after a disconnect", async () => {
    const manager = new WebSocketManager();
    const socket = await connected(manager);

    manager.disconnect();
    const framesBefore = socket.sent.length;
    vi.advanceTimersByTime(120_000);

    expect(socket.sent.length).toBe(framesBefore);
  });
});

describe("user events", () => {
  it("subscribes with the account the events are for", async () => {
    // The exchange rejects a bare userEvents subscription, which left the
    // fast balance-refresh path dead and the account connection silent.
    const manager = new WebSocketManager();
    const socket = await connected(manager);

    manager.subscribe("userEvents:0xabc", () => {});

    expect(socket.frames().at(-1)).toEqual({
      method: "subscribe",
      subscription: { type: "userEvents", user: "0xabc" },
    });
  });

  it("routes events, which arrive on the 'user' channel", async () => {
    const manager = new WebSocketManager();
    const socket = await connected(manager);
    const callback = vi.fn();
    manager.subscribe("userEvents:0xabc", callback);

    socket.emit({ channel: "user", data: { fills: [] } });

    expect(callback).toHaveBeenCalledTimes(1);
  });
});

describe("subscriptions", () => {
  it("holds the subscribe frame until the socket is open", async () => {
    const manager = new WebSocketManager();
    manager.subscribe("l2Book:BTC", () => {});

    const socket = await connected(manager);

    expect(socket.frames()).toEqual([
      { method: "subscribe", subscription: { type: "l2Book", coin: "BTC" } },
    ]);
  });

  it("sends one frame however many callbacks share a channel", async () => {
    const manager = new WebSocketManager();
    const socket = await connected(manager);

    manager.subscribe("trades:ETH", () => {});
    manager.subscribe("trades:ETH", () => {});

    expect(socket.frames()).toEqual([
      { method: "subscribe", subscription: { type: "trades", coin: "ETH" } },
    ]);
  });

  it("encodes the interval for candle channels", async () => {
    const manager = new WebSocketManager();
    const socket = await connected(manager);

    manager.subscribe("candle:BTC:15m", () => {});

    expect(socket.frames().at(-1)).toEqual({
      method: "subscribe",
      subscription: { type: "candle", coin: "BTC", interval: "15m" },
    });
  });

  it("unsubscribes only once the last callback is gone", async () => {
    const manager = new WebSocketManager();
    const socket = await connected(manager);

    const first = manager.subscribe("l2Book:BTC", () => {});
    const second = manager.subscribe("l2Book:BTC", () => {});

    first();
    expect(socket.frames()).toHaveLength(1);

    second();
    expect(socket.frames().at(-1)).toEqual({
      method: "unsubscribe",
      subscription: { type: "l2Book", coin: "BTC" },
    });
  });

  it("restores every subscription on the socket that replaces a dropped one", async () => {
    // The whole point of the reconnect: a chart left running through a network
    // blip has to keep receiving data without the UI resubscribing.
    const manager = new WebSocketManager();
    await connected(manager);
    manager.subscribe("l2Book:BTC", () => {});
    manager.subscribe("candle:ETH:1m", () => {});

    vi.advanceTimersByTime(10_000);
    latest().drop();
    vi.advanceTimersByTime(1_000);
    const replacement = latest();
    replacement.open();

    expect(replacement.frames()).toEqual([
      { method: "subscribe", subscription: { type: "l2Book", coin: "BTC" } },
      {
        method: "subscribe",
        subscription: { type: "candle", coin: "ETH", interval: "1m" },
      },
    ]);
  });
});

describe("message routing", () => {
  it("routes an order book update to the subscribers of that coin", async () => {
    const manager = new WebSocketManager();
    const socket = await connected(manager);
    const btc = vi.fn();
    const eth = vi.fn();
    manager.subscribe("l2Book:BTC", btc);
    manager.subscribe("l2Book:ETH", eth);

    const message: WsMessage = {
      channel: "l2Book",
      data: { coin: "BTC", levels: [[], []], time: 1 },
    };
    socket.emit(message);

    expect(btc).toHaveBeenCalledWith(message);
    expect(eth).not.toHaveBeenCalled();
  });

  it("routes trades by the coin of the first trade", async () => {
    const manager = new WebSocketManager();
    const socket = await connected(manager);
    const callback = vi.fn();
    manager.subscribe("trades:ETH", callback);

    socket.emit({
      channel: "trades",
      data: [
        { coin: "ETH", side: "buy", px: 1, sz: 2, time: 3, hash: "0x1" },
      ],
    });

    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("routes candles by coin and interval", async () => {
    const manager = new WebSocketManager();
    const socket = await connected(manager);
    const oneMinute = vi.fn();
    const fifteenMinute = vi.fn();
    manager.subscribe("candle:BTC:1m", oneMinute);
    manager.subscribe("candle:BTC:15m", fifteenMinute);

    socket.emit({ channel: "candle", data: candle({ i: "15m" }) });

    expect(oneMinute).not.toHaveBeenCalled();
    expect(fifteenMinute).toHaveBeenCalledTimes(1);
  });

  it("routes channels that carry no coin by channel name", async () => {
    const manager = new WebSocketManager();
    const socket = await connected(manager);
    const callback = vi.fn();
    manager.subscribe("allMids", callback);

    socket.emit({ channel: "allMids", data: { BTC: "50000" } });

    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("drops a message no one subscribed to", async () => {
    const manager = new WebSocketManager();
    const socket = await connected(manager);

    expect(() =>
      socket.emit({ channel: "allMids", data: { BTC: "50000" } }),
    ).not.toThrow();
  });

  it("survives a malformed payload", async () => {
    const manager = new WebSocketManager();
    const socket = await connected(manager);
    const callback = vi.fn();
    manager.subscribe("allMids", callback);

    expect(() => socket.emitRaw("not json")).not.toThrow();
    expect(callback).not.toHaveBeenCalled();
  });

  it("isolates a throwing callback from the others", async () => {
    const manager = new WebSocketManager();
    const socket = await connected(manager);
    const healthy = vi.fn();
    manager.subscribe("allMids", () => {
      throw new Error("render failed");
    });
    manager.subscribe("allMids", healthy);

    socket.emit({ channel: "allMids", data: {} });

    expect(healthy).toHaveBeenCalledTimes(1);
  });
});

describe("status listeners", () => {
  it("reports connect and disconnect", async () => {
    const manager = new WebSocketManager();
    const status = vi.fn();
    manager.onStatusChange(status);

    const socket = await connected(manager);
    expect(status).toHaveBeenLastCalledWith(true);

    socket.drop();
    expect(status).toHaveBeenLastCalledWith(false);
  });

  it("stops reporting after unsubscribe", async () => {
    const manager = new WebSocketManager();
    const status = vi.fn();
    const unsubscribe = manager.onStatusChange(status);

    unsubscribe();
    await connected(manager);

    expect(status).not.toHaveBeenCalled();
  });

  it("isolates a throwing listener from the others", async () => {
    const manager = new WebSocketManager();
    const healthy = vi.fn();
    manager.onStatusChange(() => {
      throw new Error("listener failed");
    });
    manager.onStatusChange(healthy);

    await connected(manager);

    expect(healthy).toHaveBeenCalledWith(true);
  });
});

describe("reconnect back-off", () => {
  it("retries one second after a connection that had been stable", async () => {
    const manager = new WebSocketManager();
    await connected(manager);

    vi.advanceTimersByTime(10_000);
    latest().drop();

    vi.advanceTimersByTime(999);
    expect(sockets()).toHaveLength(1);

    vi.advanceTimersByTime(1);
    expect(sockets()).toHaveLength(2);
  });

  it("doubles the delay while the socket keeps failing to open", async () => {
    // A socket that never opens leaves connectionOpenedAt null. Resetting the
    // counter in that case would pin the delay at one second forever, which is
    // the tight loop against an unreachable server the back-off exists to stop.
    const manager = new WebSocketManager();
    manager.connect().catch(() => {});

    latest().drop();
    vi.advanceTimersByTime(1_000);
    expect(sockets()).toHaveLength(2);

    latest().drop();
    vi.advanceTimersByTime(1_999);
    expect(sockets()).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(sockets()).toHaveLength(3);

    latest().drop();
    vi.advanceTimersByTime(3_999);
    expect(sockets()).toHaveLength(3);
    vi.advanceTimersByTime(1);
    expect(sockets()).toHaveLength(4);
  });

  it("keeps climbing when a connection opens but drops inside the stability window", async () => {
    const manager = new WebSocketManager();
    await connected(manager);

    vi.advanceTimersByTime(4_999);
    latest().drop();
    vi.advanceTimersByTime(1_000);
    expect(sockets()).toHaveLength(2);

    latest().open();
    vi.advanceTimersByTime(4_999);
    latest().drop();

    // Second attempt, so two seconds rather than one.
    vi.advanceTimersByTime(1_999);
    expect(sockets()).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(sockets()).toHaveLength(3);
  });

  it("resets the delay after a connection that outlived the stability window", async () => {
    const manager = new WebSocketManager();
    await connected(manager);

    vi.advanceTimersByTime(1_000);
    latest().drop();
    vi.advanceTimersByTime(1_000);
    expect(sockets()).toHaveLength(2);

    latest().open();
    vi.advanceTimersByTime(5_000);
    latest().drop();

    vi.advanceTimersByTime(1_000);
    expect(sockets()).toHaveLength(3);
  });

  /**
   * The old implementation stopped for good after ten attempts (~17 minutes
   * of backoff), so a phone that lost the network for a while came back to a
   * UI whose socket silently never reconnected until a full reload. The delay
   * caps instead; the retries never stop.
   */
  it("never gives up — the delay caps at thirty seconds", async () => {
    const manager = new WebSocketManager();
    manager.connect().catch(() => {});

    // Climb well past where the old implementation gave up.
    for (let attempt = 1; attempt <= 14; attempt++) {
      latest().drop();
      vi.advanceTimersByTime(30_000);
    }
    expect(sockets()).toHaveLength(15);

    latest().drop();
    vi.advanceTimersByTime(30_000);
    expect(sockets()).toHaveLength(16);
  });
});

describe("disconnect", () => {
  it("does not schedule a reconnect", async () => {
    // close() still fires onclose. Without a guard the manager treats its own
    // shutdown as a dropped connection and quietly reopens the socket.
    const manager = new WebSocketManager();
    await connected(manager);

    manager.disconnect();
    vi.advanceTimersByTime(60_000);

    expect(sockets()).toHaveLength(1);
    expect(manager.isConnected()).toBe(false);
  });

  it("reports the disconnection to status listeners", async () => {
    const manager = new WebSocketManager();
    const status = vi.fn();
    manager.onStatusChange(status);
    await connected(manager);

    manager.disconnect();

    expect(status).toHaveBeenLastCalledWith(false);
  });

  it("drops the subscriptions, so a later connect starts clean", async () => {
    const manager = new WebSocketManager();
    await connected(manager);
    manager.subscribe("l2Book:BTC", () => {});

    manager.disconnect();
    const socket = await connected(manager);

    expect(socket.frames()).toEqual([]);
  });

  it("is safe before a connection was ever made", () => {
    const manager = new WebSocketManager();

    expect(() => manager.disconnect()).not.toThrow();
    expect(sockets()).toHaveLength(0);
  });
});
