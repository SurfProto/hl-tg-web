interface StoredValue {
  value: string;
  expiresAt: number | null;
}

const memoryStore = new Map<string, StoredValue>();

function now() {
  return Date.now();
}

function getRedisConfig() {
  const url =
    process.env.UPSTASH_REDIS_REST_URL?.trim() ||
    process.env.KV_REST_API_URL?.trim();
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN?.trim() ||
    process.env.KV_REST_API_TOKEN?.trim();
  return url && token ? { url, token } : null;
}

async function redisCommand<T = unknown>(command: unknown[]): Promise<T | null> {
  const config = getRedisConfig();
  if (!config) {
    return null;
  }

  const response = await fetch(config.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
  });

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

export async function redisIncrWithTtl(key: string, ttlSeconds: number): Promise<number> {
  const config = getRedisConfig();
  if (!config) {
    const current = Number(readMemory(key) ?? "0") + 1;
    writeMemory(key, String(current), ttlSeconds);
    return current;
  }

  const count = await redisCommand<number>(["INCR", key]);
  if (count === 1) {
    await redisCommand(["EXPIRE", key, ttlSeconds]);
  }
  return count ?? 0;
}

export function __resetRedisMemoryForTests() {
  memoryStore.clear();
}
