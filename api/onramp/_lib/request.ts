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
