/**
 * Lives in `app-shell/`, not the Expo Router root — see
 * `./compact-shell-slots.ts`'s doc comment (T32S2).
 *
 * T136 ("Make `router-root.test.ts` runnable without `expo-router`
 * installed"). `../app/router-root.test.ts` needs the exact regex
 * `expo-router`'s typed-routes generator uses to decide which files
 * under the router root count as part of the route union
 * (`EXPO_ROUTER_CTX_IGNORE`, from `expo-router/_ctx-shared` —
 * `require-context-ponyfill.js`'s `getWatchHandler`/`defaultCtx`).
 * `expo-router` is declared in `apps/android/package.json` but has
 * never been installed here (T87/T116 — vendoring or stubbing the
 * *package* is settled as prohibited), so a bare
 * `require("expo-router/_ctx-shared")` fails module resolution during
 * *collection*, not inside a test body, which took the whole file to
 * zero tests rather than one failure.
 *
 * This module vendors only the one artifact that test needs — the
 * regex text and its use-site behaviour — never the package. The
 * behaviour, as this repository has understood it since before this
 * task (see the git history of `../app/router-root.test.ts`'s own
 * top-of-file comment, predating T136): a relative path (`./index.tsx`,
 * `./_layout.tsx`, `./dev/component-lab.tsx`, `./h/[serverId]/(tabs)/
 * sessions.tsx`, `.test.ts`/`.spec.ts` files too) matches — i.e. counts
 * as part of the route union `require.context`'s ponyfill walks — for
 * every file *except* the three Expo Router special-file conventions
 * that are deliberately excluded from the typed-routes union: `+api`,
 * `+html`, and `+native-intent` (each with a `.js`/`.jsx`/`.ts`/`.tsx`
 * extension).
 *
 * PROVENANCE, STATED PLAINLY: no installed copy of `expo-router` exists
 * anywhere reachable from this checkout to diff this against — not
 * `apps/android/node_modules` (never installed, T87/T116), not the
 * global npm cache, not the read-only `D:\paseo` or `D:\pi-web`
 * reference checkouts (neither has `expo-router` under its
 * `node_modules` either; checked directly before writing this file).
 * This regex is therefore this repository's own faithful
 * re-implementation of the BEHAVIOUR documented above, not a verified
 * byte-for-byte copy of the real package's source text.
 * `../app/router-root.test.ts`'s "vendored EXPO_ROUTER_CTX_IGNORE parity
 * with the real expo-router package" block exists precisely so that the
 * day `expo-router` becomes installable again, a single test run either
 * confirms this text is right or names exactly how it drifted — see
 * `tryRequireRealCtxIgnore` below, and that block's own doc comment for
 * how the "package present" branch is proven live without an install.
 */
export const EXPO_ROUTER_CTX_IGNORE =
  /^\.\/(?:.*\/)?(?!.*(?:\+api|\+html|\+native-intent)\.[jt]sx?$).*\.[jt]sx?$/;

/**
 * Text-level equality for two `EXPO_ROUTER_CTX_IGNORE` candidates —
 * `.source` and `.flags` both, since two regexes can be behaviourally
 * identical yet fail `===` (they are different object references) or,
 * conversely, look similar but differ in flags. Exported (not inlined
 * into the parity test) so a colocated unit test can feed it two
 * synthetic regexes — one identical, one deliberately different — and
 * prove it actually distinguishes them, independent of whether
 * `expo-router` is installed anywhere.
 */
export function regexTextEquals(a: RegExp, b: RegExp): boolean {
  return a.source === b.source && a.flags === b.flags;
}

/**
 * Attempts to load the REAL `EXPO_ROUTER_CTX_IGNORE` from an installed
 * `expo-router/_ctx-shared`, returning `null` when the package cannot be
 * resolved rather than throwing — this is what lets the parity test
 * skip instead of failing collection the way the pre-T136 file did.
 *
 * Takes `requireFn` as a parameter (rather than calling
 * `createRequire(import.meta.url)` internally) purely so a colocated
 * unit test can inject a fake `requireFn` — one that throws
 * `MODULE_NOT_FOUND` (proving the "absent" branch returns `null` and
 * never throws) and one that returns a fabricated module object
 * (proving the "present" branch actually reads `EXPO_ROUTER_CTX_IGNORE`
 * back out and returns it) — without needing a real `expo-router`
 * install to exercise either branch. `../app/router-root.test.ts`'s
 * parity block calls this with a real `createRequire(import.meta.url)`
 * bound to itself.
 */
export function tryRequireRealCtxIgnore(requireFn: (specifier: string) => unknown): RegExp | null {
  let mod: unknown;
  try {
    mod = requireFn("expo-router/_ctx-shared");
  } catch {
    return null;
  }
  const candidate = (mod as { EXPO_ROUTER_CTX_IGNORE?: unknown } | null | undefined)
    ?.EXPO_ROUTER_CTX_IGNORE;
  return candidate instanceof RegExp ? candidate : null;
}
