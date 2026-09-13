import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { App } from "./App.js";

/**
 * Warm the lazy route chunk BEFORE any assertion is timed. `lazyRouteComponent`
 * resolves a dynamic import on first render and vitest transforms that module
 * graph on demand, per worker; cold that is ~7s, which used to be spent inside
 * `findBy*` and made this file fail in roughly half of full-suite runs once the
 * feature tree grew. Moving the transform out of the timed window keeps the
 * assertion timeout meaningful rather than raising it to hide the cost.
 */
beforeAll(async () => {
  await import("../routes/screens/connect-screen.js");
}, 120_000);

describe("App shell", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.history.replaceState(null, "", "/");
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  it("redirects to /connect and shows a disconnected badge with no saved host", async () => {
    render(<App />);

    // T27A1's real `/connect` screen lazily pulls in
    // `@picompanion/frontend-core`'s `hosts` module (`ConnectionProber`
    // et al.); the first dynamic-`import()` transform of that chunk in a
    // fresh test process can take several seconds, well past
    // testing-library's 1000ms default `findBy*` wait.
    expect(
      await screen.findByRole("heading", { name: "Connect" }, { timeout: 15_000 }),
    ).toBeTruthy();
    const badge = await screen.findByText("Disconnected", {}, { timeout: 15_000 });
    expect(badge).toBeTruthy();
  }, 20_000);

  it("reflects the real connection lifecycle when the daemon-served connection hint is present: an unreachable hinted daemon reads disconnected, never connected", async () => {
    window.__PASEO_INITIAL_DAEMON_CONNECTION__ = {
      listen: "localhost:4317",
      useTls: false,
      label: "My Mac",
    };

    render(<App />);

    // The shell badge is fed by `DaemonClientProvider`'s live
    // `HostController` snapshot now, not by the hint alone: no daemon
    // listens on this port in the test environment, so the bootstrap
    // attempt fails and the badge honestly reads disconnected. (The old
    // fake adapter rendered "Connected" straight from the hint without
    // ever opening a socket.)
    expect(await screen.findByText("Disconnected", {}, { timeout: 15_000 })).toBeTruthy();
    expect(screen.queryByText("Connected")).toBeNull();

    delete window.__PASEO_INITIAL_DAEMON_CONNECTION__;
  }, 20_000);
});
