import { readFileSync } from "node:fs";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * apps/web — Vite config (plan.md §8.1).
 *
 * DOM-first React + Vite, no Next.js and no SSR: `build.outDir` is the
 * static SPA bundle that `scripts/build-daemon-web-ui.mjs` (T18) folds
 * into the daemon's `server/dist/web-ui` output. Vite's default
 * `appType: "spa"` gives both `vite` (dev) and `vite preview` an
 * index.html fallback for deep client-side routes; the daemon's own web
 * middleware (T18) provides the equivalent fallback in production.
 */
/*
 * UI-X5: the design reference's rail foot ends with a version chip
 * (`v0.4.0`). Nothing in the client bundle previously knew this app's own
 * version — `DAEMON_APP_VERSION` is the daemon's protocol-compatibility
 * string, not ours — so the chip could not be rendered honestly and was
 * left out. This injects the real version from this package's own
 * manifest at build time. `vitest.config.ts` declares the same value, so
 * tests and the bundle agree; `src/vite-env.d.ts` declares the global.
 */
const appVersion = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"))
  .version as string;

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(appVersion) },
  plugins: [react()],
  appType: "spa",
  build: {
    outDir: "dist",
    sourcemap: true,
  },
  server: {
    port: 4173,
  },
  preview: {
    port: 4174,
  },
});
