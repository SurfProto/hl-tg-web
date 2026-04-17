import { createPublicKey, createVerify, type KeyObject } from "node:crypto";

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
const jwksCache = new Map<string, { expiresAt: number; keys: JsonWebKey[] }>();

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

function assertPayloadClaims(payload: PrivyJwtPayload, expectedAppId: string | null) {
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
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : JWKS_TTL_MS;
}

async function fetchJwks(jwksUrl: string): Promise<JsonWebKey[]> {
  const cached = jwksCache.get(jwksUrl);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.keys;
  }

  const response = await fetch(jwksUrl);
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

function getVerificationKeyFromJwks(header: PrivyJwtHeader, keys: JsonWebKey[]): KeyObject {
  const jwk =
    (header.kid
      ? keys.find((candidate) => candidate.kid === header.kid)
      : keys.length === 1
        ? keys[0]
        : undefined) ?? null;

  if (!jwk) {
    throw new HttpError(401, "UNAUTHORIZED", "Missing or invalid access token");
  }

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

  const keys = await fetchJwks(jwksUrl);
  return getVerificationKeyFromJwks(header, keys);
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
