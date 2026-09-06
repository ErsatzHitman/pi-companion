import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CoreProvider } from "./core-context.js";
import { DaemonClientProvider, useDaemonClientContext } from "./daemon-client-context.js";

/**
 * Covers T53A1's acceptance criteria directly (`App.test.tsx` only
 * exercises this indirectly through the full router tree). Real
 * `platform.structuredStorage`/`secureStorage` are IndexedDB-/
 * localStorage-backed (`apps/web/src/platform`); jsdom has no
 * `indexedDB`, so every path here exercises this module's documented
 * "absence of a connection is a normal state, not a crash" behaviour
 * for real, not just against a fake.
 */
function Probe() {
  const { client, info, hostController } = useDaemonClientContext();
  return (
    <div>
      <span data-testid="probe-client">{client ? "has-client" : "no-client"}</span>
      <span data-testid="probe-status">{info.status}</span>
      <span data-testid="probe-controller">
        {hostController ? "has-controller" : "no-controller"}
      </span>
    </div>
  );
}

describe("daemon-client-context", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    delete window.__PASEO_INITIAL_DAEMON_CONNECTION__;
  });

  it("useDaemonClientContext() outside a provider returns the idle default instead of throwing", () => {
    const { result } = renderHook(() => useDaemonClientContext());
    expect(result.current.client).toBeNull();
    expect(result.current.hostController).toBeNull();
    expect(result.current.info.status).toBe("idle");
  });

  it("renders children immediately with no saved host and never crashes while there is no reachable daemon", async () => {
    render(
      <CoreProvider>
        <DaemonClientProvider>
          <Probe />
        </DaemonClientProvider>
      </CoreProvider>,
    );

    // Rendering never blocks on a connection attempt (T53A1: "absence of
    // a connection is a normal state, not a crash").
    expect(screen.getByTestId("probe-client").textContent).toBe("no-client");
    expect(screen.getByTestId("probe-controller")).toBeTruthy();

    // A HostController is constructed (async, inside an effect) even
    // with nothing saved to connect to.
    await waitFor(() => {
      expect(screen.getByTestId("probe-controller").textContent).toBe("has-controller");
    });
    expect(screen.getByTestId("probe-client").textContent).toBe("no-client");
  });

  it("attempts (and does not crash on) a daemon-injected bootstrap hint", async () => {
    window.__PASEO_INITIAL_DAEMON_CONNECTION__ = {
      listen: "localhost:4319",
      useTls: false,
      label: "Bootstrap host",
    };

    render(
      <CoreProvider>
        <DaemonClientProvider>
          <Probe />
        </DaemonClientProvider>
      </CoreProvider>,
    );

    // No real daemon is listening on this port in the test environment,
    // so the attempt resolves to "disconnected" (HostController's own
    // reported outcome), never a thrown error reaching this render.
    await waitFor(
      () => {
        expect(screen.getByTestId("probe-status").textContent).toBe("disconnected");
      },
      { timeout: 15_000 },
    );
    expect(screen.getByTestId("probe-client").textContent).toBe("no-client");
  }, 20_000);
});
