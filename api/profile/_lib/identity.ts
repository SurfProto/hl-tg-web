import { fetchWithTimeout } from "../../_lib/fetch-with-timeout";
import { HttpError } from "../../onramp/_lib/http";
import type { ProfileConfig } from "./config";

/**
 * Privy's user lookup, over its REST API rather than @privy-io/node.
 *
 * The SDK was one call — `client.users()._get(id)` — and it cost the whole
 * @hpke crypto chain in the function bundle. Vercel shipped that chain without
 * `@hpke/common/script/src/errors.js`, so `api/profile/bootstrap` died at
 * module load: 28 requests, 28 failures, zero successes in the 24h before this
 * change. That is the route that creates a user's row, so no new user could
 * complete onboarding, and every `/api/account/*` call for them then 401'd.
 *
 * The rest of this codebase already talks to Privy with plain fetch — see the
 * JWKS verification in api/onramp/_lib/auth.ts — so this follows that, and the
 * request below is byte-for-byte what the SDK sent.
 */
const PRIVY_API_BASE_URL = "https://api.privy.io";

/** The SDK's default. Kept so a flaky lookup behaves as it did before. */
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_DELAY_MS = 500;

/**
 * Encode one path segment the way the SDK did: sub-delimiters and `:` stay
 * literal. A Privy id is a DID — `did:privy:abc` — and percent-encoding those
 * colons would change the URL the SDK was requesting.
 */
function encodePathSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9\-._~!$&'()*+,;=:@]+/gu, encodeURIComponent);
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface PrivyLinkedAccount {
  type?: string;
  address?: string;
  chain_type?: string;
  wallet_client_type?: string;
  connector_type?: string;
  verified_at?: string | number | null;
}

interface PrivyUserLike {
  linked_accounts?: PrivyLinkedAccount[];
}

export interface AuthoritativeProfileIdentity {
  walletAddress: string;
  email: string | null;
}

function isEmbeddedEthereumWallet(account: PrivyLinkedAccount) {
  return (
    account.type === "wallet" &&
    account.chain_type === "ethereum" &&
    account.wallet_client_type === "privy" &&
    account.connector_type === "embedded" &&
    typeof account.address === "string" &&
    account.address.trim().length > 0
  );
}

function isVerifiedEmail(account: PrivyLinkedAccount) {
  return (
    account.type === "email" &&
    typeof account.address === "string" &&
    account.address.trim().length > 0 &&
    typeof account.verified_at === "number"
  );
}

export function identityFromPrivyUser(user: PrivyUserLike): AuthoritativeProfileIdentity {
  const accounts = user.linked_accounts ?? [];
  const wallet = accounts.find(isEmbeddedEthereumWallet);
  if (!wallet?.address) {
    throw new HttpError(
      409,
      "EMBEDDED_WALLET_REQUIRED",
      "Create an embedded Ethereum wallet before completing onboarding",
    );
  }

  const email = accounts.find(isVerifiedEmail)?.address?.trim().toLowerCase() ?? null;

  return {
    walletAddress: wallet.address.trim(),
    email,
  };
}

export async function fetchPrivyUser(
  config: ProfileConfig,
  privyUserId: string,
  options: { maxRetries?: number; retryDelayMs?: number } = {},
): Promise<PrivyUserLike> {
  if (!privyUserId) {
    throw new Error("Privy user id must not be empty");
  }

  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  const url = `${PRIVY_API_BASE_URL}/v1/users/${encodePathSegment(privyUserId)}`;
  const credentials = Buffer.from(
    `${config.privyAppId}:${config.privyAppSecret}`,
  ).toString("base64");

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    if (attempt > 0) {
      await sleep(retryDelayMs * 2 ** (attempt - 1));
    }

    let response: Response;
    try {
      response = await fetchWithTimeout(url, {
        headers: {
          Authorization: `Basic ${credentials}`,
          "privy-app-id": config.privyAppId,
        },
      });
    } catch (error) {
      // A timeout or a dropped connection. Retry it the way the SDK did.
      lastError = error;
      if (attempt < maxRetries) continue;
      throw error;
    }

    if (!response.ok) {
      const body = await response.text();
      lastError = new Error(
        `Privy user lookup failed: ${response.status} ${body}`,
      );
      if (isRetryableStatus(response.status) && attempt < maxRetries) continue;
      throw lastError;
    }

    const rawBody = await response.text();
    try {
      return JSON.parse(rawBody) as PrivyUserLike;
    } catch {
      // Naming the endpoint beats a bare SyntaxError from deep in a parser.
      throw new Error("Privy returned invalid JSON for the user lookup");
    }
  }

  throw lastError;
}

export async function resolveAuthoritativeProfileIdentity(
  config: ProfileConfig,
  privyUserId: string,
): Promise<AuthoritativeProfileIdentity> {
  return identityFromPrivyUser(await fetchPrivyUser(config, privyUserId));
}
