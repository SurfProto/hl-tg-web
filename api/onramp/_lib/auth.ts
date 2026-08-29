import {
  createPublicKey,
  createVerify,
  type JsonWebKey,
  type KeyObject,
} from "node:crypto";

import { fetchWithTimeout } from "../../_lib/fetch-with-timeout";
import { enforceRateLimit, getRequestIp } from "../../market/_lib/rate-limit";
import { HttpError } from "./http";

interface PrivyJwtHeader {
  alg?: string;
  kid?: string;
  typ?: string;
}

interface PrivyJwtPayload {
  sub?: string;
  iss?: string;
  aud?: string | string[];
  exp?: number;
  nbf?: number;
}

interface JwksResponse {
  keys?: JsonWebKey[];
}

export interface PrivySession {
  accessToken: string;
  privyUserId: string;
  payload: PrivyJwtPayload;
}

const JWKS_TTL_MS = 5 * 60 * 1000;
// Cap whatever Cache-Control the JWKS endpoint sends. Honouring a long max-age
// means a Privy key rotation locks every user out until the cache expires.
const JWKS_MAX_TTL_MS = 10 * 60 * 1000;
// The unknown-kid refetch happens at most once a minute per URL. An unknown
// kid is either a genuine rotation — one refetch repopulates the cache for
// everyone — or an attacker-minted token, and unthrottled, each such token
// bought an outbound request to Privy: an unauthenticated lever to get our
// JWKS access rate-limited and real users 401'd. During a genuine rotation
// under attack, the normal TTL expiry still repopulates the cache.
const JWKS_FORCED_REFRESH_COOLDOWN_MS = 60 * 1000;
const jwksCache = new Map<string, { expiresAt: number; keys: JsonWebKey[] }>();
const jwksForcedRefreshAt = new Map<string, number>();

function decodeBase64Url(value: string): Buffer {
  return Buffer.from(value, "base64url");
}

function parseJsonSegment<T>(segment: string): T {
  try {
    return JSON.parse(decodeBase64Url(segment).toString("utf8")) as T;
  } catch {
    throw new HttpError(401, "UNAUTHORIZED", "Missing or invalid access token");
  }
}

function parseBearerToken(request: any): string {
  const header = request.headers.authorization ?? request.headers.Authorization;
  if (!header || typeof header !== "string" || !header.startsWith("Bearer ")) {
    throw new HttpError(401, "UNAUTHORIZED", "Missing or invalid authorization header");
  }

  const accessToken = header.slice("Bearer ".length).trim();
  if (!accessToken) {
    throw new HttpError(401, "UNAUTHORIZED", "Missing or invalid access token");
  }

  return accessToken;
}

function hasExpectedAudience(payload: PrivyJwtPayload, expectedAppId: string | null): boolean {
  if (!expectedAppId) {
    return true;
  }

  if (Array.isArray(payload.aud)) {
    return payload.aud.includes(expectedAppId);
  }

  return payload.aud === expectedAppId;
}

function assertPayloadClaims(
  payload: PrivyJwtPayload,
  expectedAppId: string | null,
): asserts payload is PrivyJwtPayload & { sub: string } {
  const now = Math.floor(Date.now() / 1000);
  const validIssuer = payload.iss === "privy.io" || payload.iss === "https://auth.privy.io";

  if (
    !validIssuer ||
    !payload.sub ||
    !hasExpectedAudience(payload, expectedAppId) ||
    typeof payload.exp !== "number" ||
    payload.exp <= now ||
    (typeof payload.nbf === "number" && payload.nbf > now)
  ) {
    throw new HttpError(401, "UNAUTHORIZED", "Missing or invalid access token");
  }
}

function getMaxAgeMs(cacheControl: string | null): number {
  const match = cacheControl?.match(/max-age=(\d+)/i);
  if (!match) {
    return JWKS_TTL_MS;
  }

  const seconds = Number(match[1]);
  const requested = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : JWKS_TTL_MS;
  return Math.min(requested, JWKS_MAX_TTL_MS);
}

async function fetchJwks(jwksUrl: string, forceRefresh = false): Promise<JsonWebKey[]> {
  const cached = jwksCache.get(jwksUrl);
  if (!forceRefresh && cached && cached.expiresAt > Date.now()) {
    return cached.keys;
  }

  const response = await fetchWithTimeout(jwksUrl);
  if (!response.ok) {
    throw new HttpError(500, "PRIVY_AUTH_MISCONFIGURED", "Privy JWKS request failed");
  }

  let payload: JwksResponse;
  try {
    payload = (await response.json()) as JwksResponse;
  } catch {
    throw new HttpError(500, "PRIVY_AUTH_MISCONFIGURED", "Privy JWKS response was not valid JSON");
  }

  if (!Array.isArray(payload.keys) || payload.keys.length === 0) {
    throw new HttpError(500, "PRIVY_AUTH_MISCONFIGURED", "Privy JWKS response did not include any signing keys");
  }

  jwksCache.set(jwksUrl, {
    keys: payload.keys,
    expiresAt: Date.now() + getMaxAgeMs(response.headers.get("cache-control")),
  });

  return payload.keys;
}

function findJwk(header: PrivyJwtHeader, keys: JsonWebKey[]): JsonWebKey | null {
  if (header.kid) {
    return keys.find((candidate) => candidate.kid === header.kid) ?? null;
  }

  return keys.length === 1 ? keys[0] : null;
}

function importJwk(jwk: JsonWebKey): KeyObject {
  try {
    return createPublicKey({ key: jwk, format: "jwk" });
  } catch {
    throw new HttpError(500, "PRIVY_AUTH_MISCONFIGURED", "Privy JWKS key could not be imported");
  }
}

function getVerificationKeyFromPem(verificationKey: string): KeyObject {
  try {
    return createPublicKey(verificationKey);
  } catch {
    throw new HttpError(500, "PRIVY_AUTH_MISCONFIGURED", "Privy verification key could not be imported");
  }
}

async function getVerificationKey(header: PrivyJwtHeader): Promise<KeyObject> {
  const verificationKey = process.env.PRIVY_VERIFICATION_KEY?.trim();
  if (verificationKey) {
    return getVerificationKeyFromPem(verificationKey);
  }

  const jwksUrl = process.env.PRIVY_JWKS_URL?.trim();
  if (!jwksUrl) {
    throw new HttpError(
      500,
      "PRIVY_AUTH_MISCONFIGURED",
      "Missing Privy verification configuration",
    );
  }

  const jwk = findJwk(header, await fetchJwks(jwksUrl));
  if (jwk) {
    return importJwk(jwk);
  }

  // Unknown kid usually means Privy rotated its signing keys since we cached
  // the set. Refetch once before rejecting, otherwise every request 401s until
  // the cache expires — but at most once per cooldown window, or every
  // garbage kid costs an outbound request (see JWKS_FORCED_REFRESH_COOLDOWN_MS).
  const lastForcedAt = jwksForcedRefreshAt.get(jwksUrl) ?? 0;
  if (Date.now() - lastForcedAt < JWKS_FORCED_REFRESH_COOLDOWN_MS) {
    throw new HttpError(401, "UNAUTHORIZED", "Missing or invalid access token");
  }
  // Stamped before the await so a concurrent burst shares this one refetch.
  jwksForcedRefreshAt.set(jwksUrl, Date.now());

  const rotated = findJwk(header, await fetchJwks(jwksUrl, true));
  if (!rotated) {
    throw new HttpError(401, "UNAUTHORIZED", "Missing or invalid access token");
  }

  return importJwk(rotated);
}

function verifyJwtSignature(accessToken: string, key: KeyObject) {
  const parts = accessToken.split(".");
  if (parts.length !== 3) {
    throw new HttpError(401, "UNAUTHORIZED", "Missing or invalid access token");
  }

  const verifier = createVerify("SHA256");
  verifier.update(`${parts[0]}.${parts[1]}`);
  verifier.end();

  let signature: Buffer;
  try {
    signature = decodeBase64Url(parts[2]);
  } catch {
    throw new HttpError(401, "UNAUTHORIZED", "Missing or invalid access token");
  }

  const valid = verifier.verify(
    {
      key,
      dsaEncoding: "ieee-p1363",
    },
    signature,
  );

  if (!valid) {
    throw new HttpError(401, "UNAUTHORIZED", "Missing or invalid access token");
  }
}

export async function requirePrivySession(request: any, expectedAppId: string | null): Promise<PrivySession> {
  // Per-IP, before any parsing or signature work, so a flood burns the limit
  // rather than CPU and JWKS traffic. This is the one gate every
  // Privy-authenticated route passes through — rewards, profile, onramp and
  // notifications carried no rate limit at all, while the account and market
  // routes had theirs (120 and 240 a minute) from the start. Fails open like
  // those do: an unreachable Redis must not become a full outage.
  await enforceRateLimit({
    scope: "privy-auth",
    id: getRequestIp(request),
    limit: 120,
  });

  const accessToken = parseBearerToken(request);
  const parts = accessToken.split(".");
  if (parts.length !== 3) {
    throw new HttpError(401, "UNAUTHORIZED", "Missing or invalid access token");
  }

  const header = parseJsonSegment<PrivyJwtHeader>(parts[0]);
  if (header.alg !== "ES256") {
    throw new HttpError(401, "UNAUTHORIZED", "Missing or invalid access token");
  }

  const key = await getVerificationKey(header);
  verifyJwtSignature(accessToken, key);

  const payload = parseJsonSegment<PrivyJwtPayload>(parts[1]);
  assertPayloadClaims(payload, expectedAppId);

  return {
    accessToken,
    privyUserId: payload.sub,
    payload,
  };
}
