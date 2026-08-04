import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * tsconfig sets `jsx: "preserve"` because Next compiles the JSX itself, which
 * leaves esbuild falling back to the classic transform under vitest — and that
 * needs React in scope in every component file. Selecting the automatic runtime
 * here is what lets a component be rendered in a test at all.
 */
export default defineConfig({
  esbuild: { jsx: "automatic" },
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) }
  }
});
