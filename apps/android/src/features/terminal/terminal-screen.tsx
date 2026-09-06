import type { Clock, TimerHandle } from "@picompanion/frontend-core";
import { useEffect, useMemo, useRef } from "react";
import { StyleSheet, View } from "react-native";

import { EmptyState } from "../../ui/primitives";
import { useTheme } from "../../ui/theme/theme-context";
import {
  createNotConnectedTerminalBinaryTransport,
  type TerminalBinaryTransport,
} from "./terminal-binary-transport";
import { TerminalSessionController } from "./terminal-session-controller";
import { buildTerminalTheme } from "./terminal-theme";
import {
  createUnavailableTerminalWebViewPort,
  type TerminalWebViewPort,
} from "./terminal-webview-port";

export interface TerminalScreenProps {
  serverId: string;
  agentId: string;
  terminalId: string;
  /**
   * Injectable, RN-free daemon seam — test/DI seam mirroring
   * `QrPairingPanel`'s `scanner` prop and `files-screen.tsx`'s `client`
   * prop. Defaults to `createNotConnectedTerminalBinaryTransport()`:
   * `AppCore` (`app-shell/core.ts`, T32S6's grant this wave) exposes no
   * terminal transport today, so a production caller never passes this
   * yet — see this module's docstring for what a real mount needs.
   */
  transport?: TerminalBinaryTransport;
  /**
   * Injectable WebView seam. Defaults to
   * `createUnavailableTerminalWebViewPort()`: `apps/android/package.json`
   * has no `react-native-webview` installed (see
   * `terminal-webview-port.ts`'s module docstring) — see this module's
   * docstring for what a real mount needs.
   */
  webview?: TerminalWebViewPort;
  /** Fixed daemon terminal-stream slot for this screen's terminal. Defaults to `0` (single-terminal screen). */
  slot?: number;
}

/**
 * `/h/:serverId/session/:agentId/terminal/:terminalId` real terminal
 * screen (T35B1, plan.md §12.4 "Android rebuilds an xterm WebView
 * wrapper from the established binary protocol and behavior tests").
 * Replaces the T32S1C `RoutePlaceholder` body; the route file that
 * renders this (`../../app/h/[serverId]/session/[agentId]/terminal/
 * [terminalId].tsx`) needs no change for that swap, and needs none for
 * either follow-up below.
 *
 * All the behavior worth proving — binary frame decode/encode, resize
 * ownership and debouncing, "don't race the daemon" readiness gating —
 * lives in `terminal-session-controller.ts` and
 * `terminal-resize-controller.ts`, which vitest can and does exercise
 * directly (see their `.test.ts` files). This component is deliberately
 * a thin, unproven view over that model — the same shape
 * `QrPairingPanel.tsx` and `ConnectForm.tsx` already use — because any
 * module reaching `react-native` fails under this workspace's vitest
 * (`CLAUDE.md`'s "VITEST LIMITATION").
 *
 * **What a real mount still needs, beyond this task's `Owns` grant:**
 *
 * 1. `npm install --workspace=@picompanion/android react-native-webview@13.16.1`
 *    plus a real `TerminalWebViewPort` implementation (see
 *    `terminal-webview-port.ts`'s module doc for the exact shape).
 * 2. A real `TerminalBinaryTransport` backed by `AppCore`'s daemon
 *    connection (`packages/client`'s `DaemonClient.subscribeTerminal` /
 *    `sendTerminalInput` / `onTerminalStreamEvent` — see
 *    `terminal-binary-transport.ts`'s module doc) passed as this
 *    component's `transport` prop, and a slot obtained from
 *    `subscribeTerminal`'s response passed as `slot`.
 * 3. Proof on an emulator/device (T37E, T59) — nothing here is proven
 *    beyond an injected fake transport and a scripted fake WebView port.
 *
 * **T80 (P5-W23)**: route-level wiring for `webview` is done — the route
 * that renders this (`../../app/h/[serverId]/session/[agentId]/terminal/
 * [terminalId].tsx`) now passes `AppCore["terminalWebview"]`
 * (`../../app-shell/core.ts`) as this component's `webview` prop, the
 * same way it already passes `transport`. `react-native-webview` is
 * still not installed (item 1 above), so that field is still
 * `createUnavailableTerminalWebViewPort()`, which never fires `onReady`
 * — so this screen still renders `EmptyState` and never sends or
 * receives a single byte, an honest "nothing to draw" rather than a
 * simulated terminal. Once (1) resolves, swapping `AppCore
 * ["terminalWebview"]`'s single construction for a real implementation is
 * the only change needed — neither this component nor its route needs to
 * change again.
 */
export function TerminalScreen({
  serverId: _serverId,
  agentId: _agentId,
  terminalId,
  transport,
  webview,
  slot = 0,
}: TerminalScreenProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const terminalTheme = useMemo(() => buildTerminalTheme(theme), [theme]);

  const resolvedTransport = useMemo(
    () => transport ?? createNotConnectedTerminalBinaryTransport(),
    [transport],
  );
  const resolvedWebview = useMemo(
    () => webview ?? createUnavailableTerminalWebViewPort(),
    [webview],
  );

  const controllerRef = useRef<TerminalSessionController | null>(null);

  useEffect(() => {
    const controller = new TerminalSessionController({
      transport: resolvedTransport,
      webview: resolvedWebview,
      slot,
      clock: createTerminalScreenClock(),
    });
    controllerRef.current = controller;
    controller.setVisible(true);
    controller.setTheme(terminalTheme);
    return () => {
      controller.setVisible(false);
      controller.dispose();
      controllerRef.current = null;
    };
    // Re-created whenever the injected ports or slot identity change —
    // theme changes are pushed onto the existing controller below instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedTransport, resolvedWebview, slot]);

  useEffect(() => {
    controllerRef.current?.setTheme(terminalTheme);
  }, [terminalTheme]);

  if (!resolvedWebview.isAvailable) {
    return (
      <View style={styles.container} testID="terminal-screen">
        <EmptyState
          title="Terminal unavailable"
          description="This build has no embedded terminal renderer installed yet. Your session and its output are unaffected."
          testId="terminal-unavailable"
        />
      </View>
    );
  }

  return (
    <View
      style={styles.container}
      testID="terminal-screen"
      accessibilityLabel={`Terminal ${terminalId}`}
    >
      {/* A real WebView host mounts here once `webview.isAvailable` — its
          native rendering is out of vitest's reach and out of this
          task's Owns grant to write until react-native-webview lands
          (see module docstring). */}
    </View>
  );
}

/**
 * Real-timer `Clock` for this screen's own controller instance, matching
 * `files-model.ts`'s `createFilesClock()` precedent (that file's doc
 * explains why this app has no single shared `Clock` adapter yet).
 */
function createTerminalScreenClock(): Clock {
  return {
    now: () => Date.now(),
    setTimeout: (callback, delayMs) => setTimeout(callback, delayMs) as unknown as TimerHandle,
    clearTimeout: (handle) => {
      clearTimeout(handle as unknown as ReturnType<typeof setTimeout>);
    },
    setInterval: (callback, intervalMs) =>
      setInterval(callback, intervalMs) as unknown as TimerHandle,
    clearInterval: (handle) => {
      clearInterval(handle as unknown as ReturnType<typeof setInterval>);
    },
  };
}

function createStyles(theme: ReturnType<typeof useTheme>["theme"]) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.colors.page,
    },
  });
}
