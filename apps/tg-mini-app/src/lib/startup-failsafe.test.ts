// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The splash failsafe lives in index.html, not in a bundle, because it exists
 * for the one failure no bundled code can survive: an entry chunk that never
 * loads. This app has shipped that twice, and in that state the user sits on
 * an opaque spinner with nothing to read and nothing to tap.
 *
 * Nothing else watches it — it is outside the module graph, so no typecheck,
 * lint rule or import touches it, and an unrelated index.html edit could drop
 * it silently. So this evaluates the real inline script out of the real file.
 */

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const html = readFileSync(resolve(APP_ROOT, "index.html"), "utf8");

/** The inline classic script, taken verbatim from index.html. */
function failsafeSource(): string {
  const match = html.match(
    /<script>([\s\S]*?startup-shell[\s\S]*?)<\/script>/,
  );
  if (!match) throw new Error("no inline startup script found in index.html");
  return match[1];
}

function mountShell({ withRootContent }: { withRootContent: boolean }) {
  document.body.innerHTML = `
    <div id="startup-shell"><div id="startup-shell-spinner"></div></div>
    <div id="root">${withRootContent ? "<div>app</div>" : ""}</div>
  `;
}

describe("startup shell failsafe", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("is still present in index.html and targets the id the app tears down", () => {
    const source = failsafeSource();
    expect(source).toMatch(/setTimeout/);
    expect(source).toMatch(/startup-shell/);
    // teardownStartupShell() queries this same id; if one drifts the failsafe
    // silently stops covering anything.
    expect(html).toContain('id="startup-shell"');
  });

  it("does nothing before the deadline", () => {
    mountShell({ withRootContent: true });
    new Function(failsafeSource())();

    vi.advanceTimersByTime(14_000);

    const shell = document.getElementById("startup-shell")!;
    expect(shell.dataset.hidden).toBeUndefined();
    expect(shell.dataset.failed).toBeUndefined();
  });

  it("uncovers a mounted-but-slow app rather than replacing it", () => {
    mountShell({ withRootContent: true });
    new Function(failsafeSource())();

    vi.advanceTimersByTime(15_000);

    const shell = document.getElementById("startup-shell")!;
    expect(shell.dataset.hidden).toBe("true");
    expect(shell.dataset.failed).toBeUndefined();
  });

  /**
   * The case it exists for. Hiding the shell here would reveal an empty page,
   * so the user gets a message and a reload button instead.
   */
  it("shows the failure message when the app never mounted", () => {
    mountShell({ withRootContent: false });
    new Function(failsafeSource())();

    vi.advanceTimersByTime(15_000);

    const shell = document.getElementById("startup-shell")!;
    expect(shell.dataset.failed).toBe("true");
    expect(shell.dataset.hidden).toBeUndefined();
  });

  it("carries the failure markup and a reload control", () => {
    expect(html).toContain('id="startup-shell-failed"');
    expect(html).toMatch(/window\.location\.reload\(\)/);
  });
});
