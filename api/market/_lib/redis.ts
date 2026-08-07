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

async function redisCommand<T = unknown>(command: unknown[]): Promise<T | null> {
  const config = getRedisConfig();
  if (!config) {
    return null;
  }

  const response = await fetchWithTimeout(
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

  if (!response.ok) {
    throw new Error(`Redis command failed: ${response.status}`);
  }

  const payload = (await response.json()) as { result?: T; error?: string };
  if (payload.error) {
    throw new Error(payload.error);
  }

  return payload.result ?? null;
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

  const value = await redisCommand<string>(["GET", key]);
  return { value, source: "redis" };
}

export async function redisSet(key: string, value: string, ttlSeconds?: number) {
  const config = getRedisConfig();
  if (!config) {
    writeMemory(key, value, ttlSeconds);
    return;
  }

  if (ttlSeconds && ttlSeconds > 0) {
    await redisCommand(["SET", key, value, "EX", ttlSeconds]);
    return;
  }

  await redisCommand(["SET", key, value]);
}

export async function redisSetNx(key: string, value: string, ttlSeconds: number): Promise<boolean> {
  const config = getRedisConfig();
  if (!config) {
    if (readMemory(key) != null) return false;
    writeMemory(key, value, ttlSeconds);
    return true;
  }

  const result = await redisCommand<string>(["SET", key, value, "NX", "EX", ttlSeconds]);
  return result === "OK";
}

export async function redisDel(key: string) {
  const config = getRedisConfig();
  if (!config) {
    memoryStore.delete(key);
    return;
  }

  await redisCommand(["DEL", key]);
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
  const result = await redisCommand<number>(["EVAL", script, "1", key, expectedValue]);
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
  const count = await redisCommand<number>(["EVAL", script, "1", key, String(ttlSeconds)]);
  return count ?? 0;
}

export function __resetRedisMemoryForTests() {
  memoryStore.clear();
}
