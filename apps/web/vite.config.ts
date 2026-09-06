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
export default defineConfig({
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
