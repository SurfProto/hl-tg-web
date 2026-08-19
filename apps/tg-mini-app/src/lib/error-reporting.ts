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
  | "unhandled-rejection";

export interface ClientErrorReport {
  kind: ClientErrorKind;
  message: string;
  stack?: string | null;
  componentStack?: string | null;
}

function fingerprint(report: ClientErrorReport): string {
  // The first stack frame is enough to tell two crashes apart without letting
  // a varying line number defeat the deduplication.
  const firstFrame = report.stack?.split("\n")[1]?.trim() ?? "";
  return `${report.kind}:${report.message}:${firstFrame}`;
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
    url: window.location?.href ?? null,
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
    })
      .then(done, done);
  } catch {
    // fetch itself can throw synchronously in a sufficiently broken runtime.
    done();
  }
}

export function toReportableError(
  error: unknown,
): { message: string; stack: string | null } {
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
