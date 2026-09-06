import type { TerminalStreamEvent } from "@picompanion/client/internal/daemon-client";
import type { terminal } from "@picompanion/frontend-core";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { axe } from "jest-axe";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { TerminalTransportStatus, TerminalTransportStatusSource } from "./terminal-view.js";
import { TerminalView } from "./terminal-view.js";

afterEach(cleanup);

/**
 * A fake `@xterm/xterm`/`@xterm/addon-fit` pair, mirroring the real
 * package's constructor/`onData`/`onResize`/`write`/`reset` contract
 * closely enough to exercise `TerminalView`'s wiring without needing a
 * canvas-backed renderer under jsdom (xterm.js itself isn't meaningfully
 * testable there — see `docs/issues-from-plan.md` T30A2's "round-trips
 * against a dev daemon" criterion, covered end-to-end by T31C's
 * Playwright harness against a real daemon instead).
 */
const { FakeTerminal, FakeFitAddon, instances } = vi.hoisted(() => {
  class FakeFitAddonImpl {
    fitCalls = 0;
    fit(): void {
      this.fitCalls += 1;
    }
  }

  class FakeTerminalImpl {
    rows = 24;
    cols = 80;
    options: Record<string, unknown>;
    written: Array<{ kind: "write" | "reset"; data: string | Uint8Array }> = [];
    disposed = false;
    dataHandler: ((data: string) => void) | null = null;
    resizeHandler: ((event: { cols: number; rows: number }) => void) | null = null;

    constructor(options: Record<string, unknown>) {
      this.options = options;
    }

    loadAddon(): void {}

    open(el: HTMLElement): void {
      el.setAttribute("data-fake-xterm-mounted", "true");
    }

    write(data: string | Uint8Array, callback?: () => void): void {
      this.written.push({ kind: "write", data });
      callback?.();
    }

    reset(): void {
      this.written.push({ kind: "reset", data: new Uint8Array() });
    }

    onData(handler: (data: string) => void) {
      this.dataHandler = handler;
      return { dispose: () => {} };
    }

    onResize(handler: (event: { cols: number; rows: number }) => void) {
      this.resizeHandler = handler;
      return { dispose: () => {} };
    }

    dispose(): void {
      this.disposed = true;
    }

    focus(): void {}
  }

  const instanceList: FakeTerminalImpl[] = [];
  class TrackedFakeTerminal extends FakeTerminalImpl {
    constructor(options: Record<string, unknown>) {
      super(options);
      instanceList.push(this);
    }
  }

  return {
    FakeTerminal: TrackedFakeTerminal,
    FakeFitAddon: FakeFitAddonImpl,
    instances: instanceList,
  };
});

vi.mock("@xterm/xterm", () => ({ Terminal: FakeTerminal }));
vi.mock("@xterm/addon-fit", () => ({ FitAddon: FakeFitAddon }));

class FakeTerminalRpcClient implements terminal.TerminalRpcClient {
  subscribeCalls: Array<{ terminalId: string; restore?: unknown }> = [];
  unsubscribeCalls: string[] = [];
  sentInput: Array<{ terminalId: string; message: unknown }> = [];
  outcome: { terminalId: string; slot?: number; error: string | null } = {
    terminalId: "term-1",
    slot: 0,
    error: null,
  };

  private readonly listeners = new Set<(event: TerminalStreamEvent) => void>();

  async subscribeTerminal(terminalId: string, options?: { restore?: unknown }) {
    this.subscribeCalls.push({ terminalId, restore: options?.restore });
    return this.outcome;
  }

  unsubscribeTerminal(terminalId: string): void {
    this.unsubscribeCalls.push(terminalId);
  }

  sendTerminalInput(terminalId: string, message: unknown): void {
    this.sentInput.push({ terminalId, message });
  }

  onTerminalStreamEvent(handler: (event: TerminalStreamEvent) => void): () => void {
    this.listeners.add(handler);
    return () => this.listeners.delete(handler);
  }

  emit(event: TerminalStreamEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}

/**
 * Adds `TerminalTransportStatusSource` on top of `FakeTerminalRpcClient`,
 * mirroring how a real `DaemonClient`'s `subscribeConnectionStatus`
 * behaves: registering a listener calls it immediately with the current
 * status (T30A3's reconnect-detection code relies on that to establish
 * its baseline without mistaking it for a reconnect).
 */
class FakeTerminalRpcClientWithTransport
  extends FakeTerminalRpcClient
  implements TerminalTransportStatusSource
{
  transportStatus: TerminalTransportStatus = { status: "connected" };
  private readonly transportListeners = new Set<(state: TerminalTransportStatus) => void>();

  subscribeConnectionStatus(listener: (state: TerminalTransportStatus) => void): () => void {
    this.transportListeners.add(listener);
    listener(this.transportStatus);
    return () => this.transportListeners.delete(listener);
  }

  setTransportStatus(status: TerminalTransportStatus): void {
    this.transportStatus = status;
    for (const listener of this.transportListeners) listener(status);
  }
}

describe("TerminalView", () => {
  it("subscribes on mount and shows a connected status once the daemon accepts it", async () => {
    const client = new FakeTerminalRpcClient();
    render(<TerminalView client={client} terminalId="term-1" testId="tv" />);

    await waitFor(() => expect(client.subscribeCalls).toHaveLength(1));
    expect(client.subscribeCalls[0]?.terminalId).toBe("term-1");
    await waitFor(() => expect(screen.getByTestId("tv-status").textContent).toContain("Connected"));
  });

  it("round-trips daemon output into the mounted terminal (write)", async () => {
    const client = new FakeTerminalRpcClient();
    render(<TerminalView client={client} terminalId="term-1" testId="tv" />);
    await waitFor(() => expect(client.subscribeCalls).toHaveLength(1));

    const payload = new TextEncoder().encode("hello from the daemon\r\n");
    client.emit({ type: "output", terminalId: "term-1", data: payload });

    await waitFor(() => {
      const term = instances.at(-1);
      expect(term?.written.some((entry) => entry.kind === "write" && entry.data === payload)).toBe(
        true,
      );
    });
  });

  it("round-trips typed input to the daemon (sendTerminalInput)", async () => {
    const client = new FakeTerminalRpcClient();
    render(<TerminalView client={client} terminalId="term-1" testId="tv" />);
    await waitFor(() => expect(client.subscribeCalls).toHaveLength(1));

    const term = instances.at(-1);
    term?.dataHandler?.("ls -la\n");

    await waitFor(() => expect(client.sentInput).toHaveLength(1));
    expect(client.sentInput[0]).toEqual({
      terminalId: "term-1",
      message: { type: "input", data: "ls -la\n" },
    });
  });

  it("forwards xterm resize to the controller as an ownership-aware resize request (T30A3)", async () => {
    // The initial subscribe already claimed the terminal's size (its
    // `restore.size` is an implicit daemon-side claim), so a resize that
    // happens afterwards while still connected asserts "update", never a
    // redundant "claim" — see `terminal-resize-ownership.ts`.
    const client = new FakeTerminalRpcClient();
    render(<TerminalView client={client} terminalId="term-1" testId="tv" />);
    await waitFor(() => expect(client.subscribeCalls).toHaveLength(1));

    const term = instances.at(-1);
    term?.resizeHandler?.({ cols: 100, rows: 40 });

    await waitFor(() =>
      expect(client.sentInput).toContainEqual({
        terminalId: "term-1",
        message: { type: "resize", rows: 40, cols: 100, intent: "update" },
      }),
    );
  });

  it("keeps resize latency synchronous: no artificial delay between an xterm resize and the outgoing request (plan.md §14.5)", async () => {
    const client = new FakeTerminalRpcClient();
    render(<TerminalView client={client} terminalId="term-1" testId="tv" />);
    await waitFor(() => expect(client.subscribeCalls).toHaveLength(1));

    const term = instances.at(-1);
    const before = client.sentInput.length;
    term?.resizeHandler?.({ cols: 90, rows: 30 });

    // No `waitFor`/timer advance needed: the resize is forwarded in the
    // same synchronous call stack as the xterm event, not batched or
    // debounced behind a delay.
    expect(client.sentInput.length).toBe(before + 1);
    expect(client.sentInput.at(-1)).toEqual({
      terminalId: "term-1",
      message: { type: "resize", rows: 30, cols: 90, intent: "update" },
    });
  });

  it("shows the daemon's subscribe error instead of a silent failure", async () => {
    const client = new FakeTerminalRpcClient();
    client.outcome = { terminalId: "term-1", error: "terminal not found" };
    render(<TerminalView client={client} terminalId="term-1" testId="tv" />);

    const errorRegion = await screen.findByTestId("tv-error");
    expect(errorRegion.textContent).toContain("terminal not found");
  });

  it("reports client-side congestion once buffered output crosses the soft cap", async () => {
    const client = new FakeTerminalRpcClient();
    render(<TerminalView client={client} terminalId="term-1" testId="tv" />);
    await waitFor(() => expect(client.subscribeCalls).toHaveLength(1));

    // Make the sink never resolve so bytes pile up in the client-side
    // backpressure buffer (plan.md §14.5) instead of draining immediately.
    const term = instances.at(-1);
    if (term) {
      term.write = () => {
        /* never calls back: simulates a stalled sink */
      };
    }

    // The buffer hands the first arrival straight to the (now-stalled)
    // sink, so it never counts toward "queued" bytes; a second arrival
    // piles up behind it and is what actually crosses the soft cap.
    client.emit({ type: "output", terminalId: "term-1", data: new Uint8Array(16) });
    const big = new Uint8Array(4 * 1024 * 1024 + 1);
    client.emit({ type: "output", terminalId: "term-1", data: big });

    await waitFor(() => expect(screen.queryByText(/Buffering/)).toBeTruthy());
  }, 15_000);

  /**
   * T41A4 — "keep terminal latency within budget" (plan.md §14.5,
   * docs/issues-from-plan.md).
   *
   * WHAT THIS PROVES: bounds on *work done* in this app's own code path
   * (event arrival -> sink call, resize call -> outgoing request), in a
   * deterministic vitest run — never a millisecond number from a fake
   * clock. Concretely: (1) an output event reaches the sink in the exact
   * same synchronous call stack it arrived in, with zero scheduled
   * timers, so no wait/poll is needed to observe it; (2) queued output
   * chunks are applied strictly one at a time, in arrival order — never
   * more than one write in flight to the sink at once, matching xterm's
   * own backpressure contract; (3) the existing 8 MiB hard cap
   * (`TerminalOutputBuffer`, `@picompanion/frontend-core`) is honoured
   * through this app's own wiring, not just in that package's own tests;
   * (4) a rapid burst of resize events, interleaved with data, is
   * forwarded individually and in call order — no debounce or coalescing
   * silently drops an intermediate or final resize ("last writer wins").
   *
   * WHAT THIS DOES NOT PROVE: an actual wall-clock p95 in a real browser
   * (the local-live-event-to-paint-under-100ms clause of §14.5). This
   * repository cannot open a socket to a daemon or drive a real browser
   * from this task (see CLAUDE.md), so that number can only come from
   * the real-browser Playwright harness (T31C's pattern) against a real
   * `DaemonClient` and a real xterm paint — which is out of reach here.
   * These tests instead prove the one thing a fast-but-wrong number would
   * hide: that nothing in this app's own wiring adds unbounded, batched,
   * or out-of-order work on top of whatever the real render costs.
   */
  describe("T41A4 — terminal latency budget (plan.md §14.5)", () => {
    it("keeps output-data latency synchronous: the sink receives it in the same call stack as the stream event, no timer scheduled", async () => {
      const client = new FakeTerminalRpcClient();
      render(<TerminalView client={client} terminalId="term-1" testId="tv" />);
      await waitFor(() => expect(client.subscribeCalls).toHaveLength(1));

      const term = instances.at(-1);
      const payload = new TextEncoder().encode("no artificial delay");
      client.emit({ type: "output", terminalId: "term-1", data: payload });

      // No `waitFor`/timer advance: the write already landed synchronously
      // in the same call stack as `emit()`, mirroring the existing
      // "keeps resize latency synchronous" proof above for the data path.
      expect(term?.written).toEqual([{ kind: "write", data: payload }]);
    });

    it("applies queued output chunks one at a time in strict arrival order — never more than one write in flight to the sink", async () => {
      const client = new FakeTerminalRpcClient();
      render(<TerminalView client={client} terminalId="term-1" testId="tv" />);
      await waitFor(() => expect(client.subscribeCalls).toHaveLength(1));

      const term = instances.at(-1);
      if (!term) throw new Error("terminal instance missing");

      // A controllable sink: `write` records the call but only resolves
      // when this test explicitly drains a pending callback — simulating
      // a real (slower) xterm render that hasn't finished yet.
      const pendingCallbacks: Array<() => void> = [];
      term.write = (data, callback) => {
        term.written.push({ kind: "write", data });
        if (callback) pendingCallbacks.push(callback);
      };

      const a = new TextEncoder().encode("A");
      const b = new TextEncoder().encode("B");
      const c = new TextEncoder().encode("C");
      client.emit({ type: "output", terminalId: "term-1", data: a });
      client.emit({ type: "output", terminalId: "term-1", data: b });
      client.emit({ type: "output", terminalId: "term-1", data: c });

      // All three arrived before any write resolved: only the FIRST
      // chunk should have reached the sink so far — B and C are queued
      // behind it, not applied concurrently or out of order.
      expect(term.written.map((entry) => entry.data)).toEqual([a]);

      pendingCallbacks.shift()?.();
      await waitFor(() => expect(term.written.map((entry) => entry.data)).toEqual([a, b]));

      pendingCallbacks.shift()?.();
      await waitFor(() => expect(term.written.map((entry) => entry.data)).toEqual([a, b, c]));
    });

    it("honours the existing 8 MiB hard cap through this app's own wiring: drops the backlog and auto-resyncs (plan.md §14.5)", async () => {
      const client = new FakeTerminalRpcClient();
      render(<TerminalView client={client} terminalId="term-1" testId="tv" />);
      await waitFor(() => expect(client.subscribeCalls).toHaveLength(1));

      // Stall the sink so bytes actually queue (mirrors the soft-cap test
      // above) rather than draining immediately.
      const term = instances.at(-1);
      if (term) {
        term.write = () => {
          /* never calls back: simulates a stalled sink */
        };
      }

      client.emit({ type: "output", terminalId: "term-1", data: new Uint8Array(16) });
      const overHardCap = new Uint8Array(8 * 1024 * 1024 + 1);
      client.emit({ type: "output", terminalId: "term-1", data: overHardCap });

      // The overflow banner appears (dropped backlog surfaced, not silently
      // discarded) and the controller automatically requests a fresh
      // full-snapshot resync — a second `subscribeTerminal` call.
      await waitFor(() => expect(screen.queryByText(/resynced/i)).toBeTruthy());
      await waitFor(() => expect(client.subscribeCalls).toHaveLength(2));
      expect(client.subscribeCalls[1]?.restore).toEqual({ mode: "full-snapshot" });
    });

    it("forwards every resize individually and in call order under a rapid burst interleaved with data — no debounce swallows an intermediate or final resize", async () => {
      const client = new FakeTerminalRpcClient();
      render(<TerminalView client={client} terminalId="term-1" testId="tv" />);
      await waitFor(() => expect(client.subscribeCalls).toHaveLength(1));

      const term = instances.at(-1);
      // Interleave three rapid resizes with two data events, all fired
      // synchronously in the same burst — the closest a single-threaded
      // unit test can get to "concurrent" load.
      term?.resizeHandler?.({ cols: 90, rows: 30 });
      term?.dataHandler?.("x");
      term?.resizeHandler?.({ cols: 95, rows: 32 });
      client.emit({ type: "output", terminalId: "term-1", data: new TextEncoder().encode("y") });
      term?.resizeHandler?.({ cols: 100, rows: 40 });

      const resizes = client.sentInput
        .map((entry) => entry.message as { type: string; rows?: number; cols?: number })
        .filter((message) => message.type === "resize");

      // All three were forwarded — none dropped or coalesced by the burst
      // — in exact call order, and the LAST entry carries the LAST call's
      // dimensions: "last writer wins" under load, never an earlier one.
      expect(resizes).toEqual([
        { type: "resize", rows: 30, cols: 90, intent: "update" },
        { type: "resize", rows: 32, cols: 95, intent: "update" },
        { type: "resize", rows: 40, cols: 100, intent: "update" },
      ]);
    });
  });

  it("unsubscribes and disposes xterm on unmount", async () => {
    const client = new FakeTerminalRpcClient();
    const { unmount } = render(<TerminalView client={client} terminalId="term-1" testId="tv" />);
    await waitFor(() => expect(client.subscribeCalls).toHaveLength(1));

    const term = instances.at(-1);
    unmount();

    expect(client.unsubscribeCalls).toContain("term-1");
    expect(term?.disposed).toBe(true);
  });

  it("has no axe violations while connected", async () => {
    const client = new FakeTerminalRpcClient();
    const { container } = render(<TerminalView client={client} terminalId="term-1" testId="tv" />);
    await waitFor(() => expect(client.subscribeCalls).toHaveLength(1));

    expect(await axe(container)).toHaveNoViolations();
  }, 20_000);

  it("does not resubscribe when the client is only a narrow TerminalRpcClient without transport status", async () => {
    // `FakeTerminalRpcClient` here deliberately doesn't implement
    // `TerminalTransportStatusSource` — a real `DaemonClient` does (see
    // `TerminalTransportStatusSource`'s own doc and T53A1/T53A5, which
    // wire one into this route), but `TerminalRpcClient` itself stays
    // narrow on purpose (plan.md §5), so this asserts the narrower shape
    // alone never throws or double-subscribes, not that no live client
    // exists in the app.
    const client = new FakeTerminalRpcClient();
    render(<TerminalView client={client} terminalId="term-1" testId="tv" />);
    await waitFor(() => expect(client.subscribeCalls).toHaveLength(1));

    // Nothing to drive a reconnect through — mounting must not throw or
    // otherwise behave differently just because `subscribeConnectionStatus`
    // is absent (plan.md §5, `TerminalRpcClient` stays narrow on purpose).
    expect(client.subscribeCalls).toHaveLength(1);
  });

  it('shows a distinct status the moment the transport drops, not a stale "Connected" (T30A3)', async () => {
    const client = new FakeTerminalRpcClientWithTransport();
    render(<TerminalView client={client} terminalId="term-1" testId="tv" />);
    await waitFor(() => expect(client.subscribeCalls).toHaveLength(1));
    await waitFor(() => expect(screen.getByTestId("tv-status").textContent).toContain("Connected"));

    client.setTransportStatus({ status: "disconnected" });

    await waitFor(() =>
      expect(screen.getByTestId("tv-status").textContent).toContain("Connection lost"),
    );
  });

  it("resubscribes and re-claims size ownership as soon as the transport reconnects, well within the latency budget (plan.md §14.5)", async () => {
    const client = new FakeTerminalRpcClientWithTransport();
    render(<TerminalView client={client} terminalId="term-1" testId="tv" />);
    await waitFor(() => expect(client.subscribeCalls).toHaveLength(1));

    // Established ownership: the next resize after the initial subscribe
    // is an "update", not a redundant "claim".
    const term = instances.at(-1);
    term?.resizeHandler?.({ cols: 100, rows: 40 });
    await waitFor(() =>
      expect(client.sentInput).toContainEqual({
        terminalId: "term-1",
        message: { type: "resize", rows: 40, cols: 100, intent: "update" },
      }),
    );

    client.setTransportStatus({ status: "disconnected" });
    await waitFor(() =>
      expect(screen.getByTestId("tv-status").textContent).toContain("Connection lost"),
    );

    client.setTransportStatus({ status: "connected" });

    // §14.5: reconnect restores usability "immediately"/"within one second
    // of socket readiness" — a short `waitFor` timeout here is itself the
    // latency assertion, not just a polling convenience.
    await waitFor(() => expect(client.subscribeCalls).toHaveLength(2), { timeout: 200 });
    await waitFor(
      () => expect(screen.getByTestId("tv-status").textContent).toContain("Connected"),
      { timeout: 200 },
    );

    // The resubscribe re-claimed ownership server-side, so this view's own
    // bookkeeping must agree: the very next resize after reconnecting is an
    // "update" again, not a fresh "claim" for every keystroke-adjacent fit.
    term?.resizeHandler?.({ cols: 110, rows: 45 });
    await waitFor(() =>
      expect(client.sentInput).toContainEqual({
        terminalId: "term-1",
        message: { type: "resize", rows: 45, cols: 110, intent: "update" },
      }),
    );
  });

  it("a failed resubscribe after reconnecting surfaces the daemon's error instead of pretending the terminal is usable", async () => {
    const client = new FakeTerminalRpcClientWithTransport();
    render(<TerminalView client={client} terminalId="term-1" testId="tv" />);
    await waitFor(() => expect(client.subscribeCalls).toHaveLength(1));

    client.setTransportStatus({ status: "disconnected" });
    await waitFor(() =>
      expect(screen.getByTestId("tv-status").textContent).toContain("Connection lost"),
    );

    client.outcome = { terminalId: "term-1", error: "terminal not found" };
    client.setTransportStatus({ status: "connected" });

    const errorRegion = await screen.findByTestId("tv-error");
    expect(errorRegion.textContent).toContain("terminal not found");
  });
});
