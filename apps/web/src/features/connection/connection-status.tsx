import { useConnectionState } from "./use-connection-state.js";

const STATE_LABEL: Record<string, string> = {
  connected: "Connected",
  connecting: "Connecting…",
  disconnected: "Disconnected",
};

/** Connected/disconnected badge, driven entirely by `useConnectionState`. */
export function ConnectionStatus() {
  const snapshot = useConnectionState();

  return (
    <div className="connection-status" data-state={snapshot.state}>
      <span className="connection-status__dot" aria-hidden="true" />
      <span className="connection-status__label">
        {STATE_LABEL[snapshot.state] ?? snapshot.state}
      </span>
      {snapshot.label ? <span className="connection-status__target">{snapshot.label}</span> : null}
    </div>
  );
}
