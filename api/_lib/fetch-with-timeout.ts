/**
 * Every outbound call from a serverless function needs a deadline.
 *
 * Without one, a hung upstream holds the function open until the platform
 * timeout. That is expensive on Fluid Compute, and it breaks the market cache:
 * readThroughCache holds a 5s Redis lock while it refreshes, so a fetch that
 * outlives the lock lets a second request take the lock and the stampede
 * protection stops working. Keep DEFAULT_TIMEOUT_MS below CACHE_LOCK_SECONDS.
 */
export const DEFAULT_TIMEOUT_MS = 4_000;

export class UpstreamTimeoutError extends Error {
  constructor(url: string, timeoutMs: number) {
    super(`Upstream request timed out after ${timeoutMs}ms`);
    this.name = "UpstreamTimeoutError";
    this.url = url;
    this.timeoutMs = timeoutMs;
  }

  url: string;
  timeoutMs: number;
}

export async function fetchWithTimeout(
  input: string | URL,
  init: RequestInit = {},
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  // Compose with any caller-supplied signal so an outer abort still wins.
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = init.signal
    ? AbortSignal.any([init.signal, timeoutSignal])
    : timeoutSignal;

  try {
    return await fetch(input, { ...init, signal });
  } catch (error) {
    if (timeoutSignal.aborted) {
      throw new UpstreamTimeoutError(String(input), timeoutMs);
    }
    throw error;
  }
}
