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
 * PROVENANCE (T200, corrected). This is now a verified byte-for-byte copy
 * of `expo-router@6.0.13`'s own `_ctx-shared.js`, from two independent
 * sources that agree exactly:
 *
 *   1. GitHub Actions run 34022711589, where the parity test below ran for
 *      the FIRST time and printed the installed package's value.
 *   2. `https://unpkg.com/expo-router@6.0.13/_ctx-shared.js`, read directly.
 *
 * CORRECTED (T200): this said no installed copy of `expo-router` exists
 * anywhere reachable, and that the regex was therefore this repository's
 * own re-implementation of the behaviour rather than a verified copy. The
 * first half was a fact about THIS WORKSTATION, not about the repository:
 * `npm ci` installs `expo-router` normally on a CI runner, which is why
 * the parity test skips here and runs there. The second half was true, and
 * the re-implementation had drifted. It read:
 *
 *   /^\.\/(?:.*\/)?(?!.*(?:\+api|\+html|\+native-intent)\.[jt]sx?$).*\.[jt]sx?$/
 *
 * Two differences, one cosmetic and one real. Cosmetic: `[jt]` vs `[tj]`.
 * Real: the vendored copy excluded `+html` and `+native-intent` at ANY
 * depth, while the real one excludes them only at the router root — only
 * `+api` is excluded at any depth. So `./dev/+html.tsx` counts as part of
 * the route union in expo-router and did not in the vendored copy. No file
 * in this tree exercises that difference today (the only `+` file is
 * `../app/+not-found.tsx`, which is not one of the three), so the drift was
 * latent — which is exactly why only a real installed copy could catch it.
 *
 * `../app/router-root.test.ts`'s parity block is what caught this, working
 * as designed. Keep it: it is the only thing standing between this constant
 * and the next expo-router release that changes the regex again.
 */
export const EXPO_ROUTER_CTX_IGNORE =
  /^(?:\.\/)(?!(?:(?:(?:.*\+api)|(?:\+(html|native-intent))))\.[tj]sx?$).*\.[tj]sx?$/;

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
