import { createHash } from "node:crypto";

import { HttpError } from "./http";

export function getRequestOrigin(request: any): string {
  const protocol = request.headers["x-forwarded-proto"] ?? "https";
  const host = request.headers["x-forwarded-host"] ?? request.headers.host;
  if (!host || typeof host !== "string") {
    throw new HttpError(400, "BAD_REQUEST", "Could not determine request origin");
  }

  return `${protocol}://${host}`;
}

export function getStringQuery(request: any, key: string): string | null {
  const value = request.query?.[key];
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return typeof value === "string" ? value : null;
}

export function parseAmount(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }

  throw new HttpError(400, "BAD_REQUEST", "Amount must be a positive number");
}

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function decodeBase58(value: string): Buffer | null {
  let decoded = 0n;
  for (const char of value) {
    const index = BASE58_ALPHABET.indexOf(char);
    if (index < 0) return null;
    decoded = decoded * 58n + BigInt(index);
  }

  let hex = decoded.toString(16);
  if (hex.length % 2 !== 0) hex = `0${hex}`;
  const body = decoded === 0n ? Buffer.alloc(0) : Buffer.from(hex, "hex");
  const zeroPrefix = value.match(/^1+/)?.[0].length ?? 0;
  return Buffer.concat([Buffer.alloc(zeroPrefix), body]);
}

function isValidTronAddress(address: string) {
  const decoded = decodeBase58(address);
  if (!decoded || decoded.length !== 25 || decoded[0] !== 0x41) return false;

  const payload = decoded.subarray(0, 21);
  const expectedChecksum = createHash("sha256")
    .update(createHash("sha256").update(payload).digest())
    .digest()
    .subarray(0, 4);
  return expectedChecksum.equals(decoded.subarray(21));
}

export function parsePayoutAddress(value: unknown, network: string): string {
  const address = typeof value === "string" ? value.trim() : "";
  const valid = network.toUpperCase() === "TRC20" ? isValidTronAddress(address) : address.length > 0;
  if (!valid) {
    throw new HttpError(400, "INVALID_PAYOUT_ADDRESS", `Invalid payout address for ${network}`);
  }

  return address;
}
