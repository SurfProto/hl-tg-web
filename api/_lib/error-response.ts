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
  console.error(
    `[${requestId}] Unhandled API error:`,
    error instanceof Error ? (error.stack ?? error.message) : error,
  );

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
