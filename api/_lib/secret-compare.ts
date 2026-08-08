import { timingSafeEqual } from "node:crypto";

/**
 * Compare a caller-supplied secret against the expected value in constant time.
 *
 * Plain `!==` on an API key or bearer token leaks how long a shared prefix is
 * through timing. Length is not hidden — timingSafeEqual requires equal-length
 * buffers — but the contents are.
 */
export function constantTimeEquals(actual: unknown, expected: string): boolean {
  const candidate = Array.isArray(actual) ? actual[0] : actual;
  if (typeof candidate !== "string") {
    return false;
  }

  const actualBuffer = Buffer.from(candidate, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  return (
    actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer)
  );
}
