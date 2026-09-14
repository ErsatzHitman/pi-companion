import { useDaemonClientContext } from "../../app/daemon-client-context.js";
import type { DaemonConnectionState } from "./real-core-adapter.js";
import { toDaemonConnectionState } from "./real-core-adapter.js";

const STATE_LABEL: Record<DaemonConnectionState, string> = {
  connected: "Connected",
  connecting: "Connecting…",
  disconnected: "Disconnected",
};

/**
 * Connected/disconnected badge (plan.md §8.3 header).
 *
 * FIX-L3: this used to read `useConnectionState()`
 * (`use-connection-state.ts`), a *second*, effect-republished copy of
 * the connection state: `daemon-client-context.tsx`'s
 * `DaemonClientProvider` only forwarded its own live
 * `HostControllerConnectionInfo` into `real-core-adapter.ts`'s
 * `RealCoreAdapter` from inside a `useEffect`, one render after the
 * context value itself already updated. Every other consumer of the
 * connection (`root-route.tsx`'s `SessionRailContent`, this route's
 * `host-screen.tsx`, and so on) reads `useDaemonClientContext()`
 * directly and so always renders the current status; the badge, sitting
 * one extra hop behind a republish that is not guaranteed to have run
 * yet whenever *this* component happens to render, could and did lag —
 * reproduced in `connection-status.test.tsx` as the header staying on
 * "Connecting…" after the underlying connection already reported
 * "connected" to every direct reader. Reading
 * `useDaemonClientContext()` here too removes the second hop instead of
 * trying to make it keep up: the header and the session rail's own
 * connection foot (`features/sessions/SessionRail.tsx`) now render from
 * the exact same live snapshot.
 */
export function ConnectionStatus() {
  const { info, hostController } = useDaemonClientContext();
  const state = toDaemonConnectionState(info.status);
  const label = hostController?.getCurrentProfile()?.label ?? null;

  return (
    <div className="connection-status" data-state={state}>
      <span className="connection-status__dot" aria-hidden="true" />
      <span className="connection-status__label">{STATE_LABEL[state]}</span>
      {label ? <span className="connection-status__target">{label}</span> : null}
    </div>
  );
}
