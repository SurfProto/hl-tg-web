/**
 * Can the authenticated paths load the modules they need?
 *
 * This is the blind spot that let four separate module-load failures sit in
 * production unnoticed — the whole API after 688e9bf, /api/profile/bootstrap,
 * the notifications worker, and every authenticated account read. Each one
 * failed *inside* a handler, past the auth check, so an unauthenticated probe
 * still got its 401 and every health signal looked fine. Only a user noticing a
 * zero balance, or a cron erroring, ever surfaced them.
 *
 * The account path fails on a require, not on a request, so a require is enough
 * to detect it. No credentials, no network, no side effects: each entry below
 * loads what a real route loads and reports whether it resolved.
 *
 * Deliberately loaded lazily, one at a time, so a failure names the module that
 * broke rather than taking this route down with it.
 */

interface DependencyCheck {
  id: string;
  /** Loads exactly what the real path loads, by the same specifier. */
  load: () => Promise<unknown>;
}

const CHECKS: DependencyCheck[] = [
  {
    // api/account/_lib/upstream.ts — every /api/account/* read.
    id: "hyperliquid-sdk/client",
    load: () => import("../../packages/hyperliquid-sdk/src/client"),
  },
  {
    // The same module's own deferred dependency. getPublicClient() reaches it
    // on the first market-cache build, which the account snapshot triggers.
    id: "@nktkas/hyperliquid",
    load: async () => {
      const { loadHyperliquidSDK } = await import(
        "../../packages/hyperliquid-sdk/src/client"
      );
      return loadHyperliquidSDK();
    },
  },
  {
    // Order placement signs through this one.
    id: "@nktkas/hyperliquid/signing",
    load: async () => {
      const { loadHyperliquidSigning } = await import(
        "../../packages/hyperliquid-sdk/src/client"
      );
      return loadHyperliquidSigning();
    },
  },
  {
    // api/rewards/_lib/hyperliquid-client.ts, same deferred-import shape.
    id: "rewards/hyperliquid-client",
    load: () => import("../rewards/_lib/hyperliquid-client"),
  },
  {
    // api/rewards/_lib/program.ts pays USDC through this.
    id: "rewards/payout",
    load: () => import("../rewards/_lib/payout"),
  },
  {
    // api/notifications/worker.ts — all five, the way loadWorkerDependencies does.
    id: "notification-worker/config",
    load: () => import("../../apps/notification-worker/src/config"),
  },
  {
    id: "notification-worker/hyperliquid",
    load: () => import("../../apps/notification-worker/src/hyperliquid"),
  },
  {
    id: "notification-worker/run-once",
    load: () => import("../../apps/notification-worker/src/run-once"),
  },
  {
    id: "notification-worker/supabase",
    load: () => import("../../apps/notification-worker/src/supabase"),
  },
  {
    id: "notification-worker/telegram",
    load: () => import("../../apps/notification-worker/src/telegram"),
  },
  {
    // The Privy user lookup that replaced @privy-io/node on 2026-08-16.
    id: "profile/identity",
    load: () => import("../profile/_lib/identity"),
  },
];

export default async function handler(request: any, response: any) {
  if (request.method !== "GET") {
    response.status(405).json({ success: false, code: "METHOD_NOT_ALLOWED" });
    return;
  }

  const results = await Promise.all(
    CHECKS.map(async (check) => {
      try {
        await check.load();
        return { id: check.id, ok: true as const };
      } catch (error) {
        const reason =
          error instanceof Error ? error.message : "failed to load";
        // The full error, with its require stack, belongs in the runtime log.
        console.error("[health/deps] load failed", { id: check.id, error });
        return { id: check.id, ok: false as const, reason };
      }
    }),
  );

  const failed = results.filter((result) => !result.ok);

  response.status(failed.length === 0 ? 200 : 500).json({
    success: failed.length === 0,
    data: {
      checked: results.length,
      failed: failed.length,
      modules: results,
    },
  });
}
