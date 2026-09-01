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

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/**
 * Where the provider will send the money.
 *
 * On TRC20 the destination is a Tron address the user types, and the most we
 * can say is that it is well formed: base58check, 25 bytes, Tron prefix.
 *
 * Every other network settles to an EVM address, and there is exactly one we
 * are ever willing to pay — the embedded wallet on the caller's own session.
 * The previous rule off TRC20 was `address.length > 0`, which was survivable
 * only while the provider settled in USDT on Tron and a bad address failed the
 * base58 check anyway. Now that it settles Arbitrum USDC, a non-empty string
 * was the whole validation standing between a mistyped destination and money
 * that does not come back. Bind it to the session instead, so the client cannot
 * name an address the server did not already hold.
 */
export function parsePayoutAddress(
  value: unknown,
  network: string,
  walletAddress: string,
): string {
  const address = typeof value === "string" ? value.trim() : "";

  if (network.toUpperCase() === "TRC20") {
    if (!isValidTronAddress(address)) {
      throw new HttpError(400, "INVALID_PAYOUT_ADDRESS", `Invalid payout address for ${network}`);
    }
    return address;
  }

  if (!EVM_ADDRESS.test(address)) {
    throw new HttpError(400, "INVALID_PAYOUT_ADDRESS", `Invalid payout address for ${network}`);
  }

  // Case-insensitive: EIP-55 checksums differ by capitalisation only, and a
  // client that lower-cases the address is not making a different request.
  if (address.toLowerCase() !== walletAddress.trim().toLowerCase()) {
    throw new HttpError(
      400,
      "PAYOUT_ADDRESS_MISMATCH",
      "Payout address must be the wallet on this account",
    );
  }

  return address;
}
