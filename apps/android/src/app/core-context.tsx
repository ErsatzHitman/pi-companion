import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname, useRouter } from "expo-router";

import { listHostProfiles, type HostProfileRecord } from "../features/connect/credential-store.js";
import { reconnectColdStartProfile } from "../app-shell/cold-start-reconnect";
import { createAppCore, type AppCore } from "../app-shell/core";
import type { ResumeSignalTarget } from "../app-shell/resume-signals";

const AppCoreContext = createContext<AppCore | null>(null);

/**
 * `null` while no stored profile exists (or the read is still resolving
 * — see `AppCoreProvider`'s gate below, which never lets a consumer of
 * this context observe that in-between state); the first stored host
 * profile otherwise. `h/index.tsx`'s cold-start redirect (T32S3, item 3)
 * is this context's one consumer.
 */
const ColdStartProfileContext = createContext<HostProfileRecord | null>(null);

/**
 * `true` when `AppCore.shareIntentPort.getInitialShareIntent()` resolved
 * to a real intent during the same cold-start gate `ColdStartProfileContext`
 * above resolves through — `false` for an ordinary cold start, and always
 * already-settled by the time a consumer can read it (same "no in-between
 * state observable" guarantee `ColdStartProfileContext`'s own doc comment
 * makes). `index.tsx`'s cold-start redirect is this context's one
 * consumer (T32S15 — see that route's own doc comment).
 */
const ColdStartHasShareContext = createContext<boolean>(false);

/**
 * Provides the app's `frontend-core`-backed adapter bundle (see
 * `core.ts`) to the Expo Router tree, so screens read process-wide
 * adapters from one place rather than constructing their own.
 *
 * Connection state IS one of them, as of P5-W9: T32A1B moved
 * `features/connect/use-connection-status.ts` off `AppCore["network"]`
 * and onto its own `DaemonConnectionStore`, which reports a live
 * `connection.DaemonClientLifecycle`'s real status; `AppCore.connection`
 * (T32S3) is the app-wide instance of that same kind of store; and
 * T32A4 then changed `ConnectionShell` to read *that* instance through
 * `useAppCore()` rather than construct a private one. (This paragraph
 * used to point at `core.ts` for "the one disclosed gap left before
 * `ConnectionShell`'s own store and this one are the same live
 * connection" — that gap is closed; there is now only one store.)
 * What this provider supplies is `core.ts`'s `lifecycle`,
 * `network` (a real, probe-based `PollingNetworkReachability` as of
 * T32S3, not `FakeNetworkReachability`), `connection`, and
 * `keyValueStorage` adapters, plus `attachResumeSignals`/
 * `useResumeSignals` below.
 */
/**
 * Cold-start gate (T32S3, item 3): `h/index.tsx`'s `<Redirect>` used to
 * unconditionally send every cold start to `/connect`, even with a
 * stored host profile already on the device, because `SecureStorage`/
 * `KeyValueStorage` are both async and `<Redirect>` has to resolve
 * *synchronously*, before any such read could finish — see that route's
 * old doc comment (T32S1C/T32S2) for the fuller account this task closes.
 *
 * The fix is not to make the read synchronous (it cannot be); it is to
 * never let the router render `/connect` — or any other route — before
 * the read settles. `AppCoreProvider` blocks its own `children` on
 * exactly one `listHostProfiles()` call, resolved or not, and renders
 * `null` until it settles — matching `_layout.tsx`'s own
 * `!fontsLoaded && !fontError` gate one level up, the same "nothing
 * rather than the wrong screen" shape already established there. Once
 * settled, `h/index.tsx` reads the result via `useColdStartProfile()`
 * and redirects to that profile's session list instead of `/connect`
 * when one exists — never a second, later redirect once `/connect` (or
 * anything else) already flashed on screen.
 *
 * A read failure (corrupt storage, `SecureStorage.isAvailable()` false)
 * resolves to "no profile" rather than hanging the gate forever — a
 * bare `/connect` cold start is exactly what happens today when there
 * never was a stored profile, so this is a safe fallback, not a new
 * failure mode.
 */
export function AppCoreProvider({ children }: { children: ReactNode }) {
  const core = useMemo(() => createAppCore(), []);
  const [coldStart, setColdStart] = useState<{
    resolved: boolean;
    profile: HostProfileRecord | null;
    hasInitialShare: boolean;
  }>({ resolved: false, profile: null, hasInitialShare: false });

  // T74: `AppCore.shutdown()` is the process-lifetime teardown hook
  // `core.ts`'s own doc comment used to disclose as missing — this
  // provider is the one place that owns `core`'s lifetime (it is the
  // `useMemo` above's only construction site), so it is the one place
  // that calls it, on the same "process-lifetime bootstrap location"
  // this file's own `useResumeSignals`/`startPushRegistration` doc
  // comments already establish for every other `AppCore`-owned listener.
  // A real app process never actually unmounts this provider (it wraps
  // the router root), so in production this fires only on the rare
  // remount `APP_CORE_OFFLINE_SCOPE`'s own doc comment already names (a
  // dev-time Fast Refresh remount); `core.test.ts` proves `shutdown()`
  // itself, invoked directly, the same way it already proves
  // `offlineCache.dispose()`.
  useEffect(() => {
    return () => {
      void core.shutdown();
    };
  }, [core]);

  // T32S15: resolved alongside the stored-profile read below, not as a
  // second gate — one settle point, matching this effect's own established
  // "nothing rather than the wrong screen" shape. `getInitialShareIntent()`
  // mirrors `Linking.getInitialURL()`'s "safe to call more than once, same
  // answer every time" contract (see `share-intent-port.ts`'s own doc
  // comment), so peeking it here to decide `index.tsx`'s redirect target
  // does not consume anything `../app/share.tsx`'s own `runtime.start()`
  // still needs to read for real. Wrapped in its own `.catch(() => null)`
  // so a share-read failure alone can never make `Promise.all` reject and
  // fall through to the "no profile" branch below — a profile read that
  // succeeds must still resolve to that profile even if the share peek
  // does not.
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      listHostProfiles({ secureStorage: core.secureStorage, plainStorage: core.keyValueStorage }),
      core.shareIntentPort.getInitialShareIntent().catch(() => null),
    ])
      .then(([profiles, initialShare]) => {
        if (!cancelled) {
          setColdStart({
            resolved: true,
            profile: profiles[0] ?? null,
            hasInitialShare: initialShare !== null,
          });
        }
      })
      .catch(() => {
        if (!cancelled) setColdStart({ resolved: true, profile: null, hasInitialShare: false });
      });
    return () => {
      cancelled = true;
    };
  }, [core]);

  // T337: the automatic half of the seam `host-profile-reconnect.ts`'s
  // header filed at T66 (T32S14 closed the user-driven half, the connect
  // form's "existing profile" submit). Once the read above has settled
  // on a stored profile, reconnect it -- through `AppCore.
  // reconnectHostProfile` and `connection.adoptLifecycle`, the same two
  // calls `connection-shell.tsx`'s `handleReconnect` makes -- so the
  // session list `h/index.tsx` redirects to, and the last-opened session
  // `sessions-screen.tsx` restores, have a live connection to read
  // through. Fired, never awaited: the router is NOT gated on it (a dead
  // host must not turn a cold start into a blank screen for a whole
  // connect timeout), and `reconnectColdStartProfile` itself steps aside
  // if a user-driven attempt starts first. Maestro run 34470287372's
  // `cold-start-restore` is the measurement: relaunch, idle store, empty
  // list, "Not connected to a daemon" banner. See
  // `../app-shell/cold-start-reconnect.ts`.
  useEffect(() => {
    const profile = coldStart.profile;
    if (!coldStart.resolved || !profile) return;
    void reconnectColdStartProfile(core, profile);
  }, [core, coldStart.resolved, coldStart.profile]);

  // T32S15: closes the other half of the gap `../app/share.tsx`'s own doc
  // comment named against this task by name — "nothing yet *navigates to*
  // `/share` automatically" when a live share intent arrives while some
  // other screen is on screen. `AppCore.shareIntentPort.subscribe()`
  // supports more than one concurrent listener (each call registers its
  // own native/event-emitter subscription — see `share-intent-native-port.ts`'s
  // `addListener`), so this listener coexists with `/share`'s own runtime
  // subscription rather than replacing it: this one never classifies or
  // presents anything, it only decides whether to navigate there.
  // `pathnameRef` (updated every render, read only from inside the
  // long-lived subscription) is what keeps this effect from re-subscribing
  // on every navigation — a share that arrives while `/share` is already
  // open is left to that route's own mounted runtime, which is already
  // presenting it, rather than pushing a duplicate screen on top of itself.
  const router = useRouter();
  const pathname = usePathname();
  const pathnameRef = useRef(pathname);
  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);

  useEffect(() => {
    return core.shareIntentPort.subscribe(() => {
      if (pathnameRef.current !== "/share") {
        router.push("/share");
      }
    });
  }, [core, router]);

  // T32S13 (P5-W19): `AppCore["startPushRegistration"]`'s first live
  // caller — `features/notifications/index.ts`'s own doc comment named
  // this exact seam ("Seam filed against T32S11") since T36A/T61B, never
  // picked up before this task. Runs once per provider mount (this is
  // the process-lifetime bootstrap location `useResumeSignals` below
  // also documents as the one place such listeners belong), and tears
  // down the token-refresh subscription on unmount. See
  // `AppCore["startPushRegistration"]`'s own doc comment for why this
  // is real wiring that today never reaches a live token (T60C's
  // `expo-notifications` install still blocks that, not this call).
  useEffect(() => {
    let unsubscribe: (() => void) | null = null;
    let cancelled = false;
    void core.startPushRegistration().then((unsub) => {
      if (cancelled) {
        unsub();
        return;
      }
      unsubscribe = unsub;
    });
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [core]);

  if (!coldStart.resolved) {
    return null;
  }

  return (
    <AppCoreContext.Provider value={core}>
      <ColdStartProfileContext.Provider value={coldStart.profile}>
        <ColdStartHasShareContext.Provider value={coldStart.hasInitialShare}>
          {children}
        </ColdStartHasShareContext.Provider>
      </ColdStartProfileContext.Provider>
    </AppCoreContext.Provider>
  );
}

export function useAppCore(): AppCore {
  const core = useContext(AppCoreContext);
  if (!core) {
    throw new Error("useAppCore() called outside of <AppCoreProvider>");
  }
  return core;
}

/**
 * The first stored host profile, or `null` when there is none. Always
 * already-resolved by the time any consumer can call this: `children`
 * (and therefore every route, including `h/index.tsx`) does not mount
 * until `AppCoreProvider`'s gate above has settled, so there is no
 * separate "loading" case for this hook to report.
 */
export function useColdStartProfile(): HostProfileRecord | null {
  return useContext(ColdStartProfileContext);
}

/**
 * `true` when this cold start was itself a real OS share arriving — see
 * `ColdStartHasShareContext`'s own doc comment. Like
 * `useColdStartProfile()`, always already-resolved by the time any
 * consumer can call this.
 */
export function useColdStartHasShareIntent(): boolean {
  return useContext(ColdStartHasShareContext);
}

/**
 * Feeds this app's foreground and connectivity changes into a T46A2
 * `connection.ResumeController` for as long as the calling component is
 * mounted (T32S1B, plan.md §7.4 "Liveness").
 *
 * Wired through the existing `AppCoreProvider` deliberately: the
 * `AppState` subscription and the churn rate limiter belong to the
 * process, not to a screen, so `AppCore.attachResumeSignals` is the one
 * place they are created and every consumer shares them. Pass `null`
 * while no controller exists yet (a session screen still resuming, say)
 * and nothing is subscribed.
 */
export function useResumeSignals(target: ResumeSignalTarget | null): void {
  const core = useAppCore();
  useEffect(() => {
    if (!target) return;
    return core.attachResumeSignals(target);
  }, [core, target]);
}
