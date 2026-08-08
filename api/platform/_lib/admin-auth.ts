import { constantTimeEquals } from "../../_lib/secret-compare";
import { HttpError } from "../../onramp/_lib/http";

/**
 * Gate an operator-only route on the shared admin key.
 *
 * Fails closed when the key is not configured, and compares in constant time so
 * the comparison does not leak a prefix.
 */
export function requirePlatformAdminKey(request: any, expected: string | null) {
  const actual =
    request.headers?.["x-platform-admin-key"] ?? request.headers?.["X-Platform-Admin-Key"];
  if (!expected || !constantTimeEquals(actual, expected)) {
    throw new HttpError(401, "UNAUTHORIZED", "Missing or invalid platform admin key");
  }
}
