/**
 * Native share-intent listener port (T36C).
 *
 * "Android share intents arrive through the OS, and you cannot receive
 * one here" (this task's brief). Nothing in this repository can
 * register as an Android share target and hand a real `ACTION_SEND`
 * `Intent` to JS yet:
 *
 *   - `expo-linking`'s `Linking.addEventListener("url", …)` only ever
 *     carries a *URI string* (a `VIEW`-action deep link such as
 *     `picompanion://…`); an `ACTION_SEND` intent's `EXTRA_TEXT`/
 *     `EXTRA_STREAM` extras are not a URI and never reach that
 *     listener. Routing shared content through a deep-link URL would
 *     also mean putting untrusted shared content in a URL/query
 *     string, which this task's brief explicitly prohibits.
 *   - No share-intent native module (e.g. `expo-share-intent`) is
 *     installed in this workspace, and this task may not run `npm
 *     install` — see this feature's report for the exact command.
 *   - Registering this app as a share target at all requires an
 *     `android.intentFilters` entry in `apps/android/app.config.ts`,
 *     which is outside this task's grant (`features/share/` only) —
 *     see this feature's report for the exact config and the seam
 *     filed against it.
 *
 * `ShareIntentPort` is the seam a real listener implements once one of
 * the above is available: it hands already-parsed
 * `RawShareIntent`s (never a raw native `Intent`) to a subscriber.
 * `createUnavailableShareIntentPort` is this build's only
 * implementation — same "unavailable" convention as
 * `../composer/attachment-source-port.ts` and
 * `../connect/qr-scanner-port.ts` — and never calls its subscriber.
 */
import type { RawShareIntent } from "./share-intent-model.js";

export interface ShareIntentPort {
  /**
   * The share intent that launched (or resumed) the app, if any, read
   * once at startup — mirrors `Linking.getInitialURL()`'s shape for a
   * deep link. Resolves to `null` when the app was not opened via a
   * share, or when this port is unavailable.
   */
  getInitialShareIntent(): Promise<RawShareIntent | null>;
  /**
   * Subscribes to share intents that arrive while the app is already
   * running. Returns an unsubscribe function, mirroring
   * `Linking.addEventListener`'s subscription shape.
   */
  subscribe(handler: (intent: RawShareIntent) => void): () => void;
}

/** This build's only production `ShareIntentPort` — see module docstring. */
export function createUnavailableShareIntentPort(): ShareIntentPort {
  return {
    async getInitialShareIntent() {
      return null;
    },
    subscribe() {
      return () => {};
    },
  };
}
