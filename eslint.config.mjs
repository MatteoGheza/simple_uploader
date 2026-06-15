import { defineConfig, globalIgnores } from "eslint/config";

import { fileURLToPath } from "url";
import { dirname } from "path";

import globals from "globals";
const { browser, node } = globals;

import eslintJs from "@eslint/js";
const { configs } = eslintJs;

import tsParser from "@typescript-eslint/parser";
import typescriptEslint from "@typescript-eslint/eslint-plugin";

import { FlatCompat } from "@eslint/eslintrc";

const __dirname = dirname(fileURLToPath(import.meta.url));
const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: configs.recommended,
  allConfig: configs.all
});

const off = 0;
const warning = 1;
const error = 2;

export default defineConfig([{
  languageOptions: {
    globals: {
      ...node
    },

    parser: tsParser,
    "ecmaVersion": "latest",
    "sourceType": "module",
    parserOptions: {}
  },

  extends: compat.extends("eslint:recommended", "plugin:@typescript-eslint/recommended"),

  plugins: {
    "@typescript-eslint": typescriptEslint
  },

  "rules": {
    "no-empty-static-block": error,
    "no-eq-null": error,
    "no-eval": error,
    "no-implied-eval": error,
    "no-invalid-this": error,

    "no-magic-numbers": [warning, {
      "ignore": [
        -1, 0, 1, 2, 3, 4, 16,
        100, 1000, 200, 250,
        206, 400, 401, 403, 404, 405, 416, 500
      ]
    }],

    "no-nested-ternary": warning,
    "no-new-func": error,
    "no-script-url": error,
    "no-unneeded-ternary": warning,
    "block-scoped-var": warning,
    "capitalized-comments": warning,
    "eqeqeq": [error, "smart"],
    "multiline-comment-style": [warning, "starred-block"],
    "no-bitwise": warning,
    "no-confusing-arrow": error,
    "no-console": error,
    "prefer-const": off,
    "eol-last": error,
    "no-trailing-spaces": error,
    "yoda": warning,
    "class-methods-use-this": warning,
    "array-bracket-spacing": warning,
    "arrow-parens": warning,
    "arrow-spacing": warning,
    "block-spacing": warning,
    "brace-style": error,
    "comma-dangle": warning,
    "dot-location": [warning, "property"],
    "func-call-spacing": warning,
    "indent": ["error", 2],
    "key-spacing": warning,
    "keyword-spacing": warning,
    "linebreak-style": [warning, "windows"],

    "max-len": [warning, {
      "code": 90,
      "ignoreUrls": true,
      "ignoreStrings": true,
      "ignoreTemplateLiterals": true,
      "ignoreRegExpLiterals": true,
      "ignoreComments": true,
      "ignoreTrailingComments": true
    }],

    "new-parens": warning,
    "no-extra-parens": warning,
    "no-multi-spaces": warning,

    "no-multiple-empty-lines": [error, {
      "max": 3,
      "maxEOF": 1,
      "maxBOF": 1
    }],

    "no-tabs": warning,
    "no-whitespace-before-property": warning,
    "nonblock-statement-body-position": warning,
    "semi-spacing": warning
  }
}]);
