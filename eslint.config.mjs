import js from "@eslint/js";
import globals from "globals";

export default [
  { ignores: ["node_modules/", "playwright-report/", "test-results/"] },
  js.configs.recommended,
  {
    files: ["animated-swipe-navigation.js"],
    languageOptions: { sourceType: "script", globals: globals.browser },
  },
  {
    files: ["**/*.mjs", "tests/**/*.js"],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
];
