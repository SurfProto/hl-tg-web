import { timingSafeEqual } from "node:crypto";

import { HttpError } from "../../onramp/_lib/http";

function constantTimeEquals(actual: unknown, expected: string): boolean {
  if (typeof actual !== "string") return false;
  const actualBuffer = Buffer.from(actual, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  return (
    actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

/**
 * Gate an operator-only route on the shared admin key.
 *
 * Fails closed when the key is not configured, and compares in constant time
 * so the comparison does not leak a prefix.
 */
export function requirePlatformAdminKey(request: any, expected: string | null) {
  const actual = request.headers?.["x-platform-admin-key"] ?? request.headers?.["X-Platform-Admin-Key"];
  if (!expected || !constantTimeEquals(Array.isArray(actual) ? actual[0] : actual, expected)) {
    throw new HttpError(401, "UNAUTHORIZED", "Missing or invalid platform admin key");
  }
}
