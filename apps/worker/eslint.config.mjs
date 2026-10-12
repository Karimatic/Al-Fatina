import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

// The Worker (API, cron, Durable Object): same rules as the store, run by `npm run lint` and CI.
export default defineConfig([
  globalIgnores([".wrangler/**", "wrangler.e2e.jsonc"]),
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,mjs}"],
    languageOptions: { globals: { ...globals.serviceworker, ...globals.node } },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "prefer-const": "error",
    },
  },
]);
