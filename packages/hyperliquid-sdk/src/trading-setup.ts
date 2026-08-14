import type { AccountState, ApprovalRequirementState } from "@repo/types";

/**
 * Whether the app believes an account can trade, extracted from hooks.ts.
 *
 * Three approvals gate the order button — the agent key, the builder fee and
 * unified mode — and each is known locally, remotely, or not at all. The
 * distinction that matters is "missing" versus "stale": missing sends the user
 * back through setup, stale means a check failed and the last known answer
 * stands. Reading a transient API failure as missing signs a working account
 * out of trading.
 */

export type UnifiedApprovalState = {
  enabled: boolean;
  abstractionMode: AccountState["abstractionMode"];
};

export type AgentApprovalState = {
  address: string | null;
  approved: boolean;
  hasLocalKey: boolean;
  isExpired: boolean;
  validUntil: number | null;
  state: ApprovalRequirementState;
  remoteConfirmed: boolean;
  lastVerifiedAt: number | null;
};

export type RemoteAgent = {
  address?: string;
  validUntil?: unknown;
};

export function getBuilderApprovalState(
  feeTenthsBp: number | undefined,
  isError: boolean,
  builderConfigured: boolean,
): ApprovalRequirementState {
  // Nothing to approve when no builder is configured at all.
  if (!builderConfigured) return "approved";
  if (typeof feeTenthsBp === "number") {
    return feeTenthsBp > 0 ? "approved" : "missing";
  }
  return isError ? "stale" : "checking";
}

export function getUnifiedApprovalRequirementState(
  approval: UnifiedApprovalState | undefined,
  isError: boolean,
): ApprovalRequirementState {
  if (approval) {
    return approval.enabled ? "approved" : "missing";
  }
  return isError ? "stale" : "checking";
}

/**
 * Reconcile the locally stored agent key against the exchange's list of
 * approved agents.
 *
 * `extraAgents` is null when that call failed. `validUntilToPersist` is
 * returned rather than written so this stays pure; the caller stores it.
 */
export function reduceAgentApproval({
  localState,
  extraAgents,
  previousState,
  now,
}: {
  localState: AgentApprovalState;
  extraAgents: RemoteAgent[] | null;
  previousState?: AgentApprovalState;
  now: number;
}): { next: AgentApprovalState; validUntilToPersist: number | null } {
  if (!localState.hasLocalKey || localState.isExpired || !localState.address) {
    return {
      next: {
        ...localState,
        approved: false,
        state: "missing",
        lastVerifiedAt: now,
      },
      validUntilToPersist: null,
    };
  }

  // The lookup itself failed, so nothing was learned. Keep trading on the last
  // known answer rather than treating an unreachable API as a revoked agent.
  if (extraAgents == null) {
    return {
      next: { ...localState, state: "stale", approved: true },
      validUntilToPersist: null,
    };
  }

  const approvedAgent = extraAgents.find(
    (agent) => agent.address?.toLowerCase() === localState.address?.toLowerCase(),
  );
  const validUntil =
    typeof approvedAgent?.validUntil === "number"
      ? approvedAgent.validUntil
      : null;

  if (!approvedAgent) {
    // Absent from a list that previously carried it means it really is gone.
    // Absent from the first list we ever read is more likely propagation delay
    // right after approval, so the key stays usable and unconfirmed.
    if (previousState?.remoteConfirmed) {
      return {
        next: {
          ...localState,
          approved: false,
          state: "missing",
          remoteConfirmed: false,
          lastVerifiedAt: now,
        },
        validUntilToPersist: validUntil,
      };
    }

    return {
      next: {
        ...localState,
        state: "stale",
        approved: true,
        lastVerifiedAt: previousState?.lastVerifiedAt ?? null,
      },
      validUntilToPersist: validUntil,
    };
  }

  const remoteExpired = validUntil != null ? validUntil <= now : false;

  return {
    next: {
      ...localState,
      approved: !remoteExpired,
      hasLocalKey: true,
      isExpired: remoteExpired,
      validUntil,
      state: remoteExpired ? "missing" : "approved",
      remoteConfirmed: !remoteExpired,
      lastVerifiedAt: now,
    },
    validUntilToPersist: validUntil,
  };
}
