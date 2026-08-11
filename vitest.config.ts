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
  test: {
    /*
     * The unit suite is the files beside the source they cover, and nothing
     * else. Without this, vitest's default glob also collects `tests/` — the
     * integration and security suites, which need a running server, and the
     * Playwright specs, whose `test`/`expect` come from a different package
     * entirely. Both fail here for reasons that have nothing to do with the
     * code under test. They have their own runners:
     *   npm run test:api    npm run test:e2e
     */
    include: ["src/**/*.{test,spec}.{ts,tsx}"]
  },
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) }
  }
});
