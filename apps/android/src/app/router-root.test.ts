import { createRequire } from "node:module";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  EXPO_ROUTER_CTX_IGNORE,
  regexTextEquals,
  tryRequireRealCtxIgnore,
} from "../app-shell/expo-router-ctx-ignore";

// T136: this used to be `require("expo-router/_ctx-shared")` directly —
// `expo-router` is declared in `apps/android/package.json` but has never
// been installed here (T87/T116), so that call failed module resolution
// during *collection*, which took this entire file to zero tests rather
// than one failure. `expo-router` is now never required at collection
// time; `EXPO_ROUTER_CTX_IGNORE` is a local vendored copy (see
// `../app-shell/expo-router-ctx-ignore.ts` for the regex text, its
// provenance, and what could and could not be verified against a real
// installed copy). The parity block at the end of this file requires the
// real package lazily, inside a test body, and skips visibly rather than
// failing collection when it is absent — exactly as it is today.

const ROUTER_ROOT = fileURLToPath(new URL(".", import.meta.url));

/**
 * Mirrors `expo-router/build/testing-library/require-context-ponyfill.js`
 * exactly (plain recursive `readdirSync`, filtered by `regularExpression`
 * against the `./`-relative path) — that ponyfill, not Metro's bundler
 * resolver, is what actually walks the filesystem to decide the typed
 * `.expo/types/router.d.ts` route union (`getWatchHandler`'s
 * `defaultCtx`). It is unaffected by `metro.config.js`'s `blockList`,
 * which only governs what Metro's bundler can resolve — this is why
 * T32S2 moved non-route modules out of the router root instead of
 * trying to extend that blockList (see `../app-shell/compact-shell-slots.ts`'s
 * doc comment).
 */
function walkLikeExpoRouterTypedRoutes(base: string): string[] {
  const files: string[] = [];
  function read(dir: string) {
    for (const entry of readdirSync(dir)) {
      const fullPath = path.resolve(dir, entry);
      const relativePath = `./${path.relative(base, fullPath).split(path.sep).join("/")}`;
      if (statSync(fullPath).isDirectory()) {
        read(fullPath);
        continue;
      }
      if (!EXPO_ROUTER_CTX_IGNORE.test(relativePath)) continue;
      files.push(relativePath);
    }
  }
  read(base);
  return files;
}

/**
 * Router-root scan coverage — T32S2 (1): "Ten non-route modules under the
 * router root are silently registered as routes."
 *
 * Every `.ts`/`.tsx` file under `apps/android/src/app/` that
 * `EXPO_ROUTER_CTX_IGNORE` matches becomes part of the typed-routes union
 * and (for `.tsx` files with no default export, in a production bundle)
 * a broken route node in the real linking config — see this file's own
 * task notes. This test proves the file list matches an explicit
 * allowlist rather than trusting a directory listing: a real route, a
 * `_layout`, or one of the two documented, still-in-place exceptions
 * (`KNOWN_NON_ROUTE_EXCEPTIONS` below). T32S2 left four; T32S3 (item 2)
 * removed two of them, and the count here was never updated.
 *
 * `.test.ts`/`.spec.ts` files also match `EXPO_ROUTER_CTX_IGNORE` (it
 * only excludes `+api`/`+html`/`+native-intent`) and are filtered out of
 * `foundFiles` below before comparing against the allowlist. That is a
 * separate, pre-existing leak this task does not own: `metro.config.js`'s
 * `TEST_FILE_BLOCK_PATTERN` (T58C) keeps them out of the Metro-bundled
 * app, but — like the `blockList` limitation above — has no effect on
 * this ponyfill-driven typed-routes walk. Out of scope here.
 */
/**
 * Comments stripped before matching (P5-W16 merge gate, applying the
 * pattern T57B filed against this file): a route's doc comment that
 * merely mentions `export default` must not be able to satisfy -- or
 * falsely trip -- an assertion about whether the module really has one.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

describe("Expo Router root contains only real routes (or a named exception)", () => {
  const isTestFile = /\.(?:test|spec)\.[^/\\.]+$/;
  const foundFiles = walkLikeExpoRouterTypedRoutes(ROUTER_ROOT).filter(
    (relativePath) => !isTestFile.test(relativePath),
  );

  // Every real route file `EXPO_ROUTER_CTX_IGNORE` should still see.
  const REAL_ROUTES = new Set([
    "./_layout.tsx",
    "./index.tsx",
    "./connect.tsx",
    "./share.tsx",
    "./+not-found.tsx",
    "./dev/component-lab.tsx",
    "./dev/recipe-lab.tsx",
    // T135: `./dev/recovered-turn-lab.tsx` (T106, `da96860`) and
    // `./dev/session-tree-lab.tsx` (T39A, `4703bcb`) both have default
    // exports and are legitimately reachable dev routes — they simply
    // were never added here. Re-enumerated `apps/android/src/app/**`
    // directly (not trusting this list, or the P6-W10 gate's list) before
    // adding these: every other `.ts`/`.tsx` file under the router root
    // is already accounted for in `REAL_ROUTES` or
    // `KNOWN_NON_ROUTE_EXCEPTIONS` below.
    "./dev/recovered-turn-lab.tsx",
    "./dev/session-tree-lab.tsx",
    "./h/[serverId]/(tabs)/_layout.tsx",
    "./h/[serverId]/(tabs)/sessions.tsx",
    "./h/[serverId]/(tabs)/settings.tsx",
    // P7-W7 merge gate: mounts the `DiagnosticsScreen` T42A3 built, at
    // the same `/h/:serverId/diagnostics` path web serves it at. Not
    // under `(tabs)/` because diagnostics is not a tab and there is no
    // `{ type: "diagnostics" }` navigation intent, on either platform.
    "./h/[serverId]/diagnostics.tsx",
    // T42A1: mounts the real `DevicesScreen` at `/h/:serverId/devices` —
    // the same "plain path route, not under `(tabs)/`" shape as
    // diagnostics.tsx above (devices is not a tab either).
    "./h/[serverId]/devices.tsx",
    "./h/[serverId]/session/[agentId]/index.tsx",
    "./h/[serverId]/session/[agentId]/files/[...path].tsx",
    "./h/[serverId]/session/[agentId]/terminal/[terminalId].tsx",
  ]);

  // T32S3 (item 2) re-checked all four of T32S2's remaining exceptions
  // against the *live filesystem* (`grep -rn 'from ".*<module>"'` over
  // `apps/android/src`, not just re-reading this comment, which turned
  // out to be stale on two of the four) rather than trusting the prior
  // wave's notes:
  //   - `./resume-signals.ts`'s only importers turned out to be
  //     `./core-context.tsx` and `./core.ts` — not `platform/
  //     lifecycle.ts`, as the stale comment here previously claimed —
  //     both inside this task's own grant, so it moved outright to
  //     `../app-shell/resume-signals.ts`, both import sites updated, no
  //     shim left behind.
  //   - `./core.ts`'s only importer, once `resume-signals.ts` moved,
  //     turned out to be `./core-context.tsx` alone — not
  //     `features/connect/*`/`platform/frame-clock.ts`, as the stale
  //     comment here previously claimed — also inside this task's own
  //     grant, so it moved the same way, to `../app-shell/core.ts`.
  //   - `./core-context.tsx` and `./route-placeholder.tsx` really are
  //     still imported directly (not through this route tree) by
  //     `features/*` directories outside this task's own
  //     `apps/android/src/app/` Owns grant — `features/connect/`,
  //     `features/sessions/`, `features/files/`, and
  //     `features/terminal/` — confirmed the same way. Moving them (or
  //     leaving a re-export shim in their place, which would itself
  //     still match `EXPO_ROUTER_CTX_IGNORE` and so would not shrink
  //     this set at all) would require editing files this task cannot
  //     commit, so this set is genuinely as small as it can get within
  //     this task's grant: two, down from T32S2's four. Left in place,
  //     they still register as (harmless — they have no interactive UI,
  //     but also no default export) broken route nodes; fully resolving
  //     that is follow-up work for whichever task next owns editing
  //     those `features/*` directories, updating their imports to
  //     `../app-shell/...` alongside the move.
  const KNOWN_NON_ROUTE_EXCEPTIONS = new Set([
    "./core-context.tsx", // imported by features/connect/connection-shell.tsx, features/connect/use-connection-status.ts, features/sessions/sessions-screen.tsx
    "./route-placeholder.tsx", // imported by features/files/files-screen.tsx, features/terminal/terminal-screen.tsx
  ]);

  it("scans a non-empty set of files (the walk itself is exercised)", () => {
    expect(foundFiles.length).toBeGreaterThan(0);
  });

  it("contains no file outside REAL_ROUTES ∪ KNOWN_NON_ROUTE_EXCEPTIONS", () => {
    const unexpected = foundFiles.filter(
      (f) => !REAL_ROUTES.has(f) && !KNOWN_NON_ROUTE_EXCEPTIONS.has(f),
    );
    expect(unexpected).toEqual([]);
  });

  it("no longer finds the six modules T32S2 moved to ../app-shell/", () => {
    const moved = [
      "./compact-shell-slots.ts",
      "./compact-shell.tsx",
      "./error-boundary.tsx",
      "./host-tabs.ts",
      "./navigation-shell.tsx",
      "./top-level-destinations.ts",
    ];
    for (const relativePath of moved) {
      expect(foundFiles).not.toContain(relativePath);
    }
  });

  it("no longer finds the two further modules T32S3 (item 2) moved to ../app-shell/", () => {
    const moved = ["./core.ts", "./resume-signals.ts"];
    for (const relativePath of moved) {
      expect(foundFiles).not.toContain(relativePath);
    }
  });

  // T132 added `session-route-daemon-clients.ts` INSIDE the router root,
  // nested under the session route rather than at the top level. It has no
  // default export, so Expo Router's typed-routes generator would register
  // it as a broken route node -- exactly what T32S2 and T32S3 moved eight
  // modules out to prevent. The walk above is recursive and would have
  // caught it, except that -- until T136 -- this whole file collected zero
  // tests in every environment this repository has: `expo-router` is
  // declared but uninstallable (T87/T116), so the
  // `require("expo-router/_ctx-shared")` at the top used to throw during
  // collection. The P6-W10 merge gate found the file by enumerating the
  // directory directly. It now lives in `../app-shell/`, beside the
  // `core.ts` its own doc comment cites as its convention.
  //
  // CORRECTED (T136): this said the assertion below was "a record, not a
  // working gate" pending some other task making the file collect. As of
  // T136 (`../app-shell/expo-router-ctx-ignore.ts`'s vendored regex,
  // required unconditionally instead of the real `expo-router` package),
  // this whole `describe` block collects and runs today, with
  // `expo-router` absent exactly as it always has been here -- this
  // assertion is now a real, currently-passing gate, proven by
  // re-introducing this exact module at this exact path and watching it
  // fail (see T136's task report for the mutation and counts).
  it("no longer finds the module T132 added under the session route, moved to ../app-shell/", () => {
    expect(foundFiles).not.toContain(
      "./h/[serverId]/session/[agentId]/session-route-daemon-clients.ts",
    );
  });

  it("every REAL_ROUTES entry actually has a default export (so it is genuinely a route)", () => {
    for (const relativePath of REAL_ROUTES) {
      const source = stripComments(
        readFileSync(path.join(ROUTER_ROOT, relativePath.slice(2)), "utf8"),
      );
      expect(source, `${relativePath} should export a default component`).toMatch(
        /export default /,
      );
    }
  });

  it("every KNOWN_NON_ROUTE_EXCEPTIONS entry has no default export (proving it is not meant to be a route)", () => {
    for (const relativePath of KNOWN_NON_ROUTE_EXCEPTIONS) {
      const source = stripComments(
        readFileSync(path.join(ROUTER_ROOT, relativePath.slice(2)), "utf8"),
      );
      expect(source, `${relativePath} should not export a default`).not.toMatch(/export default /);
    }
  });
});

/**
 * T136 parity check: does `../app-shell/expo-router-ctx-ignore.ts`'s
 * vendored `EXPO_ROUTER_CTX_IGNORE` still match the real one?
 *
 * `expo-router` is not installed anywhere in this environment
 * (`apps/android/node_modules`, the global npm cache, and the read-only
 * `D:\paseo`/`D:\pi-web` reference checkouts were all checked before
 * writing the vendored copy — none has it), so today this engages the
 * "absent" branch below and skips VISIBLY (`it.skip`, which vitest
 * reports as a distinct skipped test, never as a pass) rather than
 * silently reporting green.
 *
 * "Would compare when present" is proven without an install by
 * `../app-shell/expo-router-ctx-ignore.test.ts`'s own coverage of
 * `tryRequireRealCtxIgnore`: it feeds that exact function (the one used
 * below, via a real `createRequire`) a fake `requireFn` that *succeeds*,
 * and shows the function reads `EXPO_ROUTER_CTX_IGNORE` back out of the
 * resolved module and returns it — the identical code path this file
 * takes below when `real !== null`, just with `requireFn` bound to a
 * real `expo-router` instead of a fake one. That is the comparison arm
 * proven live, not dead code: the only thing this environment cannot
 * supply is a real installed package to feed it, which is exactly the
 * gap this whole task exists to work around honestly rather than fake.
 */
describe("vendored EXPO_ROUTER_CTX_IGNORE parity with the real expo-router package", () => {
  const require = createRequire(import.meta.url);
  const real = tryRequireRealCtxIgnore((specifier) => require(specifier));

  if (real === null) {
    it.skip("matches the installed expo-router/_ctx-shared copy (SKIPPED: expo-router is not installed in this environment — T87/T116)", () => {});
  } else {
    it("matches the installed expo-router/_ctx-shared copy", () => {
      expect(
        regexTextEquals(EXPO_ROUTER_CTX_IGNORE, real),
        `vendored: ${EXPO_ROUTER_CTX_IGNORE}\nreal:     ${real}`,
      ).toBe(true);
    });
  }
});
