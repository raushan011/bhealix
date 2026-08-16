import { FlatCompat } from "@eslint/eslintrc";
import path from "node:path";
import { fileURLToPath } from "node:url";
const compat = new FlatCompat({ baseDirectory: path.dirname(fileURLToPath(import.meta.url)) });
const config = [
  /*
   * `playwright-report` and `test-results` are generated, and generated is the
   * whole reason: the report bundles a minified copy of its own viewer, which
   * lint reads as source and returns three thousand complaints about — every
   * real problem in the project buried under column 2439 of somebody else's
   * build. Both are already in `.gitignore`; this tells the linter what git
   * was told.
   */
  { ignores: [".next/**", ".next-build/**", "node_modules/**", "coverage/**", "next-env.d.ts", "playwright-report/**", "test-results/**"] },
  ...compat.extends("next/core-web-vitals", "next/typescript")
];
export default config;
