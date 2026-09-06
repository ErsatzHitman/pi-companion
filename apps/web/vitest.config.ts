import { cpus } from "node:os";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

/**
 * Every test file here boots a jsdom environment and transforms large lazy
 * chunks (the `@picompanion/frontend-core` barrel, CodeMirror, xterm). Running
 * vitest's default one-worker-per-core pool oversubscribes the machine, so the
 * per-file transform of those dynamic `import()`s stretches past the 15s waits
 * the lazy-loading tests budget for them and they fail intermittently. Capping
 * the pool keeps per-file transform time predictable (measured: cumulative
 * transform time drops ~8x) without changing wall-clock time meaningfully.
 */
const maxWorkers = Math.max(1, Math.min(6, cpus().length - 1));

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
    /**
     * `e2e/**` is Playwright's tree (T31A), started with a real,
     * isolated daemon and a real browser via `e2e/playwright.config.ts`.
     * It must never be picked up here: `*.spec.ts` files under `e2e/`
     * are not Vitest unit tests, and this config's own `include`
     * default would otherwise match them.
     */
    exclude: ["**/node_modules/**", "**/dist/**", "e2e/**"],
    maxWorkers,
    /**
     * Matches the explicit `}, 20_000)` budget the lazy-loading tests already
     * declare, so tests that only wait on an async import (and never set their
     * own timeout) get the same headroom instead of vitest's 5s default.
     */
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
