import { Redirect } from "expo-router";

import { destinationHref } from "../app-shell/top-level-destinations.js";
import { useColdStartHasShareIntent, useColdStartProfile } from "./core-context";

/**
 * `/` — T32S1C, cold-start behavior confirmed by T32S2, made
 * stored-connection-aware by T32S3 (item 3).
 *
 * `frontend-core`'s navigation module (T24) makes `{ type: "connect" }`
 * the platform-neutral navigation stack's single starting entry
 * (`createInitialNavigationState`'s default), which `destinationHref`
 * renders as `/connect` (`../app-shell/top-level-destinations.ts`). Expo
 * Router still needs a file at the literal filesystem root for a cold
 * start to have anywhere to land, so this route exists only to send it
 * on to the right next path — it owns no screen of its own. `connect.tsx`
 * (this directory) is the real "connect" family stub.
 *
 * A stored-connection-aware cold start (skipping `/connect` straight to
 * `/h/:serverId/sessions` when a saved host profile already exists) used
 * to be blocked on a real problem: `SecureStorage`/`KeyValueStorage` are
 * both async, `<Redirect>` has to resolve synchronously on first render,
 * and rendering `/connect` first and redirecting again once the read
 * resolved would itself be the "wrong screen flashes first" this task's
 * acceptance criteria rule out. `./core-context.tsx`'s `AppCoreProvider`
 * closes that gap one level up — the whole router tree, this route
 * included, does not mount until its cold-start profile read has
 * settled (see that file's doc comment) — so by the time this component
 * ever runs, `useColdStartProfile()` is not a "maybe still loading"
 * value, and `<Redirect>` here still resolves synchronously on its very
 * first render, exactly as `<Redirect>` requires; it is simply not
 * *this* component's first render of the whole cold start anymore.
 *
 * What deep links DO get here: any `picompanion://...` path Expo Router
 * matches to a real route (every file under `h/[serverId]/`) reaches
 * that screen directly, file-based routing needing no code in this file
 * at all; anything else renders `+not-found.tsx` instead of this route
 * (`../app-shell/deep-link-routing.ts`'s `matchDeepLinkPath` is the pure
 * function proving which paths fall into each bucket).
 *
 * `hasInitialShare` (T32S15) closes the cold-start half of the gap
 * `../app/share.tsx`'s own doc comment named against this task by name:
 * a cold start launched *by* a real OS share intent used to land on the
 * ordinary redirect target above (the deep-link path never runs for a
 * share — a share is not a `picompanion://...` URL) because this route
 * checked only `useColdStartProfile()`. `useColdStartHasShareIntent()`
 * is resolved through the exact same `AppCoreProvider` gate, so it is
 * never a second "maybe still loading" read — see that hook's own doc
 * comment. Checked first, ahead of the profile branch: a share still
 * needs somewhere to land even from a device with no saved profile yet
 * (`/share` itself handles that case named, not by crashing — see its
 * own doc comment).
 */
export default function IndexRoute() {
  const profile = useColdStartProfile();
  const hasInitialShare = useColdStartHasShareIntent();
  const href = hasInitialShare
    ? "/share"
    : profile
      ? destinationHref({ type: "sessionList", serverId: profile.id })
      : "/connect";
  return <Redirect href={href} />;
}
