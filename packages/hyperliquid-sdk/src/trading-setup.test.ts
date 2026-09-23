import { describe, expect, it } from "vitest";

import {
  AGENT_PROPAGATION_GRACE_MS,
  getBuilderApprovalState,
  getUnifiedApprovalRequirementState,
  reduceAgentApproval,
  type AgentApprovalState,
} from "./trading-setup";

const NOW = 1_760_000_000_000;

const localApproved: AgentApprovalState = {
  address: "0xAgent",
  approved: true,
  hasLocalKey: true,
  isExpired: false,
  validUntil: null,
  state: "approved",
  reason: "active",
  name: "tsnm-trade-agent",
  approvedAt: NOW,
  remoteConfirmed: false,
  lastVerifiedAt: null,
};

const noLocalKey: AgentApprovalState = {
  address: null,
  approved: false,
  hasLocalKey: false,
  isExpired: false,
  validUntil: null,
  state: "missing",
  reason: "missing-local-key",
  name: null,
  approvedAt: null,
  remoteConfirmed: false,
  lastVerifiedAt: null,
};

describe("getBuilderApprovalState", () => {
  it("has nothing to approve when no builder is configured", () => {
    expect(getBuilderApprovalState(undefined, false, false, 50)).toBe(
      "approved",
    );
    expect(getBuilderApprovalState(0, true, false, 50)).toBe("approved");
  });

  it("approves only at or above the configured rate", () => {
    expect(getBuilderApprovalState(50, false, true, 50)).toBe("approved");
    expect(getBuilderApprovalState(60, false, true, 50)).toBe("approved");
    expect(getBuilderApprovalState(0, false, true, 50)).toBe("missing");
  });

  /**
   * The case that shipped. An approval between zero and the configured rate
   * passed the old `feeTenthsBp > 0` gate, so setup reported the account ready
   * and the order button lit — while `client.placeOrder` refused every order
   * for exactly the same account, because it compares against the full fee.
   */
  it("treats an under-approved account as missing, not approved", () => {
    expect(getBuilderApprovalState(10, false, true, 50)).toBe("missing");
    expect(getBuilderApprovalState(49, false, true, 50)).toBe("missing");
  });

  it("separates a failed check from a completed one", () => {
    expect(getBuilderApprovalState(undefined, false, true, 50)).toBe(
      "checking",
    );
    expect(getBuilderApprovalState(undefined, true, true, 50)).toBe("stale");
  });
});

describe("getUnifiedApprovalRequirementState", () => {
  it("follows the approval once one is known", () => {
    expect(
      getUnifiedApprovalRequirementState(
        { enabled: true, abstractionMode: "unifiedAccount" },
        false,
      ),
    ).toBe("approved");
    expect(
      getUnifiedApprovalRequirementState(
        { enabled: false, abstractionMode: "standard" },
        false,
      ),
    ).toBe("missing");
  });

  it("separates a failed check from a completed one", () => {
    expect(getUnifiedApprovalRequirementState(undefined, false)).toBe(
      "checking",
    );
    expect(getUnifiedApprovalRequirementState(undefined, true)).toBe("stale");
  });
});

describe("reduceAgentApproval", () => {
  it("reports a missing key without consulting the exchange", () => {
    const { next, validUntilToPersist } = reduceAgentApproval({
      localState: noLocalKey,
      extraAgents: null,
      now: NOW,
    });

    expect(next).toMatchObject({
      state: "missing",
      approved: false,
      lastVerifiedAt: NOW,
    });
    expect(validUntilToPersist).toBeNull();
  });

  it("finds a named remote authorization after local storage is lost", () => {
    const { next } = reduceAgentApproval({
      localState: noLocalKey,
      extraAgents: [
        {
          address: "0xRemoteAgent",
          name: "tsnm-trade-agent",
          validUntil: NOW + 60_000,
        },
      ],
      now: NOW,
    });

    expect(next).toMatchObject({
      address: "0xRemoteAgent",
      approved: false,
      hasLocalKey: false,
      remoteConfirmed: true,
      reason: "remote-only",
      lastVerifiedAt: NOW,
    });
  });

  it("treats an expired local key as missing", () => {
    const { next } = reduceAgentApproval({
      localState: { ...localApproved, isExpired: true },
      extraAgents: [{ address: "0xagent", validUntil: NOW + 1000 }],
      now: NOW,
    });

    expect(next).toMatchObject({ state: "missing", approved: false });
  });

  it("keeps trading on the last known answer when the lookup fails", () => {
    // extraAgents is null because the call threw. An unreachable API is not a
    // revoked agent, and signing the user out here would block a working
    // account.
    const { next } = reduceAgentApproval({
      localState: localApproved,
      extraAgents: null,
      now: NOW,
    });

    expect(next).toMatchObject({ state: "stale", approved: true });
  });

  it("confirms a key the exchange lists", () => {
    const { next, validUntilToPersist } = reduceAgentApproval({
      localState: localApproved,
      extraAgents: [{ address: "0xAGENT", validUntil: NOW + 60_000 }],
      now: NOW,
    });

    expect(next).toMatchObject({
      state: "approved",
      approved: true,
      remoteConfirmed: true,
      isExpired: false,
      validUntil: NOW + 60_000,
      lastVerifiedAt: NOW,
    });
    expect(validUntilToPersist).toBe(NOW + 60_000);
  });

  it("matches the agent address case-insensitively", () => {
    const { next } = reduceAgentApproval({
      localState: { ...localApproved, address: "0xABCdef" },
      extraAgents: [{ address: "0xabcDEF", validUntil: NOW + 1 }],
      now: NOW,
    });

    expect(next.remoteConfirmed).toBe(true);
  });

  it("reports a listed key whose approval has run out as missing", () => {
    const { next } = reduceAgentApproval({
      localState: localApproved,
      extraAgents: [{ address: "0xAgent", validUntil: NOW - 1 }],
      now: NOW,
    });

    expect(next).toMatchObject({
      state: "missing",
      approved: false,
      isExpired: true,
      remoteConfirmed: false,
    });
  });

  it("does not revoke a key that has never been confirmed remotely", () => {
    // Right after approval the agent can be absent from the list for a moment.
    // Reading that as revoked would send the user back through setup they have
    // just completed.
    const { next } = reduceAgentApproval({
      localState: localApproved,
      extraAgents: [{ address: "0xSomeoneElse" }],
      previousState: { ...localApproved, remoteConfirmed: false },
      now: NOW,
    });

    expect(next).toMatchObject({ state: "stale", approved: true });
  });

  it("does revoke a key that the exchange previously confirmed", () => {
    const { next } = reduceAgentApproval({
      localState: localApproved,
      extraAgents: [{ address: "0xSomeoneElse" }],
      previousState: {
        ...localApproved,
        remoteConfirmed: true,
        lastVerifiedAt: NOW - 5_000,
      },
      now: NOW,
    });

    expect(next).toMatchObject({
      state: "missing",
      approved: false,
      remoteConfirmed: false,
      lastVerifiedAt: NOW,
    });
  });

  it("keeps the previous verification time while unconfirmed", () => {
    const { next } = reduceAgentApproval({
      localState: localApproved,
      extraAgents: [],
      previousState: { ...localApproved, lastVerifiedAt: NOW - 9_000 },
      now: NOW,
    });

    expect(next.lastVerifiedAt).toBe(NOW - 9_000);
  });

  it("stops waiting for propagation once the grace window has passed", () => {
    // The same absence as the case above, read a few minutes later. Waiting
    // forever is how an agent revoked from another device went unnoticed until
    // a trade failed.
    const { next } = reduceAgentApproval({
      localState: {
        ...localApproved,
        approvedAt: NOW - AGENT_PROPAGATION_GRACE_MS - 1,
      },
      extraAgents: [{ address: "0xSomeoneElse" }],
      previousState: { ...localApproved, remoteConfirmed: false },
      now: NOW,
    });

    expect(next).toMatchObject({
      state: "missing",
      approved: false,
      reason: "revoked-or-replaced",
    });
  });

  it("ends the grace early when our name is held by another address", () => {
    // Not an absence to wait out: the name is registered, just not to us,
    // which is what another device reauthorizing looks like.
    const { next } = reduceAgentApproval({
      localState: localApproved,
      extraAgents: [
        {
          address: "0xSomeoneElse",
          name: "tsnm-trade-agent",
          validUntil: NOW + 60_000,
        },
      ],
      previousState: { ...localApproved, remoteConfirmed: false },
      now: NOW,
    });

    expect(next).toMatchObject({
      state: "missing",
      approved: false,
      reason: "revoked-or-replaced",
    });
  });

  it("honors propagation grace when reauthorization still echoes the predecessor", () => {
    const { next } = reduceAgentApproval({
      localState: localApproved,
      extraAgents: [
        {
          address: "0xPreviousAgent",
          name: "tsnm-trade-agent",
          validUntil: NOW + 60_000,
        },
      ],
      previousState: {
        ...localApproved,
        reason: "awaiting-propagation",
        remoteConfirmed: false,
      },
      now: NOW,
    });

    expect(next).toMatchObject({
      state: "stale",
      approved: true,
      reason: "awaiting-propagation",
    });
  });

  it("keeps trading on a listed, unexpired agent even beside a duplicate", () => {
    // A duplicate says nothing about whether our own agent works. It is listed
    // and unexpired, so the exchange will accept what it signs; refusing to
    // trade would take away something demonstrably working.
    const { next } = reduceAgentApproval({
      localState: {
        ...localApproved,
        approvedAt: NOW - AGENT_PROPAGATION_GRACE_MS - 1,
      },
      extraAgents: [
        { address: "0xAgent", name: "tsnm-trade-agent", validUntil: NOW + 60_000 },
        { address: "0xOtherAgent", name: "tsnm-trade-agent", validUntil: NOW + 60_000 },
      ],
      previousState: localApproved,
      now: NOW,
    });

    expect(next).toMatchObject({
      approved: true,
      state: "approved",
      reason: "active",
      duplicateNamedAgents: 1,
    });
  });

  it("does not brick an account whose agent names carry the expiry suffix", () => {
    // If the exchange stores the whole `valid_until` string rather than the
    // bare name, every reauthorization leaves its predecessor registered and
    // duplicates are guaranteed. Treating that as a failure would put such an
    // account into a reauthorize loop with no way out: each new approval adds
    // another name and trips the same rule again.
    const { next } = reduceAgentApproval({
      localState: {
        ...localApproved,
        address: "0xNewAgent",
        approvedAt: NOW - AGENT_PROPAGATION_GRACE_MS - 1,
      },
      extraAgents: [
        {
          address: "0xLegacyAgent",
          name: "tsnm-trade-agent valid_until 1750000000000",
          validUntil: NOW + 999_000,
        },
        {
          address: "0xNewAgent",
          name: "tsnm-trade-agent valid_until 1780000000000",
          validUntil: NOW + 999_000,
        },
      ],
      previousState: { ...localApproved, address: "0xNewAgent" },
      now: NOW,
    });

    expect(next).toMatchObject({
      approved: true,
      reason: "active",
      duplicateNamedAgents: 1,
    });
  });

  it("reports no duplicates when the exchange could not be reached", () => {
    // Zero here means "nothing observed", not "confirmed none".
    const { next } = reduceAgentApproval({
      localState: localApproved,
      extraAgents: null,
      now: NOW,
    });

    expect(next.duplicateNamedAgents).toBe(0);
  });

  it("recognises our name whether or not the expiry suffix is echoed back", () => {
    // Which form the exchange stores is unconfirmed, so both have to count.
    const { next } = reduceAgentApproval({
      localState: localApproved,
      extraAgents: [
        {
          address: "0xSomeoneElse",
          name: `tsnm-trade-agent valid_until ${NOW}`,
        },
      ],
      previousState: { ...localApproved, remoteConfirmed: false },
      now: NOW,
    });

    expect(next.reason).toBe("revoked-or-replaced");
  });

  it("reports an unreachable lookup as unverified, not as revoked", () => {
    const { next } = reduceAgentApproval({
      localState: localApproved,
      extraAgents: null,
      now: NOW,
    });

    expect(next).toMatchObject({
      state: "stale",
      approved: true,
      reason: "verification-unavailable",
    });
  });

  it("keeps the name the exchange reports", () => {
    const { next } = reduceAgentApproval({
      localState: localApproved,
      extraAgents: [
        {
          address: "0xAgent",
          name: "tsnm-trade-agent",
          validUntil: NOW + 60_000,
        },
      ],
      now: NOW,
    });

    expect(next).toMatchObject({ reason: "active", name: "tsnm-trade-agent" });
  });

  it("treats a listed agent with no expiry as approved", () => {
    const { next, validUntilToPersist } = reduceAgentApproval({
      localState: localApproved,
      extraAgents: [{ address: "0xAgent" }],
      now: NOW,
    });

    expect(next).toMatchObject({
      state: "approved",
      approved: true,
      validUntil: null,
    });
    expect(validUntilToPersist).toBeNull();
  });
});
