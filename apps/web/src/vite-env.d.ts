/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Explicit standalone-development daemon host (plan.md §8.2). */
  readonly VITE_PASEO_DEV_DAEMON_HOST?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/**
 * This app's own version, injected at build time from `apps/web/package.json`
 * by the `__APP_VERSION__` define in `vite.config.ts` (and mirrored in
 * `vitest.config.ts` so tests see the same value). UI-X5 added it for the rail
 * foot's version chip, which the design reference ends its foot with; the
 * daemon's `DAEMON_APP_VERSION` is a protocol-compatibility string and is not
 * a substitute for it.
 */
declare const __APP_VERSION__: string;
