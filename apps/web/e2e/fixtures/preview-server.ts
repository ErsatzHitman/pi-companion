/**
 * Packaged-daemon-web-UI server for the Playwright harness.
 *
 * T43B2b: until this task, this fixture built `apps/web/dist` with
 * Vite's own `build()` API and served THAT directory with `preview()` —
 * a standalone production build, but not the artifact T43A1 made every
 * packaging path use. `scripts/build-daemon-web-ui.mjs` is that path:
 * it builds `apps/web` itself (so a separate `build()` call here would
 * just rebuild it a second time) and then copies + precompresses the
 * result into `packages/server/dist/server/web-ui` — the exact
 * directory `daemon-package-dry-run` packs and
 * `run-guard-daemon-web-ui-bundled.mjs` inspects (`.github/workflows/ci.yml`).
 * This fixture now runs that same script and serves ITS output, so a
 * spec exercises the identical bytes (including the `.br`/`.gz`
 * siblings the real daemon package ships) that a user's packaged daemon
 * would serve — not a separately-built copy that merely happens to
 * look the same.
 *
 * This still is not the daemon's own §15.2 bundling PATH in the sense
 * of being mounted through `packages/server/src/server/web-ui.ts`'s
 * Express middleware on the same origin as the API/WebSocket daemon
 * (`daemon.ts` keeps `webUi: { enabled: false, distDir: null }`
 * deliberately). That middleware unconditionally injects
 * `window.__PASEO_INITIAL_DAEMON_CONNECTION__` into every served
 * `index.html` (`web-ui.ts`'s `injectConnectionHint`), which makes
 * `ConnectFormContainer` render `BootstrapConnectStatus` and
 * auto-attempt a connection instead of the manual `ConnectForm` every
 * spec in this suite drives (`connect.smoke.spec.ts` and everything
 * built on `fixtures/test.ts`'s `daemonConnection` fixture). Merging
 * the two origins would require rewriting those specs' expectations,
 * which is out of T43B2b's scope — that task owns the CI job wiring
 * for these two suites, not the specs those jobs run. What
 * changed here — serving the actual packaged bundle contents instead of
 * a fresh, separately-built copy — is the improvement available without
 * that rewrite.
 *
 * Both the build and the server are owned entirely by this harness:
 * `stop()` always closes the preview server, so nothing is left running
 * once `global-setup.ts` (or a failing test's teardown) calls it.
 */
import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { preview } from "vite";
import type { PreviewServer } from "vite";

import { PRODUCTION_DAEMON_PORT } from "./ports.js";

// apps/web/e2e/fixtures -> the monorepo root
const repoRoot = fileURLToPath(new URL("../../../..", import.meta.url));

/**
 * `scripts/build-daemon-web-ui.mjs`'s `TARGET_DIST` — kept in sync by
 * inspection, not by import (that script is a standalone CLI, not a
 * module this fixture can import types from).
 */
const PACKAGED_WEB_UI_DIR = path.join(repoRoot, "packages", "server", "dist", "server", "web-ui");

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
 * Compiles each workspace dependency's `dist/` before
 * `scripts/build-daemon-web-ui.mjs` builds `apps/web` itself, in
 * dependency order. Serial rather than parallel: `frontend-core`'s own
 * build script rebuilds `protocol` first, and two `tsc` runs writing the
 * same `dist/` concurrently is how you get a half-written output.
 *
 * Deliberately plain `build`, not `build:clean`, for
 * `@picompanion/server`: `packages/server`'s real `prepack` script runs
 * `build:clean` (which deletes and rebuilds all of `dist/`) BEFORE
 * `build:daemon-web-ui` for exactly the reason `packaging/docker/Dockerfile`
 * and `packaging/nix/flake.nix` both warn about — a clean-and-rebuild
 * AFTER bundling the web UI would erase it. This function's `build` step
 * always runs before `runBuildDaemonWebUi` below, so that ordering hazard
 * does not apply here regardless.
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

/**
 * Runs the same `scripts/build-daemon-web-ui.mjs` every packaging path
 * uses (T43A1): it builds `apps/web` (see the module doc above for why
 * this fixture does not also call Vite's `build()` API itself), then
 * copies and precompresses the result into `PACKAGED_WEB_UI_DIR`. Throws
 * if `apps/web` fails to build or produces no `dist/` — the same
 * "fail loudly" behavior `daemon-package-dry-run` relies on.
 */
async function runBuildDaemonWebUi(): Promise<void> {
  await execFileAsync("node", ["scripts/build-daemon-web-ui.mjs"], {
    cwd: repoRoot,
    // Includes the apps/web Vite build the script runs internally; same
    // ceiling rationale as buildWorkspaceDependencies above.
    timeout: 300_000,
    maxBuffer: 32 * 1024 * 1024,
  });
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
  await runBuildDaemonWebUi();

  // No `configFile` here: `apps/web/vite.config.ts` configures a build
  // rooted at `apps/web` with `outDir: "dist"`, which is not this
  // directory. `PACKAGED_WEB_UI_DIR` already holds the built, packaged
  // output (built by `runBuildDaemonWebUi` above), so this just needs
  // Vite's static file server pointed at it with SPA fallback —
  // `appType: "spa"` is `apps/web/vite.config.ts`'s own default, kept
  // explicit here since that config file is not in play.
  //
  // `root` is `PACKAGED_WEB_UI_DIR`'s PARENT with `build.outDir` naming
  // `PACKAGED_WEB_UI_DIR`'s own basename, not `root: PACKAGED_WEB_UI_DIR`
  // with `outDir: "."` — the latter makes Vite warn ("build.outDir must
  // not be the same directory of root... this could cause Vite to
  // overwrite source files with build outputs") because it cannot tell
  // this call site only ever invokes `preview()`, never `build()`, against
  // this config.
  const server: PreviewServer = await preview({
    root: path.dirname(PACKAGED_WEB_UI_DIR),
    appType: "spa",
    logLevel: "warn",
    build: {
      outDir: path.basename(PACKAGED_WEB_UI_DIR),
    },
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
