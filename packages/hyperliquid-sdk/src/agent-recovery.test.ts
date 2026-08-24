import { afterEach, describe, expect, it, vi } from "vitest";

import {
  __resetAgentRecoveryForTests,
  clearAgentRecoveryIncident,
  getLastAgentRecoveryIncident,
  reportAgentRecoveryIncident,
  subscribeToAgentRecovery,
} from "./agent-recovery";
import { AgentAuthorizationError } from "./exchange-response";

const ERROR = new AgentAuthorizationError({
  action: "closePosition",
  accountAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  agentAddress: "0x1234567890abcdef1234567890abcdef12345678",
  exchangeMessage:
    "User or API Wallet 0x1234567890abcdef1234567890abcdef12345678 does not exist.",
  message: "Trading authorization is no longer valid.",
  occurredAt: 1_760_000_000_000,
});

const OTHER_ACCOUNT_ERROR = new AgentAuthorizationError({
  ...{
    action: "cancelOrder",
    accountAddress: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    agentAddress: "0x2222222222222222222222222222222222222222",
    exchangeMessage: "User or API Wallet 0x2222 does not exist.",
    message: "Trading authorization is no longer valid.",
    occurredAt: 1_760_000_000_001,
  },
});

afterEach(() => {
  __resetAgentRecoveryForTests();
});

describe("reportAgentRecoveryIncident", () => {
  it("tells every subscriber which action was refused", () => {
    const first = vi.fn();
    const second = vi.fn();
    subscribeToAgentRecovery(first);
    subscribeToAgentRecovery(second);

    reportAgentRecoveryIncident(ERROR);

    for (const listener of [first, second]) {
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "closePosition",
          agentAddress: "0x1234567890abcdef1234567890abcdef12345678",
          occurredAt: 1_760_000_000_000,
        }),
      );
    }
  });

  it("retains the incident for a subscriber that mounts afterwards", () => {
    // The screen that has to show this may still have been loading when the
    // trade failed. Dropping the incident because nobody was listening yet
    // would leave the user with a trade that silently did nothing.
    reportAgentRecoveryIncident(ERROR);

    const late = vi.fn();
    subscribeToAgentRecovery(late);

    expect(late).not.toHaveBeenCalled();
    expect(getLastAgentRecoveryIncident()).toMatchObject({
      action: "closePosition",
    });
  });

  it("keeps going when one subscriber throws", () => {
    const broken = vi.fn(() => {
      throw new Error("render failed");
    });
    const healthy = vi.fn();
    subscribeToAgentRecovery(broken);
    subscribeToAgentRecovery(healthy);

    expect(() => reportAgentRecoveryIncident(ERROR)).not.toThrow();
    expect(healthy).toHaveBeenCalledTimes(1);
  });

  it("stops telling a subscriber that unsubscribed", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToAgentRecovery(listener);

    unsubscribe();
    reportAgentRecoveryIncident(ERROR);

    expect(listener).not.toHaveBeenCalled();
  });

  it("does not expose one account's incident to another account", () => {
    const accountA = vi.fn();
    const accountB = vi.fn();
    subscribeToAgentRecovery(accountA, ERROR.accountAddress);
    subscribeToAgentRecovery(accountB, OTHER_ACCOUNT_ERROR.accountAddress);

    reportAgentRecoveryIncident(ERROR);

    expect(accountA).toHaveBeenCalledTimes(1);
    expect(accountB).not.toHaveBeenCalled();
    expect(
      getLastAgentRecoveryIncident(OTHER_ACCOUNT_ERROR.accountAddress),
    ).toBeNull();

    reportAgentRecoveryIncident(OTHER_ACCOUNT_ERROR);
    expect(accountB).toHaveBeenCalledTimes(1);
    expect(getLastAgentRecoveryIncident(ERROR.accountAddress)).toBeNull();
  });
});

describe("clearAgentRecoveryIncident", () => {
  it("forgets the incident once it has been dealt with", () => {
    reportAgentRecoveryIncident(ERROR);
    expect(getLastAgentRecoveryIncident()).not.toBeNull();

    clearAgentRecoveryIncident();

    expect(getLastAgentRecoveryIncident()).toBeNull();
  });
});
