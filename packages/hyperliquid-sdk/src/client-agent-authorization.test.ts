import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { generateAgentKey } from "./agent";
import {
  __resetAgentRecoveryForTests,
  getLastAgentRecoveryIncident,
} from "./agent-recovery";
import { HyperliquidClient } from "./client";
import {
  isAgentAuthorizationError,
  isUserRejectedSignature,
} from "./exchange-response";

/**
 * What happens to a trading action the exchange refuses for lack of a valid
 * API wallet.
 *
 * The classification lives in one place because all eleven trading actions
 * funnel through it. These tests hold that: every action name is checked here,
 * and one action is driven end to end through its public method to confirm the
 * funnel is real and not just a function nobody calls.
 */

const UNKNOWN_SIGNER =
  "User or API Wallet 0x1234567890abcdef1234567890abcdef12345678 does not exist.";

/** Every action the plan names — close, place, cancel, protection, leverage, margin. */
const TRADING_ACTIONS = [
  "placeOrder",
  "placeSpotOrder",
  "placeTriggerOrder",
  "closePosition",
  "cancelOrder",
  "cancelAllOrders",
  "modifyOrder",
  "upsertPositionProtection",
  "cancelPositionProtection",
  "updateLeverage",
  "updateIsolatedMargin",
] as const;

function createClient({ withAgent = true } = {}) {
  const client = new HyperliquidClient({
    testnet: true,
    walletAddress: "0x5bF344d20040e6c7589b46ae0e9F98210C40bF41",
    masterAccountAddress: "0x5bF344d20040e6c7589b46ae0e9F98210C40bF41",
  } as any);

  if (withAgent) client.setAgentKey(generateAgentKey());
  return client;
}

function classify(client: HyperliquidClient, action: string, message: string) {
  try {
    (client as any).normalizeExchangeError(action, {}, new Error(message));
  } catch (error) {
    return error;
  }
  throw new Error("normalizeExchangeError did not throw");
}

beforeEach(() => {
  __resetAgentRecoveryForTests();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  __resetAgentRecoveryForTests();
});

describe("a refused agent, across every trading action", () => {
  it.each(TRADING_ACTIONS)(
    "classifies %s as a recoverable authorization failure",
    (action) => {
      const client = createClient();
      const agentAddress = client.agentAddress();

      const error = classify(client, action, UNKNOWN_SIGNER);

      expect(isAgentAuthorizationError(error)).toBe(true);
      expect(error).toMatchObject({
        code: "AGENT_AUTHORIZATION_REJECTED",
        action,
        agentAddress,
        exchangeMessage: UNKNOWN_SIGNER,
      });
    },
  );

  it.each(TRADING_ACTIONS)(
    "stops signing with the refused key after %s",
    (action) => {
      const client = createClient();
      expect(client.hasAgentKey()).toBe(true);

      classify(client, action, UNKNOWN_SIGNER);

      // Every later action would fail identically. Keeping the key only buys a
      // second identical failure.
      expect(client.hasAgentKey()).toBe(false);
      expect(client.agentAddress()).toBeNull();
    },
  );

  it.each(TRADING_ACTIONS)("raises a recovery incident naming %s", (action) => {
    const client = createClient();

    classify(client, action, UNKNOWN_SIGNER);

    expect(getLastAgentRecoveryIncident()).toMatchObject({
      action,
      exchangeMessage: UNKNOWN_SIGNER,
    });
  });

  it("never puts the agent address in what the user is shown", () => {
    const client = createClient();

    const error = classify(client, "closePosition", UNKNOWN_SIGNER) as Error;

    expect(error.message).not.toMatch(/0x/);
  });
});

describe("the same message, from a wallet that is not an agent", () => {
  it("does not offer to reauthorize an account that never deposited", () => {
    // Without an agent key the action was signed by the master wallet, so this
    // message means the account does not exist — advice to reauthorize would
    // send the user round a loop that cannot end.
    const client = createClient({ withAgent: false });

    const error = classify(client, "closePosition", UNKNOWN_SIGNER) as Error;

    expect(isAgentAuthorizationError(error)).toBe(false);
    expect(error.message).toMatch(/does not exist yet/i);
    expect(error.message).not.toMatch(/0x/);
    expect(getLastAgentRecoveryIncident()).toBeNull();
  });

  it("leaves a non-trading action alone even while an agent is held", () => {
    const client = createClient();

    const error = classify(client, "withdraw", UNKNOWN_SIGNER);

    expect(isAgentAuthorizationError(error)).toBe(false);
    expect(client.hasAgentKey()).toBe(true);
    expect(getLastAgentRecoveryIncident()).toBeNull();
  });

  it("leaves an unrelated trading failure to fail normally", () => {
    const client = createClient();

    const error = classify(
      client,
      "placeOrder",
      "Insufficient margin",
    ) as Error;

    expect(isAgentAuthorizationError(error)).toBe(false);
    expect(client.hasAgentKey()).toBe(true);
    expect(getLastAgentRecoveryIncident()).toBeNull();
  });
});

describe("end to end, through a public trading method", () => {
  it("surfaces the refusal, drops the key and records the incident", async () => {
    const client = createClient();
    (client as any).resolveMarket = async () => ({ asset: 0 });
    (client as any).getTradingClient = async () => ({
      cancel: async () => {
        throw new Error(UNKNOWN_SIGNER);
      },
    });

    await expect(client.cancelOrder("BTC", 123)).rejects.toMatchObject({
      code: "AGENT_AUTHORIZATION_REJECTED",
      action: "cancelOrder",
    });

    expect(client.hasAgentKey()).toBe(false);
    expect(getLastAgentRecoveryIncident()).toMatchObject({
      action: "cancelOrder",
    });
  });

  it("survives an environment with no localStorage to clear", async () => {
    // These tests run in node, where the stored half of the key cannot be
    // reached. Failing to clear storage must not swallow the trading error the
    // caller is waiting for.
    const client = createClient();
    (client as any).resolveMarket = async () => ({ asset: 0 });
    (client as any).getTradingClient = async () => ({
      cancel: async () => {
        throw new Error(UNKNOWN_SIGNER);
      },
    });

    await expect(client.cancelOrder("BTC", 123)).rejects.toThrow();
    expect(client.hasAgentKey()).toBe(false);
  });

  it("marks protection recovery as partial after the old stop was cancelled", async () => {
    const client = createClient();
    const cancel = vi.fn().mockResolvedValue({ status: "ok" });
    const order = vi.fn().mockRejectedValue(new Error(UNKNOWN_SIGNER));
    (client as any).getTradingClient = async () => ({ cancel, order });
    (client as any).resolveMarket = async () => ({
      asset: 0,
      name: "BTC",
      marketType: "perp",
    });
    (client as any).getReferencePrice = async () => 100;
    (client as any).getOpenOrders = async () => [
      {
        oid: 7,
        coin: "BTC",
        reduceOnly: true,
        isTrigger: true,
        triggerPx: 80,
      },
    ];
    (client as any).normalizeTriggerOrder = async () => ({
      market: { asset: 0 },
      side: "sell",
      price: "89",
      size: "1",
      triggerPx: "90",
      triggerKind: "stopLoss",
      cloid: undefined,
    });
    (client as any).ensureBuilderApproval = async () => undefined;

    await expect(
      client.upsertPositionProtection({
        coin: "BTC",
        sizeHint: 1,
        stopLossPx: 90,
      }),
    ).rejects.toMatchObject({
      code: "AGENT_AUTHORIZATION_REJECTED",
      action: "upsertPositionProtection",
      outcome: "partially-executed",
    });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(order).toHaveBeenCalledTimes(1);
    expect(getLastAgentRecoveryIncident()).toMatchObject({
      action: "upsertPositionProtection",
      outcome: "partially-executed",
    });
  });
});

describe("revocation signature rejection", () => {
  it("preserves the provider rejection code so the valid key is not treated as ambiguous", async () => {
    const client = createClient();
    const rejection = Object.assign(new Error("Request declined"), {
      code: 4001,
    });
    (client as any).getMainWalletClient = vi.fn().mockResolvedValue({
      approveAgent: vi.fn().mockRejectedValue(rejection),
    });

    let caught: unknown;
    try {
      await client.revokeAgent();
    } catch (error) {
      caught = error;
    }

    expect(isUserRejectedSignature(caught)).toBe(true);
    expect(caught).toBe(rejection);
    expect(client.hasAgentKey()).toBe(true);
  });
});
