import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { apiPlugin } from "../../scripts/vite-plugin-api";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

// Which build a report came from. Vercel exposes the commit at build time and
// nothing else in the app knew its own version, so a client report could not
// be tied to the code that produced it. Falls back to "dev" locally, where the
// answer is whatever is in the working tree.
const buildId = (
  process.env.VERCEL_GIT_COMMIT_SHA ??
  process.env.GITHUB_SHA ??
  "dev"
).slice(0, 7);

export default defineConfig({
  define: {
    __BUILD_ID__: JSON.stringify(buildId),
  },
  // apiPlugin serves the repo-root api/ functions from this dev server. Without
  // it every /api/* request falls through to the SPA fallback and returns
  // index.html, which is why local development could not exercise the app.
  plugins: [react(), apiPlugin({ root: repoRoot })],
  // Read .env from the repo root rather than this app's directory, so the same
  // file supplies both the client's VITE_* values and the api/ handlers' server
  // variables. Otherwise the two halves read different files and the client
  // silently boots with undefined config.
  envDir: repoRoot,
  server: {
    host: true,
    port: 5173,
    fs: {
      // The api/ handlers import from packages/ and api/_lib, both outside this
      // app's root, so Vite has to be allowed to read the whole repo.
      allow: [repoRoot],
    },
  },
  resolve: {
    // Forces single React instance across all dependencies (pnpm-compatible)
    dedupe: [
      "react",
      "react-dom",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
    ],
  },
  build: {
    outDir: "dist",
    sourcemap: true,
    rollupOptions: {
      output: {
        // The entry chunk was 2.58 MB minified, and by sourcemap attribution
        // almost all of it is Privy 1.x's static dependency tree: viem + ox
        // (~2 MB of source), ~530 KB of Solana token programs this EVM-only
        // app never touches, and libphonenumber for SMS login. None of that
        // is removable from here — Privy imports it unconditionally, so
        // config changes don't tree-shake it; a Privy major upgrade is the
        // real fix. What splitting buys today: the huge, rarely-changing
        // vendor trees get their own hashed chunks, so they download in
        // parallel and stay cached across app deploys instead of being
        // re-fetched inside a monolith whose hash changes on every release.
        // Only dependency leaves are split (crypto/math/util trees) — the
        // safe kind, with no init-order entanglement with app code.
        manualChunks(id: string) {
          if (!id.includes("node_modules")) return undefined;
          if (/node_modules\/(viem|ox|@noble|@scure|abitype)\//.test(id)) {
            return "evm";
          }
          // Match the real package segment only: pnpm's virtual-store paths
          // encode peer deps in the directory name (…react-auth@1.x_@solana+
          // web3.js@…), so a bare substring test drags Privy itself in here.
          if (/node_modules\/(@solana|@solana-program)/.test(id)) {
            return "solana";
          }
          if (/node_modules\/libphonenumber-js\//.test(id)) return "phone";
          if (/node_modules\/(react|react-dom|scheduler)\//.test(id)) {
            return "react";
          }
          return undefined;
        },
      },
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    css: true,
    exclude: ["e2e/**", "node_modules/**", "dist/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      reportsDirectory: "./coverage",
    },
  },
});
