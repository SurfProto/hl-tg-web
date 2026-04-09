import { createHash } from "node:crypto";

type SerializableValue = string | number | boolean | null | undefined;

export function serializeSignatureParams(params: Record<string, SerializableValue>): string {
  return Object.keys(params)
    .sort((left, right) => left.localeCompare(right))
    .map((key) => `${key}:${params[key]};`)
    .join("");
}

export function createSignature(serializedParams: string, timestamp: string, secret: string): string {
  return createHash("sha256")
    .update(`${serializedParams}${timestamp}${secret}`)
    .digest("hex");
}
