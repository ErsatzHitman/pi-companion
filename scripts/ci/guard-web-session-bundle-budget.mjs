// T44A1: CI guard — the web session route (`/h/:serverId/session/:agentId`,
// `apps/web/src/routes/host-session.tsx`) must ship under the plan.md
// §14.5 budget: "web session route ... under 500 KiB gzip for initial
// JavaScript and CSS, excluding lazy terminal/editor/diff chunks."
//
// ## T44A1's classification of every plan.md §14.5 budget
//
// This is the deliverable T44A1's brief calls for before any gate is
// built: which of §14.5's budgets can be measured in this environment
// (no browser, no device, no `npm install`), and which cannot. Measured
// on `HEAD` at the time this file was written; each bullet names the real
// evidence, not an assumption.
//
// 1. **Web session route, <500 KiB gzip initial JS+CSS, excluding lazy
//    terminal/editor/diff chunks.** MEASURABLE STATICALLY IN CI TODAY —
//    this file and `run-guard-web-session-bundle-budget.mjs` are that
//    gate. Measured (see this task's report): **244,393 bytes (238.67
//    KiB) gzip**, well inside the 512,000-byte (500 KiB) budget.
//
// 2. **Live-event-to-paint p95 <100 ms on web.** MEASURABLE STATICALLY IN
//    CI TODAY, and ALREADY MEASURED AND GATED — not a gap this task
//    needed to fill. `apps/web/src/platform/frame-clock.paint-budget.test.tsx`
//    (T45A3) drives the real `FrameClock` + `TimelineCoalescer` +
//    `Transcript` stack at 100 simulated updates/second under fake timers
//    and asserts the p95 bound directly; it runs as part of `apps/web`'s
//    ordinary vitest suite, which `.github/workflows/ci.yml`'s `web-tests`
//    job runs whenever the `web` (or `full`) path filter matches. No new
//    gate was added for this bullet.
//
// 3. **The same budget at 200 ms on a Pixel 8 API 35 reference emulator.**
//    NOT MEASURABLE HERE — this requires a real Android emulator (or
//    device) and an actual paint pipeline; nothing in this repository's CI
//    or this workstation can produce that measurement, and T208 is already
//    on record as owner-blocked on `EXPO_TOKEN` plus an emulator for the
//    same reason. Not silently dropped: this is the one §14.5 bullet this
//    task leaves entirely unmeasured, and it stays that way until a real
//    device/emulator run exists (T44A4's CI matrix or a dedicated Android
//    perf task would be the place, not a proxy invented here).
//
// 4. **Transcript: 10,000 timeline items without an unbounded render
//    window.** MEASURABLE STATICALLY IN CI TODAY, and ALREADY MEASURED AND
//    GATED on both platforms. Web:
//    `apps/web/src/features/transcript/transcript.test.tsx` ("renders a
//    10,000-item transcript within a bounded DOM window"). Android:
//    `apps/android/src/features/transcript/transcript-window-model.test.ts`
//    ("asserts the exact retained-row count and hidden-older count at
//    10,000 rows"). Both run in their workspace's ordinary vitest suite.
//
// 5. **Extension log: cap the mounted line count to 200 on both
//    platforms.** MEASURABLE STATICALLY
//    IN CI TODAY, and ALREADY MEASURED AND GATED — RESOLVED, not merely
//    disclosed, as of T226. Both platforms now share one threshold and one
//    mechanism: a cap on how many of the payload's `lines` are ever
//    mounted (200, when the payload names no `tail` of its own), not a
//    scrolling render-window virtualization — see plan.md §14.5 and §11.3
//    for the recorded product decision. Android:
//    `apps/android/src/features/extensions/renderers/renderers-model.test.ts`
//    ("bounds the log to the bridge contract's default tail of 200 lines"),
//    asserting the named `DEFAULT_LOG_TAIL` export from `log-model.ts`, not
//    a repeated literal. Web:
//    `apps/web/src/features/extensions/renderers/log-markdown-composer.test.tsx`
//    ("bounds the log to the shared default tail of 200 lines"), asserting
//    the same-named `DEFAULT_LOG_TAIL` export from `log.tsx`. Both run in
//    their workspace's ordinary vitest suite; no new check was added to
//    THIS guard, because the thing being verified — that a named constant
//    equals a value — is not a bundle-size measurement this file's Vite
//    manifest reading has any way to see, the same reason item 4, 6 and 7
//    above are gated by each workspace's own suite rather than by this
//    file.
//    (RESOLVED at T226, which also fixed this classification's own
//    citation of "plan.md §11.4" for the payload-arrives-pre-bounded
//    rationale: that citation belongs to §11.4's "payload size limits"
//    bullet, which is correct as far as it goes, but the disagreement this
//    item used to describe — the `log` row's Web/Android presentation
//    cells — lives in §11.3's frozen-bridge-vocabulary table, not §11.4.
//    Before T226: web capped at `DEFAULT_LOG_TAIL = 500` while Android
//    capped at 200, and plan.md §11.3's table called web's presentation
//    "virtualized log" while Android's was "tail-following list" — two
//    thresholds and two named mechanisms for one budget bullet. T226
//    lowered web's constant to 200 and reworded §11.3's `log`/Web cell to
//    "tail-capped log" to match what the code actually does on both
//    platforms.)
//
// 6. **No bridge update rate above 20 messages/second per agent.**
//    MEASURABLE STATICALLY IN CI TODAY, and ALREADY PINNED — by exact
//    equality, which is stricter than any bound this classification
//    could have proposed.
//    `packages/server/src/server/agent/agent-stream-coalescer.ts`'s
//    `AGENT_STREAM_COALESCE_DEFAULT_WINDOW_MS = 60` coalesces same-agent
//    stream deltas into at most one flush per 60 ms window
//    (`1000 / 60 ≈ 16.67` flushes/sec, inside the 20/sec budget), and
//    `agent-stream-coalescer.test.ts`'s "pins
//    AGENT_STREAM_COALESCE_DEFAULT_WINDOW_MS at 60" test asserts
//    `expect(AGENT_STREAM_COALESCE_DEFAULT_WINDOW_MS).toBe(60)` — an
//    equality pin, so ANY change to that constant (not just one that
//    raises the rate) fails `@picompanion/server`'s ordinary suite, which
//    `.github/workflows/ci.yml`'s `server-tests` jobs run whenever the
//    `backend` (or `full`) path filter matches.
//
//    The rationale connecting 60 ms to §14.5's 20 msg/s is not missing: it
//    is the pin test's own title, which states the connection directly.
//    Nothing further is needed from this guard for that gap.
//    (CORRECTED at T274: this paragraph used to say the rationale was
//    "genuinely missing" and that the pin sat "inside a test titled about
//    something else," citing a line number for both claims. Neither holds
//    today — `agent-stream-coalescer.test.ts`'s
//    `AGENT_STREAM_COALESCE_DEFAULT_WINDOW_MS` pin test is titled "pins
//    AGENT_STREAM_COALESCE_DEFAULT_WINDOW_MS at 60, which plan.md §14.5's
//    20 msg/s per-agent bridge budget depends on" — the exact rationale
//    this paragraph once called absent, now stated in the pin's own name.)
//    (CORRECTED at the P9-W1 merge gate: this said the budget was "NOT
//    DIRECTLY GATED by any dedicated assertion today", that a change
//    "could silently raise the real rate above budget with nothing
//    failing", and named `assert.ok(AGENT_STREAM_COALESCE_DEFAULT_
//    WINDOW_MS >= 50)` as the fix. The exact-equality pin above already
//    ships in the file this classification searched, and is stricter, so
//    that recommendation would have added a weaker duplicate and closed
//    a hole that was never open.)
//
// 7. **Terminal 4 MiB soft / 8 MiB hard backpressure.** MEASURABLE
//    STATICALLY IN CI TODAY, and ALREADY MEASURED AND GATED — in the two
//    files that actually declare the pair, each pinned by its own
//    colocated test:
//    `packages/frontend-core/src/terminal/terminal-output-buffer.ts`
//    (`TERMINAL_OUTPUT_SOFT_BUFFER_BYTES = 4 * 1024 * 1024`,
//    `TERMINAL_OUTPUT_HARD_BUFFER_BYTES = 8 * 1024 * 1024`, asserted by
//    value in `terminal-output-buffer.test.ts`), and
//    `apps/android/src/features/terminal/terminal-output-buffer.ts`
//    (`TERMINAL_OUTPUT_BUFFER_SOFT_BYTES` /
//    `TERMINAL_OUTPUT_BUFFER_HARD_BYTES`, the same two values, with a
//    flood test asserting `bufferedBytes` never exceeds the hard cap).
//    Both run in their workspace's ordinary vitest suite.
//    (CORRECTED at the P9-W1 merge gate: this attributed the thresholds
//    to `terminal-session-controller.ts` and `physical-socket.ts`.
//    Neither declares them — the controller imports a 4 MiB
//    `MAX_CLIENT_BUFFERED_BYTES` from `terminal-restore.ts`, and
//    `physical-socket.ts`'s `MAX_PHYSICAL_SOCKET_BUFFERED_BYTES` is
//    **64 MiB**, an OOM backstop its own comment distinguishes from a
//    frame-size violation. The verdict was right and the citation was
//    wrong, which is the worse half: a reader checking it would find
//    64 MiB and conclude the 8 MiB budget is unenforced.)
//
// 8. **Reconnect restores cached content immediately and starts
//    authoritative catch-up within one second of socket readiness.**
//    MEASURABLE STATICALLY IN CI TODAY, and ALREADY MEASURED AND GATED.
//    `apps/web/src/platform/lifecycle-resume-reconciliation.test.ts`
//    (T46A3) asserts the one-second reconciliation trigger against the
//    real resume-controller stack; it runs in `apps/web`'s ordinary vitest
//    suite.
//
// Net: seven of the eight items above are already measured and gated
// (six pre-existing, plus this task's new #1), and one (#3, the Android
// emulator paint budget) genuinely cannot be measured in this environment
// and is disclosed rather than faked. #5 (extension log) was disclosed as
// a genuine cross-platform disagreement until T226 resolved it (one
// threshold, one mechanism, recorded in plan.md); it is now measured and
// gated like the others, not merely disclosed.
//
// The eight items above are NOT one-to-one with §14.5's eight bullets,
// and the totals matching is a coincidence: §14.5's frame-clock-mechanism
// bullet is design rationale rather than a threshold and has no item
// here, while its single paint bullet is split into #2 (web, measurable
// in CI) and #3 (Android emulator, not measurable here) because the two
// halves have opposite answers. Read §14.5 itself for the plan's list;
// this one is organised by what CI can check.
// (CORRECTED at the P9-W1 merge gate: this said "of §14.5's eight
// budgets" — implying a bullet-for-bullet mapping that does not hold —
// and counted the bridge rate as ungated, which #6 above now corrects.)
//
// ## Why this needs a real Vite manifest, not a directory-size heuristic
//
// `apps/web`'s route tree (`src/routes/route-tree.ts`) code-splits every
// screen behind `lazyRouteComponent(() => import(...))` (T15/T25). A
// fresh navigation to the session route therefore loads: the app's shared
// entry chunk (React, the router, shared UI primitives — always paid,
// every route) PLUS the session screen's own chunk — and nothing else,
// because Vite/Rolldown only ever bundles a module into a chunk reachable
// by a STATIC import edge. The terminal screen (xterm), the file/diff
// screen (CodeMirror + `@picompanion/highlight`) and every other screen
// are each behind their OWN `import()`, so they never enter the session
// screen's static closure — that is the actual mechanism §14.5's
// "excluding lazy terminal/editor/diff chunks" clause is describing, not
// an exemption this guard has to apply by hand.
//
// A directory-size or whole-`dist`-size check cannot tell any of this
// apart: it would count the terminal/editor chunks as part of "the
// session route's" cost. Re-measured at the P9-W1 merge gate from the
// real built chunks with `zlib.gzipSync(level: 9)`, the same level
// `run-guard-web-session-bundle-budget.mjs` compresses with, on the
// emitted bytes minus the trailing `sourceMappingURL` comment (which the
// guard's own sourcemap-less build never emits): `xterm-*.js` is 331,215
// bytes raw -> 82,138 gzip, and `@picompanion/highlight`'s
// `file-syntax-highlight-*.js` is 707,982 raw -> 230,900 gzip — either one
// alone is a large fraction of the whole 512,000-byte budget. Counting
// them here would be exactly the double-count §14.5 says NOT to make.
// So this guard reads Vite's own
// `.vite/manifest.json` (`build.manifest: true`) — the same module graph
// Vite used to decide chunking — and walks only STATIC `imports` edges
// from two roots: the entry (`index.html`) and the session screen's own
// module (`SESSION_ROUTE_MODULE_KEY`). `dynamicImports` edges are never
// followed; that is what keeps terminal/editor/diff out.
//
// ## Calibration, measured at `HEAD` via a real throwaway `vite build`
//
// `run-guard-web-session-bundle-budget.mjs` runs an actual `vite build`
// (with `build.manifest: true`, to a scratch `outDir` — it never touches
// `apps/web/dist`, the artifact `scripts/build-daemon-web-ui.mjs` and the
// packaging steps around it depend on) against the real, checked-in
// `apps/web/vite.config.ts`, then gzips (`zlib.gzipSync`, level 9) every
// file this module's `listInitialAssetFiles` resolves and sums the
// compressed bytes. See this task's report for the exact measured
// number and the file-by-file breakdown — no number in this file's
// thresholds is invented or copied from a different run.
//
// ## Fails loudly, never silently, on a graph it cannot resolve
//
// If `ENTRY_HTML_KEY` or `SESSION_ROUTE_MODULE_KEY` is missing from a
// manifest, `listInitialAssetFiles` THROWS rather than returning an empty
// or partial set — an empty set here would silently report "0 bytes,
// budget met", which is the exact "check that cannot fail" shape
// catalogued repeatedly in this repository (a route rename or a route
// tree restructure must break this guard loudly, not go quiet). See
// `guard-web-session-bundle-budget.test.mjs` for the fixture-level proof
// (a manifest missing the route key throws) and this task's report for
// the real-build RED/GREEN proof (moving the budget, not the code).
export const ENTRY_HTML_KEY = "index.html";

/** The session screen's manifest key — the Vite-relative module path
 * `apps/web/src/routes/screens/host-session-screen.tsx` resolves to. This
 * is the one piece of this module that a route-tree refactor could move;
 * see the module header above for why a missing key throws instead of
 * silently measuring nothing. */
export const SESSION_ROUTE_MODULE_KEY = "src/routes/screens/host-session-screen.tsx";

/** plan.md §14.5: "under 500 KiB gzip for initial JavaScript and CSS,
 * excluding lazy terminal/editor/diff chunks." KiB is binary (1024), not
 * the decimal "KB" some tooling uses — 500 * 1024, not 500 * 1000. */
export const SESSION_BUNDLE_BUDGET_BYTES = 500 * 1024;

/**
 * @typedef {{
 *   file?: string,
 *   isEntry?: boolean,
 *   css?: string[],
 *   imports?: string[],
 *   dynamicImports?: string[],
 * }} ViteManifestEntry
 * @typedef {Record<string, ViteManifestEntry>} ViteManifest
 */

/**
 * Walks a Vite manifest's STATIC `imports` graph (never `dynamicImports`)
 * starting from `rootKeys`, and returns every reachable entry's `file`
 * (its emitted JS chunk) plus every `css` file it lists — deduplicated,
 * in first-seen order. Throws if any root key is absent from the
 * manifest, since a missing root means this guard cannot see the real
 * graph at all (see module header).
 *
 * @param {ViteManifest} manifest
 * @param {string[]} rootKeys
 * @returns {string[]} asset file paths (JS and CSS), deduplicated
 */
export function collectStaticClosureAssets(manifest, rootKeys) {
  const seenKeys = new Set();
  const assetFiles = [];
  const seenAssetFiles = new Set();
  const queue = [];

  for (const rootKey of rootKeys) {
    if (!Object.hasOwn(manifest, rootKey)) {
      throw new Error(
        `guard-web-session-bundle-budget: manifest has no entry for "${rootKey}" — the route ` +
          "tree or entry html may have moved. This guard must not silently measure an empty " +
          "graph; update SESSION_ROUTE_MODULE_KEY (or ENTRY_HTML_KEY) to match.",
      );
    }
    queue.push(rootKey);
  }

  function addAsset(file) {
    if (file && !seenAssetFiles.has(file)) {
      seenAssetFiles.add(file);
      assetFiles.push(file);
    }
  }

  while (queue.length > 0) {
    const key = queue.shift();
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);

    const entry = manifest[key];
    if (!entry) continue; // an `imports` edge Vite recorded but this manifest lacks — skip, don't throw.

    addAsset(entry.file);
    for (const cssFile of entry.css ?? []) addAsset(cssFile);

    // Deliberately `imports` only — never `dynamicImports`. That is the
    // entire mechanism this guard relies on to exclude the terminal,
    // file-editor and diff chunks; see module header.
    for (const importedKey of entry.imports ?? []) {
      if (!seenKeys.has(importedKey)) queue.push(importedKey);
    }
  }

  return assetFiles;
}

/**
 * The full set of asset files (JS + CSS) a fresh navigation to the web
 * session route must fetch before it can paint: the shared entry closure
 * plus the session screen's own closure.
 *
 * @param {ViteManifest} manifest
 * @returns {string[]}
 */
export function listInitialAssetFiles(manifest) {
  return collectStaticClosureAssets(manifest, [ENTRY_HTML_KEY, SESSION_ROUTE_MODULE_KEY]);
}

/**
 * @param {number} totalGzipBytes
 * @param {number} [budgetBytes]
 * @returns {{ ok: boolean, totalGzipBytes: number, budgetBytes: number, message: string }}
 */
export function checkSessionBundleBudget(
  totalGzipBytes,
  budgetBytes = SESSION_BUNDLE_BUDGET_BYTES,
) {
  const ok = totalGzipBytes <= budgetBytes;
  const fmtKiB = (bytes) => (bytes / 1024).toFixed(2);
  const message = ok
    ? `OK — ${totalGzipBytes} byte(s) (${fmtKiB(totalGzipBytes)} KiB) gzip, within the ` +
      `${budgetBytes} byte(s) (${fmtKiB(budgetBytes)} KiB) budget.`
    : `FAILED — ${totalGzipBytes} byte(s) (${fmtKiB(totalGzipBytes)} KiB) gzip exceeds the ` +
      `${budgetBytes} byte(s) (${fmtKiB(budgetBytes)} KiB) budget by ` +
      `${totalGzipBytes - budgetBytes} byte(s).`;
  return { ok, totalGzipBytes, budgetBytes, message };
}
