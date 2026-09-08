/**
 * Live `DaemonClient` construction and provision — plan.md §7.1/§8.2/
 * §12.1, T53A1.
 *
 * Before this module, nothing in `apps/web` ever constructed a real
 * `@picompanion/client` `DaemonClient`: `core-context.tsx`'s
 * `CoreProvider` only builds `features/connection/fake-core-adapter.ts`'s
 * stand-in (a status badge simulator, not a socket), so every feature
 * container's `client`/`daemon` prop defaulted to `undefined` and every
 * screen ran against fixtures only.
 *
 * This module is the "frontend-core `HostController` -> `DaemonClient`"
 * half of plan.md §12.1's connection-startup diagram:
 *
 * ```text
 * platform host storage -> frontend-core HostController -> DaemonClient -> ...
 * ```
 *
 * `DaemonClientProvider` builds exactly one `hosts.HostController`
 * (T19B, already implemented) per real mount, layered on this app's real
 * `platform.structuredStorage`/`secureStorage`/`network`/`clock`
 * (`useCore()`), and on mount resolves the connection it should open, in
 * priority order matching `bootstrap-connection.ts`'s own precedent:
 *
 * 1. a daemon-injected same-origin bootstrap hint
 *    (`features/connect/bootstrap-connection.ts`'s
 *    `readBootstrapConnectDraft`), connected as an ephemeral,
 *    unpersisted profile — this app never needs to remember "the daemon
 *    that is currently serving it";
 * 2. otherwise, the most recently connected profile
 *    `hosts.HostProfileStore` already has on file (saved by
 *    `features/connect/authenticate-host.ts`/`apply-connection-offer.ts`
 *    once a manual connect or pairing attempt succeeds there).
 *
 * Neither path ever throws when unreachable: `HostController` already
 * treats "no reachable target" as a normal, reported outcome, not an
 * exception (see its own doc comment), and any storage/probe failure
 * this module encounters directly is caught and logged, never left to
 * crash the render — matching this task's "absence of a connection is a
 * normal state" acceptance criterion.
 *
 * The `HostController`/its connection are rebuilt (and the previous
 * instance disposed) inside the *same* `useEffect`, not tied to a
 * `useMemo`, specifically so React StrictMode's development-only
 * mount -> effect -> cleanup -> effect double-invoke tears down and
 * recreates a fully valid instance rather than disposing the one
 * instance a `useMemo` would have handed both invocations (`dispose()`
 * is documented as terminal — reusing a disposed `HostController` would
 * throw on the second invocation's `connectToProfile` call).
 *
 * `useDaemonClientContext()` (and its `useDaemonClient()` convenience)
 * is how routes and feature containers reach this without prop-drilling
 * through every screen; `daemon-client-context.test.tsx` (and
 * `App.test.tsx`'s existing coverage, unchanged by this module) prove
 * this renders without a
 * live daemon present.
 *
 * The value exposed as `client` is typed as `@picompanion/client`'s full
 * `DaemonClient` — not `frontend-core`'s narrower `DaemonClientLike` —
 * because that is what every existing narrow-adapter consumer this app
 * already has (`daemon-agent-turn-client.ts`, `daemon-permissions-client.ts`,
 * `daemon-session-resume-client.ts`, `daemon-sessions-client.ts`, and so
 * on) structurally requires (`.on(...)`, `.sendAgentMessage(...)`, and
 * so on — well beyond `DaemonClientLike`'s connect/close/subscribe
 * surface). This is a type-only import (erased at build time, so it
 * adds no runtime dependency); the object itself is always the real
 * `DaemonClient` `HostController`'s default `DaemonClientLifecycle`
 * factory constructs — this module never overrides that factory.
 */
import type { DaemonClient } from "@picompanion/client";
import { hosts } from "@picompanion/frontend-core";
import type { Clock } from "@picompanion/frontend-core";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useSyncExternalStore } from "react";

import { readBootstrapConnectDraft } from "../features/connect/bootstrap-connection.js";
import type { ConnectDraft } from "../features/connect/validate-connect-form.js";
import { useCore } from "./core-context.js";

/**
 * This app's fixed daemon hello `clientId` (matches
 * `ConnectFormContainer.tsx`'s `WEB_CONNECT_CLIENT_ID` value; kept as a
 * separate constant here since that one is not exported — see this
 * task's "stay inside the files your task owns").
 *
 * Exported (T41B1) so the diagnostics screen can show the real
 * identifier this app declares on every `hello`, rather than a
 * plausible-looking placeholder — `diagnostics-model.ts`'s own doc
 * comment names this as its "client id" field's source.
 */
export const WEB_DAEMON_CLIENT_ID = "picompanion-web";

/**
 * Declared to the ported daemon (`packages/server/src/server/session.ts`)
 * as this connection's `appVersion` on every `hello` handshake this
 * provider opens (T31B1/T31B3 -- both tasks diagnosed this same gap
 * independently against the isolated E2E daemon).
 *
 * CORRECTED (T262): this used to say `session.ts`'s
 * `isProviderVisibleToClient` hid every agent whose provider was not one
 * of Paseo's legacy `claude`/`codex`/`opencode` ids (`LEGACY_PROVIDER_IDS`)
 * unless the connecting client stated an `appVersion` of at least
 * `MIN_VERSION_ALL_PROVIDERS` (`"0.1.45"`). T262 retired that gate
 * entirely -- `isProviderVisibleToClient` is now an unconditional `true`
 * regardless of `appVersion` (see `plan.md` §18 item 13) -- because this
 * product's own provider registry has always been pi-only and its own
 * wire schema (`AgentProviderSchema` in
 * `packages/protocol/src/provider-manifest.ts`) was never the restrictive
 * `z.enum` Paseo's real app-store clients carried, the thing the gate
 * existed to protect against. `session.ts` still separately gates explicit
 * workspace recovery behind `MIN_VERSION_EXPLICIT_WORKSPACE_RECOVERY`
 * (`"0.1.105"`, `clientUsesLegacyWorkspaceRestore`) -- unaffected by T262
 * and still real -- which treats a connection with **no** `appVersion` at
 * all as legacy: `isAppVersionAtLeast` returns `false` for a `null`
 * version. Declaring an `appVersion` below is no longer load-bearing for
 * provider visibility, only for that workspace-recovery gate.
 *
 * This product's only provider, `"pi"`, is exactly such a non-legacy
 * provider. Before this constant existed, nothing in `apps/web` ever set
 * `HostControllerConfig.appVersion`
 * (`packages/frontend-core/src/hosts/host-controller.ts`), so every
 * `fetch_agent_request`/`fetch_agent_list`-family lookup for a real,
 * just-created `pi` agent came back `null`/omitted (`{ agent: null, error:
 * "Agent not found: <id>" }`) even though `agentStorage`/`agentManager`
 * both had it -- proven end to end by `apps/web/e2e/deep-link-restore.spec.ts`
 * and `session-steer-and-follow-up.spec.ts`: even the *same* connection
 * that had just created an agent could not immediately fetch it back.
 *
 * This is not this package's own npm `version` (`"0.1.0"`, which resets
 * per this fresh product and stays far below `0.1.45`) -- it is a fixed
 * protocol-compatibility declaration that this client understands every
 * current provider id and the explicit-workspace-recovery handshake.
 * `"0.3.0-beta.2"` matches the ported backend packages this app already
 * depends on (`@picompanion/client`/`protocol`/`server`), comfortably past
 * both floors, rather than inventing a version disconnected from anything
 * real in this repository.
 *
 * Exported (T41B1) as the diagnostics screen's real "app protocol
 * version" source — see `diagnostics-model.ts`.
 */
export const DAEMON_APP_VERSION = "0.3.0-beta.2";

/** Id an ephemeral, unpersisted bootstrap-hint profile is connected under. Never written through `HostProfileStore`. */
const BOOTSTRAP_PROFILE_ID = "bootstrap-connection";

const IDLE_CONNECTION_INFO: hosts.HostControllerConnectionInfo = {
  status: "idle",
  profileId: null,
  kind: null,
};

export interface DaemonClientSnapshot {
  /**
   * The live `DaemonClient` for the current connection generation, or
   * `null` before any connection attempt, while none is reachable, or
   * between reconnect attempts — never a thrown error.
   */
  client: DaemonClient | null;
  info: hosts.HostControllerConnectionInfo;
}

export interface DaemonClientContextValue extends DaemonClientSnapshot {
  /**
   * The one `HostController` this provider owns, for callers that need
   * more than a read (e.g. a future manual disconnect/host-switch
   * affordance). Most containers only need `client`/`info`.
   */
  hostController: hosts.HostController | null;
}

const DEFAULT_CONTEXT_VALUE: DaemonClientContextValue = {
  client: null,
  info: IDLE_CONNECTION_INFO,
  hostController: null,
};

const DaemonClientContext = createContext<DaemonClientContextValue>(DEFAULT_CONTEXT_VALUE);

/** `HostController.getDaemonClient()`'s `DaemonClientLike | null` is always, in practice, a real `DaemonClient` here (see module doc comment). */
function asDaemonClient(
  client: ReturnType<hosts.HostController["getDaemonClient"]>,
): DaemonClient | null {
  return client as DaemonClient | null;
}

function ephemeralProfileFromDraft(draft: ConnectDraft, clock: Clock): hosts.HostProfile {
  const now = clock.now();
  return {
    id: BOOTSTRAP_PROFILE_ID,
    label: draft.label,
    direct: draft.direct,
    preferDirect: draft.preferDirect,
    createdAt: now,
    updatedAt: now,
    lastConnectedAt: null,
    lastConnectionKind: null,
  };
}

function mostRecentlyConnected(profiles: hosts.HostProfile[]): hosts.HostProfile | null {
  let best: hosts.HostProfile | null = null;
  let bestAt = -Infinity;
  for (const profile of profiles) {
    const at = profile.lastConnectedAt ?? profile.updatedAt;
    if (at > bestAt) {
      best = profile;
      bestAt = at;
    }
  }
  return best;
}

/**
 * Resolves and opens this app's one initial connection (bootstrap hint,
 * else the most recently connected saved profile), per this module's
 * doc comment. Never throws past its own `finally`: any failure is
 * `HostController`'s own reported outcome, not an exception, except for
 * storage/probe errors this function catches directly. If `isCancelled`
 * turns true while a connection attempt is in flight (a
 * `StrictMode`/real unmount raced it), disconnects whatever it just
 * opened rather than leaving an untracked live socket behind.
 */
async function runInitialConnect(
  controller: hosts.HostController,
  clock: Clock,
  isCancelled: () => boolean,
): Promise<void> {
  try {
    const bootstrapDraft = readBootstrapConnectDraft();
    if (bootstrapDraft) {
      await controller.connectToProfile(ephemeralProfileFromDraft(bootstrapDraft, clock));
      return;
    }
    const profiles = await controller.profiles.list();
    const profile = mostRecentlyConnected(profiles);
    if (profile) {
      await controller.connectToProfile(profile);
    }
  } finally {
    if (isCancelled()) {
      controller.disconnect().catch(() => {});
    }
  }
}

/**
 * Reads a live `{ client, info }` snapshot off `controller` through
 * `useSyncExternalStore`, matching `use-connection-state.ts`'s existing
 * idiom. `getSnapshot` must return a referentially stable value between
 * real changes (`useSyncExternalStore` calls it on every render to
 * check for tearing, and treats a fresh object each time as a change,
 * which — before this guard — free-spun into "Maximum update depth
 * exceeded"): the cached `snapshotRef` is only ever replaced either by
 * `subscribeConnectionInfo`'s callback, or here, exactly once per
 * `controller` identity change, never unconditionally.
 *
 * `subscribe` itself is memoized to `controller`'s identity
 * (`useCallback`), not recreated inline on every render: `HostController.
 * subscribeConnectionInfo` calls its listener synchronously the moment a
 * subscriber attaches, so an unmemoized `subscribe` — which
 * `useSyncExternalStore` re-invokes whenever its reference changes
 * between renders — would resubscribe (and therefore re-notify) on
 * every single render, which is a second, independent way to free-spin
 * into "Maximum update depth exceeded".
 */
function useDaemonClientSnapshot(controller: hosts.HostController | null): DaemonClientSnapshot {
  const snapshotRef = useRef<DaemonClientSnapshot>({ client: null, info: IDLE_CONNECTION_INFO });
  const controllerRef = useRef<hosts.HostController | null>(null);

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (!controller) return () => {};
      return controller.subscribeConnectionInfo((info) => {
        snapshotRef.current = { client: asDaemonClient(controller.getDaemonClient()), info };
        onStoreChange();
      });
    },
    [controller],
  );

  const getSnapshot = useCallback(() => {
    if (controllerRef.current !== controller) {
      controllerRef.current = controller;
      snapshotRef.current = controller
        ? {
            client: asDaemonClient(controller.getDaemonClient()),
            info: controller.getConnectionInfo(),
          }
        : { client: null, info: IDLE_CONNECTION_INFO };
    }
    return snapshotRef.current;
  }, [controller]);

  return useSyncExternalStore(subscribe, getSnapshot);
}

/**
 * Provides this app's one live `DaemonClient` (once it has one) to the
 * whole routed tree. Must be mounted inside `CoreProvider` (reads
 * `useCore()` for its platform adapters). Renders `children` immediately
 * and unconditionally: connecting is entirely a background concern, so
 * no route ever waits on it to render.
 */
export function DaemonClientProvider({ children }: { children: React.ReactNode }) {
  const { platform } = useCore();
  const [hostController, setHostController] = useState<hosts.HostController | null>(null);

  useEffect(() => {
    let cancelled = false;
    let controller: hosts.HostController | null = null;

    // T58: `browser-probe-transport.js` (a throwaway-`WebSocket` probe
    // transport, its own doc comment) is dynamically imported here
    // rather than statically at the top of this module — it is only
    // ever invoked once a connection is actually being probed, well
    // after first paint.
    //
    // `hosts` (`@picompanion/frontend-core`) deliberately stays a
    // static, named import (`import { hosts } from
    // "@picompanion/frontend-core"` above) rather than joining it here.
    // `@picompanion/frontend-core`'s one package entry re-exports every
    // domain as its own namespace (`export * as hosts ...`, `export *
    // as extensions ...`, `export * as testing ...`, and so on —
    // `packages/frontend-core/src/index.ts`); a *named* static import
    // lets Rolldown tree-shake every sibling namespace this file never
    // touches (`composer`, `files`, `navigation`, `offline`, `sessions`,
    // `terminal`, `testing`'s dev-lab fixtures, …) out of its chunk, but
    // a *dynamic* `import("@picompanion/frontend-core")` of the same bare
    // specifier resolves the whole namespace object at runtime with no
    // static named binding to shake against — measured empirically:
    // doing so here pulled in the entire package (105 source files,
    // dev-only lab fixtures included) rather than just `hosts`, growing
    // this chunk instead of shrinking it. `hosts.HostController` itself
    // still statically needs `connection/daemon-client-lifecycle.js` ->
    // `@picompanion/client`'s `DaemonClient` -> every `@picompanion/
    // protocol` message schema and its generated AJV validator to
    // function at all (this app's core "stay connected to a daemon"
    // feature, not something this task may defer or remove) — that
    // remaining weight is real, unavoidable via any import-boundary
    // change available to this task's owned files, and is accounted for
    // in this task's reported before/after figures rather than hidden.
    //
    // `DaemonClientProvider` sits inside `App`, outside every route's
    // own `lazyRouteComponent` boundary, so the static
    // `browser-probe-transport.js` import previously put its whole
    // chunk on every route's entry `modulepreload` graph. This
    // `useEffect` already only fires post-mount and the component
    // "[r]enders children immediately and unconditionally" per this
    // function's own doc comment above, so awaiting one more dynamic
    // `import()` here changes no visible behaviour — connecting was
    // already an async background concern no render ever waited on,
    // and `daemon-client-context.test.tsx` already only asserts a
    // controller eventually appears via `waitFor`, not synchronously.
    // If `cancelled` flips true (this effect's own cleanup, including
    // React StrictMode's dev-only double-invoke) before the import
    // settles, the controller is never constructed at all, matching the
    // pre-existing "dispose whatever this effect started" contract
    // without ever needing to dispose something never created.
    void (async () => {
      const { createBrowserHostProbeTransport } =
        await import("../features/connect/browser-probe-transport.js");
      if (cancelled) return;

      controller = new hosts.HostController({
        clientId: WEB_DAEMON_CLIENT_ID,
        clientType: "browser",
        appVersion: DAEMON_APP_VERSION,
        storage: platform.structuredStorage,
        secrets: platform.secureStorage,
        network: platform.network,
        clock: platform.clock,
        probe: createBrowserHostProbeTransport(),
        logger: platform.logger,
      });
      setHostController(controller);

      try {
        await runInitialConnect(controller, platform.clock, () => cancelled);
      } catch (error: unknown) {
        platform.logger.warn("initial daemon connection attempt failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    })();

    return () => {
      cancelled = true;
      controller?.dispose().catch(() => {});
    };
  }, [platform]);

  const snapshot = useDaemonClientSnapshot(hostController);

  const value = useMemo<DaemonClientContextValue>(
    () => ({ ...snapshot, hostController }),
    [snapshot, hostController],
  );

  return <DaemonClientContext.Provider value={value}>{children}</DaemonClientContext.Provider>;
}

/**
 * The full `{ client, info, hostController }` value. Never throws: used
 * outside a `DaemonClientProvider` it returns `DEFAULT_CONTEXT_VALUE`
 * (`client: null`, idle `info`, `hostController: null`) — the same
 * "no live client yet" shape every existing feature container already
 * treats as a normal default, so a screen rendered in isolation (tests,
 * Storybook-style harnesses) never needs its own provider just to avoid
 * a throw.
 */
export function useDaemonClientContext(): DaemonClientContextValue {
  return useContext(DaemonClientContext);
}

/**
 * Convenience for containers that only need the client itself. `null`
 * whenever there is no live connection yet — a normal state every
 * consumer must already handle, matching every existing feature
 * container's optional `client?:` prop (`ComposerContainer`,
 * `ApprovalsContainer`, and so on).
 */
export function useDaemonClient(): DaemonClient | null {
  return useDaemonClientContext().client;
}
