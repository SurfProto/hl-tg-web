import type { AgentAuthorizationError } from "./exchange-response";

/**
 * Where a refused trading authorization goes so the app can offer to fix it.
 *
 * The refusal is raised inside a client that knows nothing about React, from
 * eleven different call sites, and it has to reach a sheet the user can see no
 * matter which screen they were on. Threading that through eleven mutations
 * would mean eleven chances to forget one, and the one that got forgotten
 * would look to a user like a trade that silently did nothing.
 *
 * So it is a module singleton with a subscription, deliberately: one writer,
 * any number of readers, no ordering requirement between the throw and the
 * mount. The last incident is retained so a subscriber that mounts after the
 * failure — a route that was still loading — still sees it.
 */

export type AgentRecoveryIncident = {
  /** The trading action that was refused. It did not execute. */
  action: string;
  /** The master account this incident belongs to. Never shown or reported. */
  accountAddress: string;
  /** The agent the exchange refused, in full. Local display only. */
  agentAddress: string | null;
  /** What the exchange actually said, for the details pane. */
  exchangeMessage: string;
  /** The already user-facing summary, carrying no address. */
  message: string;
  /** Whether an earlier stage may already have changed the account. */
  outcome: AgentAuthorizationError["outcome"];
  occurredAt: number;
};

type Listener = (incident: AgentRecoveryIncident) => void;

const listeners = new Set<Listener>();
let lastIncident: AgentRecoveryIncident | null = null;

export function reportAgentRecoveryIncident(
  error: AgentAuthorizationError,
): AgentRecoveryIncident {
  const incident: AgentRecoveryIncident = {
    action: error.action,
    accountAddress: error.accountAddress,
    agentAddress: error.agentAddress,
    exchangeMessage: error.exchangeMessage,
    message: error.message,
    outcome: error.outcome,
    occurredAt: error.occurredAt,
  };
  lastIncident = incident;

  for (const listener of listeners) {
    // One subscriber throwing must not stop the others from being told, and
    // must not replace the original trading error on its way to the caller.
    try {
      listener(incident);
    } catch {
      // ignored on purpose
    }
  }

  return incident;
}

export function subscribeToAgentRecovery(
  listener: Listener,
  accountAddress?: string | null,
): () => void {
  const scopedListener: Listener = accountAddress
    ? (incident) => {
        if (
          incident.accountAddress.toLowerCase() === accountAddress.toLowerCase()
        ) {
          listener(incident);
        }
      }
    : listener;
  listeners.add(scopedListener);
  return () => {
    listeners.delete(scopedListener);
  };
}

export function getLastAgentRecoveryIncident(
  accountAddress?: string | null,
): AgentRecoveryIncident | null {
  if (
    accountAddress &&
    lastIncident?.accountAddress.toLowerCase() !== accountAddress.toLowerCase()
  ) {
    return null;
  }
  return lastIncident;
}

/** Called when the user dismisses or resolves the incident. */
export function clearAgentRecoveryIncident(
  accountAddress?: string | null,
): void {
  if (
    accountAddress &&
    lastIncident?.accountAddress.toLowerCase() !== accountAddress.toLowerCase()
  ) {
    return;
  }
  lastIncident = null;
}

export function __resetAgentRecoveryForTests(): void {
  listeners.clear();
  lastIncident = null;
}
