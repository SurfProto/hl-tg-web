import { fetchWithTimeout } from "../../_lib/fetch-with-timeout";

// Redis is on the hot path of every request, so it gets a tighter deadline than
// the general upstream default — a slow cache must never become a slow API.
const REDIS_TIMEOUT_MS = 1_500;

interface StoredValue {
  value: string;
  expiresAt: number | null;
}

const memoryStore = new Map<string, StoredValue>();

function now() {
  return Date.now();
}

let warnedAboutMissingRedis = false;

function getRedisConfig() {
  const url =
    process.env.UPSTASH_REDIS_REST_URL?.trim() ||
    process.env.KV_REST_API_URL?.trim();
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN?.trim() ||
    process.env.KV_REST_API_TOKEN?.trim();

  if (!url || !token) {
    // The in-memory fallback is per-instance. In serverless that makes the
    // cache useless and the rate limiter trivially bypassable by spreading
    // requests across instances, so make the misconfiguration visible instead
    // of silently degrading.
    if (process.env.NODE_ENV === "production" && !warnedAboutMissingRedis) {
      warnedAboutMissingRedis = true;
      console.error(
        "Redis is not configured (UPSTASH_REDIS_REST_URL/TOKEN or KV_REST_API_URL/TOKEN). " +
          "Falling back to per-instance memory: caching and rate limiting are not effective.",
      );
    }
    return null;
  }

  return { url, token };
}

/**
 * A cache must not be able to take down the endpoint it accelerates.
 *
 * Redis being *absent* already degraded to memory, but Redis being present and
 * unreachable threw straight out of readThroughCache and 500'd the request —
 * which is the failure that actually happens in production. A stale
 * UPSTASH_REDIS_REST_URL pointing at a deleted database (ENOTFOUND) took every
 * market and account route down.
 *
 * Errors are surfaced in the logs but never to the caller: reads report a miss,
 * writes are dropped, and the request continues against upstream.
 */
class RedisUnavailableError extends Error {}

let redisFailures = 0;
const REDIS_FAILURE_LOG_LIMIT = 3;

function noteRedisFailure(operation: string, error: unknown) {
  redisFailures += 1;
  // Log the first few per instance rather than once per request; a broken cache
  // on a hot path would otherwise flood the logs.
  if (redisFailures <= REDIS_FAILURE_LOG_LIMIT) {
    const reason = error instanceof Error ? (error.message ?? String(error)) : String(error);
    const cause = (error as { cause?: { message?: string } })?.cause?.message;
    console.error(
      `Redis ${operation} failed; continuing without cache: ${reason}` +
        (cause ? ` (${cause})` : "") +
        (redisFailures === REDIS_FAILURE_LOG_LIMIT ? " [further Redis errors suppressed]" : ""),
    );
  }
}

async function redisCommand<T = unknown>(command: unknown[]): Promise<T | null> {
  const config = getRedisConfig();
  if (!config) {
    return null;
  }

  let response: Response;
  try {
    response = await fetchWithTimeout(
      config.url,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(command),
      },
      REDIS_TIMEOUT_MS,
    );
  } catch (error) {
    noteRedisFailure(String(command[0]), error);
    throw new RedisUnavailableError("Redis is unreachable");
  }

  if (!response.ok) {
    noteRedisFailure(String(command[0]), new Error(`HTTP ${response.status}`));
    throw new RedisUnavailableError(`Redis command failed: ${response.status}`);
  }

  const payload = (await response.json()) as { result?: T; error?: string };
  if (payload.error) {
    noteRedisFailure(String(command[0]), new Error(payload.error));
    throw new RedisUnavailableError(payload.error);
  }

  return payload.result ?? null;
}

/** Run a Redis command, degrading to `fallback` if the server is unreachable. */
async function tolerate<T>(operation: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof RedisUnavailableError) {
      return fallback;
    }
    throw error;
  }
}

function readMemory(key: string): string | null {
  const entry = memoryStore.get(key);
  if (!entry) return null;
  if (entry.expiresAt != null && entry.expiresAt <= now()) {
    memoryStore.delete(key);
    return null;
  }

  return entry.value;
}

function writeMemory(key: string, value: string, ttlSeconds?: number) {
  memoryStore.set(key, {
    value,
    expiresAt: ttlSeconds ? now() + ttlSeconds * 1000 : null,
  });
}

export async function redisGet(key: string): Promise<{ value: string | null; source: "memory" | "redis" }> {
  const config = getRedisConfig();
  if (!config) {
    return { value: readMemory(key), source: "memory" };
  }

  // An unreachable cache reads as a miss, so the caller goes upstream.
  const value = await tolerate(() => redisCommand<string>(["GET", key]), null);
  return { value, source: "redis" };
}

export async function redisSet(key: string, value: string, ttlSeconds?: number) {
  const config = getRedisConfig();
  if (!config) {
    writeMemory(key, value, ttlSeconds);
    return;
  }

  // A write we cannot make just means the next read is a miss.
  await tolerate(
    () =>
      ttlSeconds && ttlSeconds > 0
        ? redisCommand(["SET", key, value, "EX", ttlSeconds])
        : redisCommand(["SET", key, value]),
    null,
  );
}

export async function redisSetNx(key: string, value: string, ttlSeconds: number): Promise<boolean> {
  const config = getRedisConfig();
  if (!config) {
    if (readMemory(key) != null) return false;
    writeMemory(key, value, ttlSeconds);
    return true;
  }

  // Fall back to "acquired". Without Redis there is no cross-instance
  // coordination anyway, and reporting failure would send every caller down the
  // RetryableCacheMiss path and turn a degraded cache into a 503.
  const result = await tolerate(
    () => redisCommand<string>(["SET", key, value, "NX", "EX", ttlSeconds]),
    "OK" as string | null,
  );
  return result === "OK";
}

export async function redisDel(key: string) {
  const config = getRedisConfig();
  if (!config) {
    memoryStore.delete(key);
    return;
  }

  await tolerate(() => redisCommand(["DEL", key]), null);
}

/**
 * Delete a key only if it still holds the value we wrote.
 *
 * Used to release cache locks. An unconditional DEL lets a slow refresh whose
 * lock already expired delete the lock a *different* request has since taken,
 * which collapses the stampede protection exactly when load is highest.
 */
export async function redisDelIfMatches(key: string, expectedValue: string): Promise<boolean> {
  const config = getRedisConfig();
  if (!config) {
    if (readMemory(key) !== expectedValue) return false;
    memoryStore.delete(key);
    return true;
  }

  const script = `if redis.call("GET", KEYS[1]) == ARGV[1] then return redis.call("DEL", KEYS[1]) else return 0 end`;
  // Releasing a lock we cannot reach is a no-op; the TTL will clear it.
  const result = await tolerate(
    () => redisCommand<number>(["EVAL", script, "1", key, expectedValue]),
    0 as number | null,
  );
  return result === 1;
}

export async function redisIncrWithTtl(key: string, ttlSeconds: number): Promise<number> {
  const config = getRedisConfig();
  if (!config) {
    const entry = memoryStore.get(key);
    const expired = entry?.expiresAt != null && entry.expiresAt <= now();
    const current = expired || !entry ? 1 : Number(entry.value) + 1;
    memoryStore.set(key, {
      value: String(current),
      // Keep the original deadline so a steady request stream cannot push the
      // window out indefinitely.
      expiresAt: expired || !entry ? now() + ttlSeconds * 1000 : entry.expiresAt,
    });
    return current;
  }

  // INCR then EXPIRE as separate round trips leaves a TTL-less key behind if
  // the second call never lands. One script keeps them together.
  const script = `local count = redis.call("INCR", KEYS[1]) if count == 1 then redis.call("EXPIRE", KEYS[1], ARGV[1]) end return count`;
  // Deliberately fails open: an unreachable Redis returns 0, so enforceRateLimit
  // lets the request through rather than rejecting all traffic. Authentication
  // still applies on every protected route; the alternative is a cache outage
  // becoming a full outage.
  const count = await tolerate(
    () => redisCommand<number>(["EVAL", script, "1", key, String(ttlSeconds)]),
    0 as number | null,
  );
  return count ?? 0;
}

export function __resetRedisMemoryForTests() {
  memoryStore.clear();
}
