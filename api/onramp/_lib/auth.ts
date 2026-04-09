import { HttpError } from "./http";

interface PrivyJwtPayload {
  sub?: string;
  iss?: string;
  aud?: string | string[];
}

export interface PrivySession {
  accessToken: string;
  privyUserId: string;
  payload: PrivyJwtPayload;
}

function decodeBase64Url(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

function parseJwt(accessToken: string): PrivyJwtPayload {
  const parts = accessToken.split(".");
  if (parts.length < 2) {
    throw new HttpError(401, "UNAUTHORIZED", "Missing or invalid access token");
  }

  try {
    return JSON.parse(decodeBase64Url(parts[1])) as PrivyJwtPayload;
  } catch {
    throw new HttpError(401, "UNAUTHORIZED", "Missing or invalid access token");
  }
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

export function requirePrivySession(request: any, expectedAppId: string | null): PrivySession {
  const header = request.headers.authorization ?? request.headers.Authorization;
  if (!header || typeof header !== "string" || !header.startsWith("Bearer ")) {
    throw new HttpError(401, "UNAUTHORIZED", "Missing or invalid authorization header");
  }

  const accessToken = header.slice("Bearer ".length).trim();
  const payload = parseJwt(accessToken);
  const validIssuer = payload.iss === "privy.io" || payload.iss === "https://auth.privy.io";

  // TODO: Replace payload-only validation with JWKS signature verification in the KYC phase.
  if (!validIssuer || !payload.sub || !hasExpectedAudience(payload, expectedAppId)) {
    throw new HttpError(401, "UNAUTHORIZED", "Missing or invalid access token");
  }

  return {
    accessToken,
    privyUserId: payload.sub,
    payload,
  };
}
