import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearAgentKey,
  generateAgentKey,
  getAgentAddress,
  getStoredAgentExpiry,
  getStoredAgentKey,
  isAgentKeyExpired,
  storeAgentExpiry,
  storeAgentKey,
} from "./agent";

// These tests run in the node environment, where there is no localStorage, and
// agent.ts reads the bare global. A stub has to be installed on globalThis.
type StorageFailure = "none" | "read" | "write";

function createStorageStub(failure: StorageFailure) {
  const entries = new Map<string, string>();
  return {
    entries,
    getItem(key: string): string | null {
      if (failure === "read") {
        throw new DOMException("access denied", "SecurityError");
      }
      return entries.has(key) ? (entries.get(key) as string) : null;
    },
    setItem(key: string, value: string): void {
      if (failure === "write") {
        throw new DOMException("quota exceeded", "QuotaExceededError");
      }
      entries.set(key, String(value));
    },
    removeItem(key: string): void {
      entries.delete(key);
    },
    clear(): void {
      entries.clear();
    },
    key(index: number): string | null {
      return [...entries.keys()][index] ?? null;
    },
    get length(): number {
      return entries.size;
    },
  };
}

let storage: ReturnType<typeof createStorageStub>;

function useStorage(failure: StorageFailure = "none") {
  storage = createStorageStub(failure);
  Object.defineProperty(globalThis, "localStorage", {
    value: storage,
    configurable: true,
    writable: true,
  });
  return storage;
}

// Mixed case on purpose: Privy hands back a checksummed address, while other
// call sites lowercase it. Both must reach the same stored key.
const WALLET = "0xAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAa";
const WALLET_LOWER = WALLET.toLowerCase();
const OTHER_WALLET = "0xBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBb";

// secp256k1 private key 1, whose address is a standard test vector.
const KEY_ONE =
  "0x0000000000000000000000000000000000000000000000000000000000000001" as const;
const ADDRESS_ONE = "0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf";

const KEY_TWO =
  "0x0000000000000000000000000000000000000000000000000000000000000002" as const;

const DAY_MS = 24 * 60 * 60 * 1000;

beforeEach(() => {
  useStorage();
});

afterEach(() => {
  vi.useRealTimers();
  Reflect.deleteProperty(globalThis, "localStorage");
});

describe("generateAgentKey", () => {
  it("returns a 32-byte hex private key", () => {
    expect(generateAgentKey()).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("returns a distinct key on every call", () => {
    const keys = new Set(Array.from({ length: 8 }, () => generateAgentKey()));
    expect(keys.size).toBe(8);
  });
});

describe("getAgentAddress", () => {
  it("derives the checksummed address of a known key", () => {
    expect(getAgentAddress(KEY_ONE)).toBe(ADDRESS_ONE);
  });

  it("is deterministic, so a reapproval of the stored key hits the same agent", () => {
    const key = generateAgentKey();
    expect(getAgentAddress(key)).toBe(getAgentAddress(key));
  });

  it("maps distinct keys to distinct addresses", () => {
    expect(getAgentAddress(KEY_ONE)).not.toBe(getAgentAddress(KEY_TWO));
  });
});

describe("agent key storage", () => {
  it("round-trips a stored key", () => {
    storeAgentKey(WALLET, KEY_ONE);
    expect(getStoredAgentKey(WALLET)).toBe(KEY_ONE);
  });

  it("returns null when nothing is stored", () => {
    expect(getStoredAgentKey(WALLET)).toBeNull();
  });

  it("normalizes the wallet address, so casing cannot orphan a key", () => {
    storeAgentKey(WALLET, KEY_ONE);
    expect(getStoredAgentKey(WALLET_LOWER)).toBe(KEY_ONE);

    clearAgentKey(WALLET);
    storeAgentKey(WALLET_LOWER, KEY_TWO);
    expect(getStoredAgentKey(WALLET)).toBe(KEY_TWO);
  });

  it("namespaces the entry by wallet", () => {
    storeAgentKey(WALLET, KEY_ONE);
    expect(storage.entries.get(`hl_agent_${WALLET_LOWER}`)).toBe(KEY_ONE);
    expect(getStoredAgentKey(OTHER_WALLET)).toBeNull();
  });

  it("replaces the previous key on rotation", () => {
    storeAgentKey(WALLET, KEY_ONE);
    storeAgentKey(WALLET, KEY_TWO);
    expect(getStoredAgentKey(WALLET)).toBe(KEY_TWO);
  });

  it("returns null when localStorage reads throw", () => {
    // Embedded webviews and private-mode Safari throw on access. Callers fall
    // back to generating a key rather than the trading screen crashing.
    useStorage("read");
    expect(getStoredAgentKey(WALLET)).toBeNull();
  });

  it("propagates a write failure instead of reporting a key that was never stored", () => {
    // The setters have no try/catch, unlike the getters. Approval calls this
    // after the on-chain approveAgent succeeded, so a swallowed failure would
    // leave the caller believing it can sign orders with a key that is gone.
    useStorage("write");
    expect(() => storeAgentKey(WALLET, KEY_ONE)).toThrow();
  });
});

describe("agent key expiry", () => {
  it("round-trips an expiry", () => {
    storeAgentExpiry(WALLET, 1_760_000_000_000);
    expect(getStoredAgentExpiry(WALLET)).toBe(1_760_000_000_000);
  });

  it("returns null when no expiry is recorded", () => {
    expect(getStoredAgentExpiry(WALLET)).toBeNull();
  });

  it("normalizes the wallet address and namespaces the entry", () => {
    storeAgentExpiry(WALLET, 42);
    expect(storage.entries.get(`hl_agent_expiry_${WALLET_LOWER}`)).toBe("42");
    expect(getStoredAgentExpiry(WALLET_LOWER)).toBe(42);
    expect(getStoredAgentExpiry(OTHER_WALLET)).toBeNull();
  });

  it("returns null for an unparseable expiry", () => {
    storage.entries.set(`hl_agent_expiry_${WALLET_LOWER}`, "not-a-number");
    expect(getStoredAgentExpiry(WALLET)).toBeNull();
  });

  it("returns null for a non-finite expiry", () => {
    storage.entries.set(`hl_agent_expiry_${WALLET_LOWER}`, "Infinity");
    expect(getStoredAgentExpiry(WALLET)).toBeNull();
  });

  it("returns null when localStorage reads throw", () => {
    useStorage("read");
    expect(getStoredAgentExpiry(WALLET)).toBeNull();
  });
});

describe("isAgentKeyExpired", () => {
  it("reports not expired when no expiry is recorded", () => {
    // Fails open by design: a key with no local expiry is only ruled out by the
    // remote extraAgents check, not by this function.
    expect(isAgentKeyExpired(WALLET)).toBe(false);
  });

  it("reports not expired before the expiry", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_760_000_000_000);
    storeAgentExpiry(WALLET, 1_760_000_000_000 + DAY_MS);
    expect(isAgentKeyExpired(WALLET)).toBe(false);
  });

  it("reports expired after the expiry", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_760_000_000_000);
    storeAgentExpiry(WALLET, 1_760_000_000_000 - 1);
    expect(isAgentKeyExpired(WALLET)).toBe(true);
  });

  it("treats the exact expiry instant as still valid", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_760_000_000_000);
    storeAgentExpiry(WALLET, 1_760_000_000_000);
    expect(isAgentKeyExpired(WALLET)).toBe(false);
  });

  it("treats a zero expiry as long past", () => {
    storeAgentExpiry(WALLET, 0);
    expect(isAgentKeyExpired(WALLET)).toBe(true);
  });

  it("does not lock the user out on an unreadable expiry", () => {
    storage.entries.set(`hl_agent_expiry_${WALLET_LOWER}`, "corrupt");
    expect(isAgentKeyExpired(WALLET)).toBe(false);
  });

  it("is independent per wallet", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_760_000_000_000);
    storeAgentExpiry(WALLET, 1_760_000_000_000 - 1);
    storeAgentExpiry(OTHER_WALLET, 1_760_000_000_000 + DAY_MS);
    expect(isAgentKeyExpired(WALLET)).toBe(true);
    expect(isAgentKeyExpired(OTHER_WALLET)).toBe(false);
  });
});

describe("clearAgentKey", () => {
  it("removes both the key and its expiry", () => {
    storeAgentKey(WALLET, KEY_ONE);
    storeAgentExpiry(WALLET, 1_760_000_000_000);

    clearAgentKey(WALLET);

    expect(getStoredAgentKey(WALLET)).toBeNull();
    expect(getStoredAgentExpiry(WALLET)).toBeNull();
    expect(storage.length).toBe(0);
  });

  it("accepts a mixed-case address", () => {
    storeAgentKey(WALLET_LOWER, KEY_ONE);
    storeAgentExpiry(WALLET_LOWER, 1_760_000_000_000);

    clearAgentKey(WALLET);

    expect(storage.length).toBe(0);
  });

  it("leaves other wallets untouched", () => {
    storeAgentKey(WALLET, KEY_ONE);
    storeAgentKey(OTHER_WALLET, KEY_TWO);

    clearAgentKey(WALLET);

    expect(getStoredAgentKey(OTHER_WALLET)).toBe(KEY_TWO);
  });

  it("is a no-op when nothing is stored", () => {
    expect(() => clearAgentKey(WALLET)).not.toThrow();
    expect(getStoredAgentKey(WALLET)).toBeNull();
  });
});

describe("reapproval", () => {
  // Mirrors the approval mutation: reuse the stored key if there is one,
  // otherwise generate, then persist expiry and key together.
  function approve(wallet: string, expiryMs: number) {
    const privateKey = getStoredAgentKey(wallet) ?? generateAgentKey();
    const agentAddress = getAgentAddress(privateKey);
    storeAgentExpiry(wallet, expiryMs);
    storeAgentKey(wallet, privateKey);
    return agentAddress;
  }

  it("keeps an expired key readable so reapproval reuses the same agent address", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_760_000_000_000);

    const first = approve(WALLET, 1_760_000_000_000 + DAY_MS);

    vi.setSystemTime(1_760_000_000_000 + 8 * DAY_MS);
    expect(isAgentKeyExpired(WALLET)).toBe(true);
    // The key survives expiry — clearing it here would strand the agent that is
    // still registered on chain and force a second approval signature.
    expect(getStoredAgentKey(WALLET)).not.toBeNull();

    const second = approve(WALLET, Date.now() + 7 * DAY_MS);

    expect(second).toBe(first);
    expect(isAgentKeyExpired(WALLET)).toBe(false);
  });

  it("generates a fresh key after the stored one is cleared", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_760_000_000_000);

    const first = approve(WALLET, Date.now() + DAY_MS);
    clearAgentKey(WALLET);
    const second = approve(WALLET, Date.now() + DAY_MS);

    expect(second).not.toBe(first);
    expect(isAgentKeyExpired(WALLET)).toBe(false);
  });

  it("keeps each wallet's agent separate across reapproval", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_760_000_000_000);

    const a = approve(WALLET, Date.now() + DAY_MS);
    const b = approve(OTHER_WALLET, Date.now() + DAY_MS);

    expect(a).not.toBe(b);
    expect(approve(WALLET, Date.now() + DAY_MS)).toBe(a);
    expect(approve(OTHER_WALLET, Date.now() + DAY_MS)).toBe(b);
  });
});
