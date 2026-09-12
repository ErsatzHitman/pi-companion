import { composer as coreComposer } from "@picompanion/frontend-core";
import { useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";

import { destinationHref } from "../app-shell/top-level-destinations.js";
import {
  createInMemoryStructuredStorage,
  createSystemClock,
} from "../features/composer/in-memory-outbox-runtime.js";
import { createShareChooserRuntime } from "../features/share/share-chooser-runtime.js";
import {
  ShareChooserScreen,
  type ShareChooserDestination,
} from "../features/share/ShareChooserScreen.js";
import { useShareChooserSnapshot } from "../features/share/use-share-chooser.js";
import { useAppCore, useColdStartProfile } from "./core-context.js";

/**
 * `/share` — the share target chooser's entry point (T69, P5-W21,
 * plan.md §9.3). Before this task `features/share/` (T36C classification/
 * chooser/draft model, T36E receiver + `android.intentFilters`, T36F
 * native module + real `ShareIntentPort`) was complete, tested, and
 * unreachable — the P5-W19 gate flagged it as genuinely ownerless rather
 * than merely unmounted (see `docs/issues-from-plan.md`'s T69 section),
 * because no task had ever built the one screen an incoming share needs
 * to land on.
 *
 * Wires three things together, none of which invents new logic of its
 * own — every rule stays exactly where T36C/T36E/T36F/T69's own
 * `share-chooser-runtime.ts` already built and proved it:
 *
 *   1. `useAppCore().shareIntentPort` (T69's own `AppCore` mount, see
 *      that field's doc comment) is wrapped in `createShareChooserRuntime`
 *      — this route's own runtime instance, live only while this route is
 *      mounted (`start()` on mount, `stop()` on unmount).
 *   2. Real destinations: `useAppCore().sessionService.refreshSessions()`
 *      is fetched once on mount, archived sessions filtered out (an
 *      archived session is not a live place to share into — the same
 *      exclusion `sessions-model.ts`'s own "Archived" grouping already
 *      treats as a terminal state), and pushed into the runtime via
 *      `setCandidateSessionIds` *before* `start()` runs — so a launch
 *      share (`getInitialShareIntent()`, read inside `start()`) is
 *      classified against the real session list, not an empty one a
 *      still-in-flight fetch would otherwise race.
 *   3. A resolved choice navigates to the destination session via
 *      `destinationHref({ type: "session", ... })` — the exact
 *      `navigationIntentToPath` conversion `app/index.tsx` already uses
 *      for `sessionList` — never a URL/query string built out of the
 *      shared content itself (`ShareChooserScreen.tsx`'s own source-text
 *      test proves that half).
 *
 * **Disclosed gap, filed against T32S15 — now closed by that task.**
 * Nothing used to *navigate to* `/share` automatically; two call sites
 * needed it, both now wired at `app/core-context.tsx`/`app/index.tsx`:
 *   - Foreground: while some other screen is on screen, a live share
 *     intent used to have no subscriber (this route's runtime only
 *     exists while `/share` itself is mounted) — `AppCoreProvider`
 *     (`app/core-context.tsx`) now also subscribes to
 *     `AppCore.shareIntentPort`, independently of this route, and calls
 *     `router.push("/share")` on a live event.
 *   - Cold start: `app/index.tsx`'s `<Redirect>` used to decide only
 *     between `/connect` and `/h/:serverId/sessions`; it now also checks
 *     `useColdStartHasShareIntent()` (resolved from the same
 *     `AppCore.shareIntentPort.getInitialShareIntent()` this route's own
 *     `start()` reads) and redirects here first when a cold start was
 *     itself a real OS share intent.
 * `/share` is also still reachable by navigating to it directly, and —
 * once mounted — by its own `start()` reading `getInitialShareIntent()`
 * (covering the case where Expo Router itself launches cold directly
 * into this route from the OS chooser).
 *
 * The in-memory `DraftStore`/`OutboxController` pair below is this
 * route's own module-level singleton, not threaded through `AppCore` —
 * `features/composer/Composer.tsx` already discloses the identical gap
 * (no shared `AppCore`-owned draft store exists yet — T390 installed
 * `expo-sqlite`, but nothing threads a shared draft store through
 * `AppCore`); this route does not invent a second
 * pattern, it reuses the same in-memory fallback
 * `in-memory-outbox-runtime.ts` already provides. A module-level
 * singleton (constructed once, not per mount) so a draft materialized
 * through one visit to `/share` is still readable if this screen is
 * revisited later in the same process lifetime.
 */
const shareDraftDeps = {
  draftStore: new coreComposer.DraftStore(createInMemoryStructuredStorage(), createSystemClock()),
  outbox: new coreComposer.OutboxController(createInMemoryStructuredStorage(), createSystemClock()),
};

export default function ShareRoute() {
  const core = useAppCore();
  const profile = useColdStartProfile();
  const router = useRouter();

  const runtime = useMemo(
    () => createShareChooserRuntime({ port: core.shareIntentPort, draftDeps: shareDraftDeps }),
    [core.shareIntentPort],
  );
  const [destinations, setDestinations] = useState<readonly ShareChooserDestination[]>([]);
  const snapshot = useShareChooserSnapshot(runtime);

  // Fetches the real session list, then starts the runtime — in that
  // order, so a launch share is classified against real destinations
  // rather than the empty set `setCandidateSessionIds` defaults to (see
  // this route's own doc comment, point 2).
  useEffect(() => {
    let cancelled = false;
    async function boot() {
      try {
        const window = await core.sessionService.refreshSessions();
        if (cancelled) return;
        const eligible = window.sessions.filter((session) => !session.archivedAt);
        setDestinations(
          eligible.map((session) => ({
            id: session.id,
            title: session.title ?? "Untitled session",
          })),
        );
        runtime.setCandidateSessionIds(eligible.map((session) => session.id));
      } catch {
        // No connection, or the fetch failed: leave the candidate set
        // empty. A share still lands in the named, visible "no-sessions"
        // state below rather than throwing or hanging — the same
        // "real logic, real adapter, honestly unable to do anything
        // right now" shape every other `AppCore`-backed screen in this
        // app already follows.
      }
      if (cancelled) return;
      await runtime.start();
    }
    void boot();
    return () => {
      cancelled = true;
      runtime.stop();
    };
  }, [runtime, core.sessionService]);

  // A resolved choice navigates to the destination session — the exact
  // `destinationHref` conversion this app's other routes already use.
  // `profile` can briefly be `null` only if a share somehow resolves
  // before any host profile is ever saved, which `no-sessions`/an empty
  // `destinations` list already rules out in practice (there is no
  // session to resolve to without a connected profile); guarded anyway
  // rather than passing a `null` `serverId` through.
  useEffect(() => {
    if (snapshot.state.status === "resolved" && profile) {
      router.replace(
        destinationHref({
          type: "session",
          serverId: profile.id,
          agentId: snapshot.state.sessionId,
        }),
      );
    }
  }, [snapshot.state, profile, router]);

  const goBack = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace(
      profile ? destinationHref({ type: "sessionList", serverId: profile.id }) : "/connect",
    );
  };

  return (
    <ShareChooserScreen
      state={snapshot.state}
      destinations={destinations}
      onChoose={(sessionId) => void runtime.resolveChoice(sessionId)}
      onDismiss={() => runtime.dismiss()}
      onBack={goBack}
    />
  );
}
