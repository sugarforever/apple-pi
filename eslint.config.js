import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

/**
 * Generated output, vendored tooling, and the semantic search index are not
 * source and must never be linted.
 */
const IGNORED = [
  "**/node_modules/**",
  "**/dist/**",
  "**/out/**",
  "**/release/**",
  "**/artifacts/**",
  "**/coverage/**",
  "**/test-results/**",
  "**/playwright-report/**",
  "**/.zvec-grep/**",
];

const RENDERER_FILES = ["apps/desktop/src/renderer/**/*.{ts,tsx}"];
const NODE_FILES = [
  "apps/desktop/src/main/**/*.ts",
  "apps/desktop/src/preload/**/*.ts",
  "apps/desktop/src/shared/**/*.ts",
  "apps/agent-host/**/*.ts",
  "packages/**/*.ts",
];

export default tseslint.config(
  { ignores: IGNORED },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    languageOptions: { ecmaVersion: 2023, sourceType: "module" },
    rules: {
      // The core rules cannot see TypeScript types and report false positives.
      "no-undef": "off",
      "no-unused-vars": "off",
      "no-empty": ["error", { allowEmptyCatch: true }],
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" }],
      "@typescript-eslint/consistent-type-imports": ["error", { prefer: "type-imports", fixStyle: "inline-type-imports", disallowTypeAnnotations: false }],
      eqeqeq: ["error", "smart"],
      "object-shorthand": "error",
      "prefer-const": "error",
    },
  },
  { files: NODE_FILES, languageOptions: { globals: globals.node } },
  {
    files: RENDERER_FILES,
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs["recommended-latest"].rules,
      // The renderer predates this rule. Deriving the error banner during render
      // instead of in an effect is a real UI change and belongs in its own PR.
      "react-hooks/set-state-in-effect": "warn",
    },
    languageOptions: { globals: globals.browser },
  },
  {
    files: ["**/*.test.ts", "**/*.test.tsx", "**/*.test.mjs", "apps/desktop/electron.vite.config.ts"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
);
