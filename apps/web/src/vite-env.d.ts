/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Explicit standalone-development daemon host (plan.md §8.2). */
  readonly VITE_PASEO_DEV_DAEMON_HOST?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
