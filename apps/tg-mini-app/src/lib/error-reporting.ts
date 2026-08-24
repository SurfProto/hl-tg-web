/**
 * Ship a client crash somewhere a developer can read it.
 *
 * The logger writes to console, and a console inside Telegram on someone's
 * phone is unreachable. A user-reported crash on 2026-08-16 could not be
 * diagnosed for exactly that reason.
 *
 * Three rules hold this together, all of them about not making a bad moment
 * worse: reporting never throws into the caller, never reports a failure of
 * its own reporting, and never sends the same crash twice.
 */

import { maskAddress, redactAddresses } from "@repo/hyperliquid-sdk";

const ENDPOINT = "/api/client-errors";

/** A render loop can throw the same error thousands of times. Send it once. */
const seen = new Set<string>();

/** A hard ceiling per page load, in case the key varies each time. */
const MAX_REPORTS_PER_SESSION = 20;
let sent = 0;

/** Set while a report is in flight, so a failing report cannot report itself. */
let reporting = false;

export type ClientErrorKind =
  | "error-boundary"
  | "window-error"
  | "unhandled-rejection"
  | "exchange-action";

/**
 * What a refused exchange action is allowed to say about itself.
 *
 * Everything here is either a fixed vocabulary or already masked. Nothing that
 * identifies the account or the trade goes in — no master wallet address, no
 * order payload, no size, no balance, and under no circumstances a private
 * key. The agent address is masked because two reports being about the same
 * agent is worth knowing, and which agent it is, is not.
 */
export interface ExchangeActionDetail {
  code: string;
  action: string;
  network: "mainnet" | "testnet";
  buildId: string;
  /** Masked, e.g. `0x1234…5678`. */
  agentAddress: string | null;
}

export interface ClientErrorReport {
  kind: ClientErrorKind;
  message: string;
  stack?: string | null;
  componentStack?: string | null;
  detail?: ExchangeActionDetail | null;
}

function fingerprint(report: ClientErrorReport): string {
  // The first stack frame is enough to tell two crashes apart without letting
  // a varying line number defeat the deduplication.
  const firstFrame = report.stack?.split("\n")[1]?.trim() ?? "";
  // An exchange rejection carries no stack, and every rejection of a given
  // kind shares one message. Without the action in the key, a session in which
  // a close, a cancel and a leverage change were all refused would report the
  // first and drop the rest — which is the shape the counts exist to measure.
  const detail = report.detail
    ? `:${report.detail.action}:${report.detail.code}:${report.detail.agentAddress ?? "unknown-agent"}`
    : "";
  return `${report.kind}:${report.message}:${firstFrame}${detail}`;
}

function reportPageUrl(): string | null {
  try {
    const { origin, pathname } = window.location;
    return origin && origin !== "null"
      ? `${origin}${pathname}`
      : pathname || null;
  } catch {
    return null;
  }
}

export function __resetErrorReportingForTests() {
  seen.clear();
  sent = 0;
  reporting = false;
}

export function isReportingInFlight() {
  return reporting;
}

export function reportClientError(report: ClientErrorReport): void {
  if (reporting) return;
  if (sent >= MAX_REPORTS_PER_SESSION) return;

  const key = fingerprint(report);
  if (seen.has(key)) return;
  seen.add(key);
  sent += 1;

  const body = JSON.stringify({
    kind: report.kind,
    message: report.message,
    stack: report.stack ?? null,
    componentStack: report.componentStack ?? null,
    detail: report.detail ?? null,
    // Telegram launch data, wallet hints and other session material can live
    // in the query string or hash. The route is enough to locate the failure.
    url: reportPageUrl(),
    userAgent: navigator?.userAgent ?? null,
  });

  reporting = true;
  const done = () => {
    reporting = false;
  };

  try {
    // keepalive so a crash that takes the page down still gets the report out.
    void fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      keepalive: true,
    }).then(done, done);
  } catch {
    // fetch itself can throw synchronously in a sufficiently broken runtime.
    done();
  }
}

export function toReportableError(error: unknown): {
  message: string;
  stack: string | null;
} {
  if (error instanceof Error) {
    return { message: error.message || error.name, stack: error.stack ?? null };
  }
  if (typeof error === "string") return { message: error, stack: null };
  try {
    return { message: JSON.stringify(error) ?? "Unknown error", stack: null };
  } catch {
    return { message: "Unknown error", stack: null };
  }
}

/**
 * Report a trading action the exchange refused for lack of a valid agent.
 *
 * Redaction happens here rather than at the call site so there is one place to
 * check, and so a caller cannot forget: the exchange's own message names the
 * agent address in full, and that message is the useful part of the report.
 */
export function reportExchangeActionFailure(args: {
  code: string;
  action: string;
  exchangeMessage: string;
  agentAddress: string | null;
  network: "mainnet" | "testnet";
  buildId: string;
}): void {
  reportClientError({
    kind: "exchange-action",
    message: redactAddresses(args.exchangeMessage),
    detail: {
      code: args.code,
      action: args.action,
      network: args.network,
      buildId: args.buildId,
      agentAddress: args.agentAddress ? maskAddress(args.agentAddress) : null,
    },
  });
}
