import { describe, expect, it } from "vitest";

import {
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
  remoteConfirmed: false,
  lastVerifiedAt: null,
};

describe("getBuilderApprovalState", () => {
  it("has nothing to approve when no builder is configured", () => {
    expect(getBuilderApprovalState(undefined, false, false)).toBe("approved");
    expect(getBuilderApprovalState(0, true, false)).toBe("approved");
  });

  it("reads a positive fee as approval and zero as missing", () => {
    expect(getBuilderApprovalState(10, false, true)).toBe("approved");
    expect(getBuilderApprovalState(0, false, true)).toBe("missing");
  });

  it("separates a failed check from a completed one", () => {
    expect(getBuilderApprovalState(undefined, false, true)).toBe("checking");
    expect(getBuilderApprovalState(undefined, true, true)).toBe("stale");
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
    expect(getUnifiedApprovalRequirementState(undefined, false)).toBe("checking");
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

  it("treats a listed agent with no expiry as approved", () => {
    const { next, validUntilToPersist } = reduceAgentApproval({
      localState: localApproved,
      extraAgents: [{ address: "0xAgent" }],
      now: NOW,
    });

    expect(next).toMatchObject({ state: "approved", approved: true, validUntil: null });
    expect(validUntilToPersist).toBeNull();
  });
});
