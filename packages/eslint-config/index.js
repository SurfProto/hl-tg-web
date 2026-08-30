import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

/**
 * The monorepo's one ruleset, as an ESLint 9 flat-config array.
 *
 * This package existed from the start but was never wired: no package had an
 * eslint config file referencing it, so every lint script died on "no
 * configuration found" and lint had never once run in this repo. The rules
 * here carry the old intended config forward with two deliberate changes:
 *
 * - `@typescript-eslint/no-explicit-any` is off, not "warn". Every script
 *   runs with --max-warnings 0, so a warn is a fail — and `any` is endemic
 *   in the older pages and handlers. Banning it is its own project; a rule
 *   that fails hundreds of times on day one just gets disabled in anger.
 * - `react-hooks/exhaustive-deps` is an error. The codebase deliberately
 *   narrows dependencies in a few places, always with a comment explaining
 *   why; those carry a targeted eslint-disable so the reasoning and the
 *   suppression sit together.
 */
export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: { react, "react-hooks": reactHooks },
    // Pinned rather than "detect": detection warns on every react-less
    // package (api handlers, the workers), and the workspace pins one React.
    settings: { react: { version: "18.3" } },
    rules: {
      ...react.configs.flat.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      "react/react-in-jsx-scope": "off",
      "react/prop-types": "off",
      "react-hooks/exhaustive-deps": "error",
    },
  },
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node, ...globals.es2021 },
    },
    rules: {
      // `while (true)` is how the notification worker's poll loop is meant
      // to read; only non-loop constant conditions stay flagged.
      "no-constant-condition": ["error", { checkLoops: false }],
      "@typescript-eslint/explicit-module-boundary-types": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
    },
  },
  prettier,
);
