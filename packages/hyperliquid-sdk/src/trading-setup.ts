import type {
  AccountState,
  AgentAuthorizationReason,
  ApprovalRequirementState,
} from "@repo/types";
import { isTsunamiAgentName, TSUNAMI_AGENT_NAME } from "./agent";

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
  /**
   * Why `state` reads the way it does. `state` drives the order button;
   * this drives what a user is told when the button is off, and the two
   * are not the same question — "missing" covers a key that was never
   * created and one the exchange has since refused.
   */
  reason: AgentAuthorizationReason;
  /** The name the agent is registered under, when the exchange reported one. */
  name: string | null;
  /** When the local key was approved, which bounds the propagation grace. */
  approvedAt: number | null;
  /**
   * How many *other* agents the exchange lists under our name.
   *
   * Only ever a housekeeping signal, never a reason to stop trading. If our
   * own agent is listed and unexpired the exchange will accept its
   * signatures, so refusing to trade would protect the user from nothing
   * while taking away something that works. What duplicates actually cost is
   * slots against the small per-account limit on named agents, which is worth
   * surfacing and worth reporting — and is the thing to watch to find out
   * whether same-name replacement is really collapsing the way it should.
   */
  duplicateNamedAgents: number;
};

export type RemoteAgent = {
  address?: string;
  name?: string;
  validUntil?: unknown;
};

/**
 * How long an approval may be absent from `extraAgents` before absence is read
 * as revocation.
 *
 * A fresh approval takes a moment to appear, and treating that moment as
 * revocation would send a user back through setup they just finished. Treating
 * it as permission forever is the opposite failure, and the one that used to
 * be here: a key that never once appeared stayed usable indefinitely, so an
 * agent revoked from another device was never noticed until a trade failed.
 */
export const AGENT_PROPAGATION_GRACE_MS = 2 * 60 * 1000;

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
export function reduceAgentApproval(args: {
  localState: AgentApprovalState;
  extraAgents: RemoteAgent[] | null;
  previousState?: AgentApprovalState;
  now: number;
}): { next: AgentApprovalState; validUntilToPersist: number | null } {
  const result = reduceAgentApprovalCore(args);

  // Counted once, here, rather than in each of the branches below: whichever
  // way the reconciliation went, a duplicate is the same observation about the
  // account and it must not change the decision that was already made.
  const duplicateNamedAgents = (args.extraAgents ?? []).filter(
    (agent) =>
      isTsunamiAgentName(agent.name) &&
      agent.address?.toLowerCase() !== result.next.address?.toLowerCase(),
  ).length;

  return {
    ...result,
    next: { ...result.next, duplicateNamedAgents },
  };
}

function reduceAgentApprovalCore({
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
  if (!localState.hasLocalKey || !localState.address) {
    const remoteAgent = extraAgents?.find((agent) =>
      isTsunamiAgentName(agent.name),
    );
    const remoteValidUntil =
      typeof remoteAgent?.validUntil === "number"
        ? remoteAgent.validUntil
        : null;
    const remoteExpired =
      remoteValidUntil != null ? remoteValidUntil <= now : false;

    if (remoteAgent?.address) {
      return {
        next: {
          ...localState,
          address: remoteAgent.address,
          approved: false,
          hasLocalKey: false,
          isExpired: remoteExpired,
          validUntil: remoteValidUntil,
          state: "missing",
          reason: remoteExpired ? "expired" : "remote-only",
          name: remoteAgent.name ?? TSUNAMI_AGENT_NAME,
          remoteConfirmed: !remoteExpired,
          lastVerifiedAt: now,
        },
        validUntilToPersist: null,
      };
    }

    return {
      next: {
        ...localState,
        approved: false,
        state: "missing",
        reason: "missing-local-key",
        lastVerifiedAt: now,
      },
      validUntilToPersist: null,
    };
  }

  if (localState.isExpired) {
    return {
      next: {
        ...localState,
        approved: false,
        state: "missing",
        reason: "expired",
        lastVerifiedAt: now,
      },
      validUntilToPersist: null,
    };
  }

  // The lookup itself failed, so nothing was learned. Keep trading on the last
  // known answer rather than treating an unreachable API as a revoked agent.
  if (extraAgents == null) {
    return {
      next: {
        ...localState,
        state: "stale",
        approved: true,
        reason: "verification-unavailable",
      },
      validUntilToPersist: null,
    };
  }

  const approvedAgent = extraAgents.find(
    (agent) =>
      agent.address?.toLowerCase() === localState.address?.toLowerCase(),
  );
  const validUntil =
    typeof approvedAgent?.validUntil === "number"
      ? approvedAgent.validUntil
      : null;
  const withinGrace =
    localState.approvedAt != null &&
    now - localState.approvedAt <= AGENT_PROPAGATION_GRACE_MS;
  const explicitlyAwaitingPropagation =
    previousState?.reason === "awaiting-propagation" && withinGrace;
  // A duplicate under our name is not a reason to refuse to trade. If our own
  // agent is listed and unexpired the exchange will accept what it signs, so
  // stopping here would disable something that demonstrably works. It is also
  // not necessarily an anomaly: whether Hyperliquid stores the bare name or
  // the whole `valid_until` string is unconfirmed, and if it stores the whole
  // string then every reauthorization leaves its predecessor registered and
  // every account has duplicates by construction. Failing closed on that would
  // put such an account into a reauthorize loop it could never leave. So the
  // count is carried out to the UI and to diagnostics instead.

  if (!approvedAgent) {
    // Our name held by an address that is not ours is not ambiguous: another
    // device approved over this key, and Hyperliquid deregistered it. That is
    // worth more than the absence itself, so it ends the grace immediately.
    const replacedByAnother = extraAgents.some(
      (agent) =>
        isTsunamiAgentName(agent.name) &&
        agent.address?.toLowerCase() !== localState.address?.toLowerCase(),
    );

    // Absent from a list that previously carried it means it really is gone.
    // Absent from the first list we ever read, moments after approving, is
    // more likely propagation delay — but only for as long as that delay
    // plausibly lasts.
    if (
      previousState?.remoteConfirmed ||
      (replacedByAnother && !explicitlyAwaitingPropagation) ||
      !withinGrace
    ) {
      return {
        next: {
          ...localState,
          approved: false,
          state: "missing",
          reason: "revoked-or-replaced",
          remoteConfirmed: false,
          lastVerifiedAt: now,
        },
        validUntilToPersist: null,
      };
    }

    return {
      next: {
        ...localState,
        state: "stale",
        approved: true,
        reason: "awaiting-propagation",
        lastVerifiedAt: previousState?.lastVerifiedAt ?? null,
      },
      validUntilToPersist: null,
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
      reason: remoteExpired ? "expired" : "active",
      name: approvedAgent.name ?? localState.name ?? TSUNAMI_AGENT_NAME,
      remoteConfirmed: !remoteExpired,
      lastVerifiedAt: now,
    },
    validUntilToPersist: validUntil,
  };
}
