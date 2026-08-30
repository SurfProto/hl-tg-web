import repo from "@repo/eslint-config";

// One config for the whole monorepo. Per-package `eslint .` runs (via turbo)
// resolve upward to this file; the root lint script also covers api/ and
// scripts/, which are not pnpm workspaces and turbo never visits.
export default [
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.turbo/**",
      "**/coverage/**",
      ".claude/**",
      ".codex-tools/**",
      ".pnpm-store/**",
      "artifacts/**",
      // Parked, deliberately unrouted code — lint it when it unparks.
      "api/_parked/**",
    ],
  },
  ...repo,
];
