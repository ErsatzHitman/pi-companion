/**
 * Static production-build server for the Playwright harness (T31A).
 *
 * E2E specs exercise the same static SPA artifact `apps/web`'s own
 * `npm run build` produces (plan.md §15.2), not the Vite dev server —
 * built once via Vite's own `build()` API, then served with Vite's own
 * `preview()` API on a caller-chosen ephemeral port. Both the build and
 * the server are owned entirely by this harness: `stop()` always closes
 * the preview server, so nothing is left running once `global-setup.ts`
 * (or a failing test's teardown) calls it.
 */
import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { build, preview } from "vite";
import type { PreviewServer } from "vite";

import { PRODUCTION_DAEMON_PORT } from "./ports.js";

// apps/web/e2e/fixtures -> apps/web
const webRoot = fileURLToPath(new URL("../..", import.meta.url));
const viteConfigFile = path.join(webRoot, "vite.config.ts");
// apps/web/e2e/fixtures -> the monorepo root
const repoRoot = fileURLToPath(new URL("../../../..", import.meta.url));

const execFileAsync = promisify(execFile);

/**
 * Every workspace package this suite runs through `dist/`: the four
 * `apps/web` itself imports, plus `@picompanion/server`, which the
 * harness's own `daemon.ts` imports to start the isolated daemon. Each
 * resolves through its package `exports` to `dist/`, never to `src/`, so
 * Vite (and Node, for the daemon) loads whatever was last compiled into
 * those `dist/` trees — building only `apps/web` silently runs a stale
 * copy of every one of them.
 *
 * This cost a full debugging cycle on 2026-09-03: T54A3's `HostController`
 * fix was merged, its unit tests passed, and
 * `reconnect-and-catch-up.spec.ts` still failed, because the browser was
 * running a `frontend-core/dist` built hours before the fix existed. The
 * E2E suite is the only layer that can catch an assembly bug, so it must
 * not be the layer running yesterday's code.
 *
 * `@picompanion/server` was added after the same trap surfaced a second
 * time, one workspace over: T31C4's `workspace-files-session.ts` fix was
 * visible to `files.spec.ts` only because that run happened to have been
 * preceded by a hand-run `npm run build --workspace=@picompanion/server`.
 * `packages/server/dist` is gitignored, so on a clean checkout — CI
 * included — the daemon would not have started at all.
 */
const E2E_WORKSPACE_DEPENDENCIES = [
  "@picompanion/protocol",
  "@picompanion/design-tokens",
  "@picompanion/highlight",
  "@picompanion/frontend-core",
  "@picompanion/server",
] as const;

/**
 * Compiles each workspace dependency's `dist/` before the Vite build, in
 * dependency order. Serial rather than parallel: `frontend-core`'s own
 * build script rebuilds `protocol` first, and two `tsc` runs writing the
 * same `dist/` concurrently is how you get a half-written output.
 */
async function buildWorkspaceDependencies(): Promise<void> {
  for (const workspace of E2E_WORKSPACE_DEPENDENCIES) {
    await execFileAsync("npm", ["run", "build", "--workspace", workspace], {
      cwd: repoRoot,
      shell: process.platform === "win32",
      // A cold tsc across these five packages is comfortably under this; the
      // ceiling exists so a hung compiler fails the run instead of
      // hanging the whole suite.
      timeout: 300_000,
      maxBuffer: 32 * 1024 * 1024,
    });
  }
}

export interface BuildAndServeOptions {
  /** The ephemeral port to bind; must not be `PRODUCTION_DAEMON_PORT`. */
  port: number;
}

export interface StaticWebPreview {
  port: number;
  baseUrl: string;
  stop: () => Promise<void>;
}

export async function buildAndServeWebApp(
  options: BuildAndServeOptions,
): Promise<StaticWebPreview> {
  if (options.port === PRODUCTION_DAEMON_PORT) {
    throw new Error(
      `Refusing to serve the E2E web build on the production daemon port ${PRODUCTION_DAEMON_PORT}.`,
    );
  }

  await buildWorkspaceDependencies();
  await build({ root: webRoot, configFile: viteConfigFile, logLevel: "warn" });

  const server: PreviewServer = await preview({
    root: webRoot,
    configFile: viteConfigFile,
    logLevel: "warn",
    preview: {
      port: options.port,
      strictPort: true,
      host: "127.0.0.1",
    },
  });

  let stopped = false;
  const stop = async (): Promise<void> => {
    if (stopped) return;
    stopped = true;
    await new Promise<void>((resolve, reject) => {
      server.httpServer.close((error) => (error ? reject(error) : resolve()));
    });
  };

  return {
    // `strictPort: true` above means the server either bound exactly
    // `options.port` or `preview()` rejected — this value is never a
    // silently-substituted alternate port.
    port: options.port,
    baseUrl: `http://127.0.0.1:${options.port}`,
    stop,
  };
}
