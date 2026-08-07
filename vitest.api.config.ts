import { defineConfig } from "vitest/config";

/**
 * Test config for the serverless functions under api/.
 *
 * api/ is not a pnpm workspace package, so `turbo test` — which only walks
 * apps/* and packages/* — never picked these files up. The suite existed but
 * had not run in CI. The root `test` script now runs this config alongside
 * turbo so the API tests count again.
 *
 * Deliberately NOT named vitest.config.ts: vitest searches parent directories
 * for a config, so a file with the default name at the repo root would be
 * picked up by every workspace package that has no config of its own
 * (hyperliquid-sdk, notification-worker, web) and override their include glob.
 * Pass it explicitly with --config instead.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["api/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    coverage: {
      provider: "v8",
      reporter: ["text"],
      include: ["api/**/*.ts"],
      exclude: ["api/**/*.test.ts"],
    },
  },
});
