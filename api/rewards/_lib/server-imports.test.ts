import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";

const API_ROOT = resolve(import.meta.dirname, "../..");
const REPO_ROOT = resolve(API_ROOT, "..");

function readSource(fileName: string) {
  return readFileSync(resolve(import.meta.dirname, fileName), "utf8");
}

/**
 * Resolve a relative specifier the way the bundler will.
 *
 * Handles the three shapes this tree uses: a bare path needing `.ts`, a
 * directory with an `index.ts`, and the `./payout.js` form that TypeScript
 * emits for a dynamic import of a `.ts` sibling.
 */
function resolveSpecifier(fromFile: string, specifier: string): string | null {
  const base = resolve(dirname(fromFile), specifier.replace(/\.js$/, ""));
  for (const candidate of [`${base}.ts`, `${base}/index.ts`, base]) {
    if (existsSync(candidate) && !candidate.endsWith("/")) {
      return candidate;
    }
  }
  return null;
}

/**
 * Every module reachable from `entry` by following relative imports.
 *
 * Both static `from "..."` and dynamic `import("...")` forms count: a lazy
 * import is still a path from a request handler to the code it loads, and
 * lazily importing the payout module is exactly how the dashboard used to
 * reach `sendRewardUsdc`.
 */
function importGraph(entry: string): Set<string> {
  const seen = new Set<string>();
  const queue = [entry];

  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);

    const source = readFileSync(file, "utf8");
    const specifiers = [
      ...source.matchAll(/(?:from|import)\s*\(?\s*["'](\.[^"']+)["']/g),
    ].map((match) => match[1]!);

    for (const specifier of specifiers) {
      const resolved = resolveSpecifier(file, specifier);
      if (resolved) queue.push(resolved);
    }
  }

  return seen;
}

function reachableFrom(entry: string): string[] {
  return [...importGraph(resolve(API_ROOT, entry))]
    .map((file) => relative(REPO_ROOT, file).split("\\").join("/"))
    .sort();
}

const PAYOUT = "api/rewards/_lib/payout.ts";
const RAFFLE = "api/rewards/_lib/raffle.ts";

/**
 * The rewards program is XP-only, and the guarantee that matters is structural:
 * a request cannot move money because the code that moves money is not in the
 * module graph it loads, not because a runtime flag happens to be false.
 *
 * These assertions are on the graph rather than on source text. The previous
 * version of this file matched strings, and it passed happily while
 * `syncRewardsDashboard` still settled pending USDC through a lazy
 * `import("./payout.js")` — it was asserting that the lazy import existed.
 */
describe("rewards server runtime import boundaries", () => {
  it("cannot reach the payout module from the dashboard request path", () => {
    const graph = reachableFrom("rewards/dashboard.ts");

    expect(graph).not.toContain(PAYOUT);
    expect(graph).toContain("api/rewards/_lib/program.ts");
  });

  it("cannot reach the payout module from the weekly raffle route", () => {
    const graph = reachableFrom("rewards/weekly-raffle.ts");

    expect(graph).not.toContain(PAYOUT);
    expect(graph).not.toContain(RAFFLE);
  });

  it("cannot reach the payout module from the referral mutation", () => {
    expect(reachableFrom("rewards/referral/apply.ts")).not.toContain(PAYOUT);
  });

  it("cannot reach the payout module from the fill ingestion worker", () => {
    const graph = reachableFrom("rewards/sync-fills.ts");

    expect(graph).not.toContain(PAYOUT);
    expect(graph).not.toContain(RAFFLE);
  });

  it("keeps payout.ts on disk for audited history and isolated tests", () => {
    const payoutSource = readSource("payout.ts");

    expect(payoutSource).toContain("export async function sendRewardUsdc(");
    expect(payoutSource).toContain("Dormant.");
  });

  /**
   * payout.ts reading its own environment is what keeps the treasury key off
   * the config object every handler is passed. If it went back to accepting a
   * RewardsConfig, adding the key back to that shared type would once again be
   * a one-line change away from being reachable everywhere.
   */
  it("reads treasury configuration separately from RewardsConfig", () => {
    const payoutSource = readSource("payout.ts");
    const configSource = readSource("config.ts");

    expect(payoutSource).toContain("export interface PayoutConfig {");
    expect(payoutSource).toContain("env.REWARDS_TREASURY_PRIVATE_KEY");
    // Matched on the environment read and the field, not on the name: config.ts
    // documents why the key is absent, and that prose should stay allowed.
    expect(configSource).not.toContain("env.REWARDS_TREASURY_PRIVATE_KEY");
    expect(configSource).not.toContain("treasuryPrivateKey:");
  });

  it("does not statically import the Hyperliquid client in rewards server modules", () => {
    const clientImport =
      'import { HyperliquidClient } from "../../../packages/hyperliquid-sdk/src/client";';

    expect(readSource("program.ts")).not.toContain(clientImport);
    expect(readSource("payout.ts")).not.toContain(clientImport);
  });
});
