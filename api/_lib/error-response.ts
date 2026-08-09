import { randomUUID } from "node:crypto";

import { HttpError } from "./http-error";

export interface ErrorBody {
  success: false;
  error: string;
  code: string;
  details: unknown;
  requestId?: string;
}

/**
 * Render an error and its whole cause chain.
 *
 * `error.stack` alone is not enough for anything thrown by fetch: undici
 * reports a bare `TypeError: fetch failed` and puts the real reason —
 * ENOTFOUND, ECONNREFUSED, a TLS failure, a connect timeout — on `cause`.
 * Logging only the stack turned every network fault into the same
 * uninformative line.
 */
export function describeError(error: unknown, depth = 0): string {
  if (depth > 4) {
    return "…";
  }

  if (!(error instanceof Error)) {
    return typeof error === "string" ? error : JSON.stringify(error);
  }

  const parts: string[] = [error.stack ?? `${error.name}: ${error.message}`];

  // Undici hangs the useful fields off `cause` rather than the message. Read it
  // through a cast: the shared base tsconfig sets lib ES2020, where Error.cause
  // is not declared, and widening lib for the whole repo is not worth it here.
  const { cause, code } = error as Error & { cause?: unknown; code?: string };

  if (code) {
    parts.push(`  code: ${code}`);
  }

  if (cause != null) {
    parts.push(`  caused by: ${describeError(cause, depth + 1)}`);
  }

  return parts.join("\n");
}

/**
 * Turn any thrown value into a client-safe response body.
 *
 * HttpError is deliberate and its message is written for the caller, so it
 * passes through. Anything else is an internal failure whose message tends to
 * carry upstream detail — PostgREST constraint names, Redis status codes, the
 * name of a missing environment variable — so it is logged against a request id
 * and replaced with a fixed string. The caller gets the id to quote in a bug
 * report; the server keeps the specifics.
 */
export function toErrorBody(error: unknown): { statusCode: number; body: ErrorBody } {
  if (error instanceof HttpError) {
    return {
      statusCode: error.statusCode,
      body: {
        success: false,
        error: error.message,
        code: error.code,
        details: error.details ?? null,
      },
    };
  }

  const requestId = randomUUID();
  console.error(`[${requestId}] Unhandled API error: ${describeError(error)}`);

  return {
    statusCode: 500,
    body: {
      success: false,
      error: "Unexpected server error",
      code: "INTERNAL_ERROR",
      details: null,
      requestId,
    },
  };
}
