import { terminal } from "@picompanion/frontend-core";
import type { ITerminalAddon, Terminal as XtermTerminal } from "@xterm/xterm";
import { useEffect, useRef, useState } from "react";

import { Banner, Card, ErrorState, StatusIndicator } from "../../ui/primitives/index.js";
import type { StatusTone } from "../../ui/primitives/index.js";
import { TerminalResizeOwnership } from "./terminal-resize-ownership.js";
import {
  prefersReducedMotion,
  readTerminalFontFamily,
  readTerminalFontSizePx,
  readTerminalTheme,
} from "./terminal-theme.js";
import "./terminal-view.css";

const STATUS_TONE: Record<terminal.TerminalControllerStatus, StatusTone> = {
  idle: "neutral",
  subscribing: "info",
  subscribed: "success",
  error: "danger",
  unsubscribed: "neutral",
  disposed: "neutral",
};

const STATUS_TEXT: Record<terminal.TerminalControllerStatus, string> = {
  idle: "Idle",
  subscribing: "Connecting…",
  subscribed: "Connected",
  error: "Connection failed",
  unsubscribed: "Disconnected",
  disposed: "Closed",
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

/**
 * The transport-level status a real `@picompanion/client` `DaemonClient`
 * exposes via `subscribeConnectionStatus` — deliberately only the one
 * field this module reads (`status`), so any object shaped like
 * `DaemonClient`'s own `ConnectionState` (`"idle" | "connecting" |
 * "connected" | "disconnected" | "disposed"`) satisfies it structurally,
 * fixtures included.
 */
export interface TerminalTransportStatus {
  readonly status: string;
}

/**
 * Optional companion to `TerminalRpcClient`: when a `client` also exposes
 * this, `TerminalView` uses it to notice a dropped-and-restored transport
 * and resubscribe (T30A3 — "disconnect and reconnect restore a usable
 * terminal"). `TerminalRpcClient` itself stays narrow and transport-silent
 * on purpose (see its own doc), so this is an additive, structural,
 * always-optional extra a real `DaemonClient` already satisfies as-is;
 * nothing breaks for a `client` that only implements `TerminalRpcClient`.
 */
export interface TerminalTransportStatusSource {
  subscribeConnectionStatus(listener: (state: TerminalTransportStatus) => void): () => void;
}

export interface TerminalViewProps {
  /**
   * Satisfies `TerminalRpcClient` — a real `@picompanion/client`
   * `DaemonClient` works as-is, and also happens to satisfy
   * `TerminalTransportStatusSource` (see its doc) so reconnects are
   * handled automatically once a route supplies a live client.
   */
  client: terminal.TerminalRpcClient & Partial<TerminalTransportStatusSource>;
  terminalId: string;
  /** Defaults to a bounded `visible-snapshot` restore sized to the mounted viewport. */
  restore?: terminal.TerminalRestoreOptions;
  testId?: string;
}

/**
 * Mounts xterm.js on a `TerminalController` (plan.md §8.4, T30A1/T30A2).
 *
 * xterm itself is dynamically imported so it (and `@xterm/addon-fit`)
 * never land in the initial bundle — only when this component actually
 * mounts, which only happens once the lazily-loaded terminal route
 * (`routes/host-session-terminal.tsx`, T27S2) itself resolves.
 *
 * Resize *ownership* (T30A3, `terminal-resize-ownership.ts`): the first
 * resize sent per subscribe/resubscribe is a `"claim"`, every one after
 * that is an `"update"`, and a detected transport disconnect resets back
 * to `"claim"` for the next resize once reconnected — see that module's
 * doc for the full policy and why. Reconnect resilience: when `client`
 * also satisfies `TerminalTransportStatusSource`, a transport drop shows
 * a distinct "connection lost" status and, once the transport reports
 * `"connected"` again, resubscribes immediately (refitting to the current
 * viewport first) so a stale connection never leaves a dead terminal
 * behind.
 */
export function TerminalView({ client, terminalId, restore, testId }: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<terminal.TerminalControllerStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [congested, setCongested] = useState(false);
  const [bufferedBytes, setBufferedBytes] = useState(0);
  const [overflowMessage, setOverflowMessage] = useState<string | null>(null);
  const [transportLost, setTransportLost] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let term: XtermTerminal | null = null;
    let fit: (ITerminalAddon & { fit(): void }) | null = null;
    let controller: terminal.TerminalController | null = null;
    let handleWindowResize: (() => void) | null = null;
    const ownership = new TerminalResizeOwnership();
    const cleanups: Array<() => void> = [];

    setStatus("idle");
    setErrorMessage(null);
    setCongested(false);
    setBufferedBytes(0);
    setOverflowMessage(null);
    setTransportLost(false);

    async function mount(): Promise<void> {
      try {
        await mountXterm();
      } catch (cause) {
        if (!cancelled) {
          setErrorMessage(cause instanceof Error ? cause.message : String(cause));
        }
      }
    }

    async function mountXterm(): Promise<void> {
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
      ]);
      if (cancelled || !containerRef.current) return;

      const localTerm = new Terminal({
        allowProposedApi: false,
        cursorBlink: !prefersReducedMotion(),
        fontFamily: readTerminalFontFamily(),
        fontSize: readTerminalFontSizePx(),
        scrollback: 5000,
        screenReaderMode: true,
        theme: readTerminalTheme(),
      });
      term = localTerm;
      const fitAddon = new FitAddon();
      localTerm.loadAddon(fitAddon);
      localTerm.open(containerRef.current);
      fitAddon.fit();
      fit = fitAddon;

      const localController = new terminal.TerminalController({
        client,
        terminalId,
        restore: restore ?? {
          mode: "visible-snapshot",
          size: { rows: localTerm.rows, cols: localTerm.cols },
        },
        sink: {
          write: (data) => new Promise<void>((resolve) => localTerm.write(data, resolve)),
          reset: (data) =>
            new Promise<void>((resolve) => {
              localTerm.reset();
              localTerm.write(data, resolve);
            }),
        },
      });
      controller = localController;
      if (cancelled) {
        localController.dispose();
        controller = null;
        return;
      }

      cleanups.push(localController.onStatus((next) => !cancelled && setStatus(next)));
      cleanups.push(
        localController.onEvent((event) => {
          if (cancelled) return;
          if (event.type === "congestion") {
            setCongested(event.congested);
            setBufferedBytes(event.bufferedBytes);
          } else if (event.type === "overflow") {
            setOverflowMessage(
              `Terminal output fell behind and was resynced (${formatBytes(event.droppedBytes)} dropped).`,
            );
          } else if (event.type === "resync-failed") {
            setOverflowMessage(`Automatic resync failed: ${event.error}`);
          }
        }),
      );

      const dataDisposable = localTerm.onData((data) => localController.write(data));
      const resizeDisposable = localTerm.onResize(({ cols, rows }) =>
        localController.resize(rows, cols, ownership.nextIntent()),
      );
      cleanups.push(() => dataDisposable.dispose());
      cleanups.push(() => resizeDisposable.dispose());

      handleWindowResize = () => fit?.fit();
      window.addEventListener("resize", handleWindowResize);

      const outcome = await localController.subscribe();
      if (cancelled) return;
      if (outcome.error) {
        setErrorMessage(outcome.error);
      } else {
        ownership.markSubscribed();
      }

      // Reconnect resilience (T30A3): only wired when `client` also
      // exposes transport status (a real `DaemonClient` does; most tests'
      // narrow fakes don't, and that's fine — see `TerminalTransportStatusSource`'s
      // doc). Attached *after* the initial subscribe settles so a fresh
      // mount's own "idle"/"connecting"/"connected" startup sequence is never
      // mistaken for a reconnect and double-subscribes.
      if (typeof client.subscribeConnectionStatus === "function") {
        let lastTransportStatus: string | null = null;
        const unsubscribeTransport = client.subscribeConnectionStatus((state) => {
          if (cancelled) return;
          const previous = lastTransportStatus;
          lastTransportStatus = state.status;

          if (state.status !== "connected") {
            if (previous === "connected" || previous === null) {
              ownership.markDisconnected();
              setTransportLost(true);
            }
            return;
          }

          if (previous !== null && previous !== "connected") {
            setTransportLost(false);
            void resubscribeAfterReconnect();
          }
        });
        cleanups.push(unsubscribeTransport);
      }

      async function resubscribeAfterReconnect(): Promise<void> {
        if (cancelled || !term) return;
        fit?.fit();
        const nextRestore =
          restore ??
          ({ mode: "visible-snapshot", size: { rows: term.rows, cols: term.cols } } as const);
        const resubscribeOutcome = await localController.subscribe({ restore: nextRestore });
        if (cancelled) return;
        if (resubscribeOutcome.error) {
          setErrorMessage(resubscribeOutcome.error);
        } else {
          setErrorMessage(null);
          ownership.markSubscribed();
        }
      }
    }

    void mount();

    return () => {
      cancelled = true;
      if (handleWindowResize) {
        window.removeEventListener("resize", handleWindowResize);
      }
      for (const cleanup of cleanups) {
        cleanup();
      }
      controller?.dispose();
      term?.dispose();
    };
    // `restore` is a one-time mount option, deliberately not a live prop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, terminalId]);

  // A transport drop takes priority over whatever the controller last
  // reported (plan.md §12.4/§14.5, T30A3): otherwise this would keep
  // showing a stale "Connected" while the underlying socket is down, in
  // the gap between the drop and the resubscribe it immediately triggers.
  const tone: StatusTone = transportLost ? "warning" : STATUS_TONE[status];
  const statusText = transportLost
    ? "Connection lost — reconnecting\u2026"
    : status === "error" && errorMessage
      ? errorMessage
      : STATUS_TEXT[status];

  return (
    <Card className="pc-terminal">
      <div className="pc-terminal__header">
        <StatusIndicator
          label="Terminal"
          tone={tone}
          statusText={statusText}
          testId={testId ? `${testId}-status` : undefined}
        />
        {congested ? (
          <StatusIndicator
            label="Output"
            tone="warning"
            statusText={`Buffering ${formatBytes(bufferedBytes)}`}
          />
        ) : null}
      </div>
      {overflowMessage ? (
        <Banner
          tone="warning"
          message={overflowMessage}
          actionLabel="Dismiss"
          onAction={() => setOverflowMessage(null)}
        />
      ) : null}
      {status === "error" && errorMessage ? (
        <ErrorState
          title="Terminal connection failed"
          description={errorMessage}
          testId={testId ? `${testId}-error` : undefined}
        />
      ) : null}
      <div
        ref={containerRef}
        className="pc-terminal__surface"
        role="group"
        aria-label={`Terminal ${terminalId}`}
        data-testid={testId}
      />
    </Card>
  );
}
