import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

export default [
  {
    ignores: [
      "**/node_modules/**",
      "client/dist/**",
      "android/**",
      "server/data/**",
      "test-results/**",
    ],
  },
  {
    files: [
      "client/**/*.{js,jsx}",
      "server/**/*.{js,mjs}",
      "scripts/**/*.mjs",
      "*.config.js",
    ],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    plugins: {
      "react-hooks": reactHooks,
    },
    rules: {
      ...js.configs.recommended.rules,
      ...reactHooks.configs.flat.recommended.rules,
      "no-unused-vars": ["error", { varsIgnorePattern: "^React$" }],
      "react-hooks/set-state-in-effect": "off",
    },
  },
];
