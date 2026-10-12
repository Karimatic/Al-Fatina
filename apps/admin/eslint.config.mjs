import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

// The admin panel (React): same rules as the store, plus React hooks; run by `npm run lint` and CI.
export default defineConfig([
  globalIgnores(["dist/**", "public/**"]),
  js.configs.recommended,
  ...tseslint.configs.recommended,
  reactHooks.configs.flat["recommended-latest"] ?? reactHooks.configs["recommended-latest"],
  {
    files: ["**/*.{ts,tsx,mjs}"],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "prefer-const": "error",
      // Rules written for the React Compiler, which the admin does not use. Forms are filled
      // from loaded data in an effect (setState there is the intended pattern), and "5 min ago"
      // labels read the clock while rendering on purpose. The classic hook rules stay errors.
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/purity": "off",
    },
  },
]);
