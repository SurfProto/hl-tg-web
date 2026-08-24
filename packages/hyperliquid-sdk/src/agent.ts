import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const AGENT_KEY_PREFIX = "hl_agent_";
const AGENT_EXPIRY_PREFIX = "hl_agent_expiry_";
const AGENT_APPROVED_AT_PREFIX = "hl_agent_approved_at_";

export function generateAgentKey(): `0x${string}` {
  return generatePrivateKey();
}

export function getAgentAddress(privateKey: `0x${string}`): `0x${string}` {
  return privateKeyToAccount(privateKey).address;
}

export function getStoredAgentKey(userAddress: string): `0x${string}` | null {
  try {
    return localStorage.getItem(
      `${AGENT_KEY_PREFIX}${userAddress.toLowerCase()}`,
    ) as `0x${string}` | null;
  } catch {
    return null;
  }
}

export function storeAgentKey(
  userAddress: string,
  privateKey: `0x${string}`,
): void {
  localStorage.setItem(
    `${AGENT_KEY_PREFIX}${userAddress.toLowerCase()}`,
    privateKey,
  );
}

export function clearStoredAgentKey(userAddress: string): void {
  localStorage.removeItem(`${AGENT_KEY_PREFIX}${userAddress.toLowerCase()}`);
  localStorage.removeItem(`${AGENT_EXPIRY_PREFIX}${userAddress.toLowerCase()}`);
  localStorage.removeItem(
    `${AGENT_APPROVED_AT_PREFIX}${userAddress.toLowerCase()}`,
  );
}

/** Backward-compatible name for callers that only know about stored keys. */
export const clearAgentKey = clearStoredAgentKey;

/**
 * When this key was approved.
 *
 * Persisted rather than held in memory because it bounds how long an agent may
 * be missing from the exchange's list before that counts as revocation, and a
 * window that restarted on every page load would never close.
 */
export function storeAgentApprovedAt(
  userAddress: string,
  approvedAt: number,
): void {
  localStorage.setItem(
    `${AGENT_APPROVED_AT_PREFIX}${userAddress.toLowerCase()}`,
    String(approvedAt),
  );
}

export function getStoredAgentApprovedAt(userAddress: string): number | null {
  try {
    const raw = localStorage.getItem(
      `${AGENT_APPROVED_AT_PREFIX}${userAddress.toLowerCase()}`,
    );
    if (raw === null) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function storeAgentExpiry(userAddress: string, expiryMs: number): void {
  localStorage.setItem(
    `${AGENT_EXPIRY_PREFIX}${userAddress.toLowerCase()}`,
    String(expiryMs),
  );
}

export function getStoredAgentExpiry(userAddress: string): number | null {
  try {
    const raw = localStorage.getItem(
      `${AGENT_EXPIRY_PREFIX}${userAddress.toLowerCase()}`,
    );
    if (raw === null) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function isAgentKeyExpired(userAddress: string): boolean {
  const expiry = getStoredAgentExpiry(userAddress);
  if (expiry === null) return false;
  return Date.now() > expiry;
}

/**
 * The single name every Tsunami API wallet is registered under.
 *
 * Hyperliquid deregisters an existing named API wallet when a new approval
 * arrives under a matching name, so holding this constant is what makes
 * reauthorization replace the previous agent instead of accumulating a second
 * one. An account may hold only a small number of named agents, which is the
 * other reason the name must not vary per approval.
 */
export const TSUNAMI_AGENT_NAME = "tsnm-trade-agent";

/** How long an approval is asked to last. 180 days is the exchange maximum. */
export const AGENT_APPROVAL_WINDOW_MS = 180 * 24 * 60 * 60 * 1000;

/**
 * The `agentName` to send for an approval that should expire at `expiryMs`.
 *
 * ` valid_until <ms>` is a Hyperliquid convention rather than part of the name:
 * the exchange reads it as the approval's expiry and does not treat it as
 * making this a different agent. Approvals default to 90 days without it and
 * may run to 180 with it. Dropping the suffix to "stabilise the name" would
 * therefore quietly halve how long an authorization lasts.
 */
export function buildAgentName(expiryMs: number): string {
  return `${TSUNAMI_AGENT_NAME} valid_until ${expiryMs}`;
}

/**
 * Whether a name returned by `extraAgents` names one of our agents.
 *
 * Which form the exchange echoes back — the bare name, or the whole string
 * including the ` valid_until` suffix — has not been confirmed against a live
 * account, so both are accepted. Getting this wrong in the strict direction
 * would make reconciliation miss an agent that is really there and sign a
 * working account out of trading, which is the worse failure.
 */
export function isTsunamiAgentName(name: string | undefined | null): boolean {
  if (!name) return false;
  const trimmed = name.trim();
  return (
    trimmed === TSUNAMI_AGENT_NAME ||
    trimmed.startsWith(`${TSUNAMI_AGENT_NAME} valid_until `)
  );
}
