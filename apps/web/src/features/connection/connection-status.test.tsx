import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { hosts as HostsNamespace } from "@picompanion/frontend-core";

import { CoreProvider } from "../../app/core-context.js";
import { DaemonClientProvider } from "../../app/daemon-client-context.js";
import { ConnectionStatus } from "./connection-status.js";

/**
 * FIX-L3: the header's `ConnectionStatus` badge used to read
 * `use-connection-state.ts`'s `useConnectionState()`, a *second*
 * reactive subscription fed only by `daemon-client-context.tsx`'s
 * `DaemonClientProvider` republishing its own live
 * `HostControllerConnectionInfo` into `real-core-adapter.ts`'s
 * `RealCoreAdapter` from inside a `useEffect` — one render behind every
 * *direct* `useDaemonClientContext()` reader (`root-route.tsx`'s
 * `SessionRailContent`, whose connection foot renders
 * "connected · relay off", `host-screen.tsx`, and so on). The badge now
 * reads `useDaemonClientContext()` directly (this file's own fixture,
 * below), the same source every other live consumer already used, so
 * the two can no longer disagree about which render they are looking
 * at.
 *
 * A hand-written `FakeHostController` stands in for the real
 * `hosts.HostController` (a real `connectToProfile` handshake needs an
 * actual daemon, out of scope for a unit test) so this test can drive
 * the exact `connecting -> connected` transition a real controller
 * reports via `subscribeConnectionInfo`/`emitInfo` and assert the
 * header follows it.
 */
const { FakeHostController } = vi.hoisted(() => {
  class FakeHostControllerImpl {
    static instances: FakeHostControllerImpl[] = [];

    info: HostsNamespace.HostControllerConnectionInfo = {
      status: "idle",
      profileId: null,
      kind: null,
    };
    profiles = { list: async () => [] };
    private listeners = new Set<(info: HostsNamespace.HostControllerConnectionInfo) => void>();
    private profileLabel: string | null = null;

    constructor() {
      FakeHostControllerImpl.instances.push(this);
    }

    subscribeConnectionInfo(listener: (info: HostsNamespace.HostControllerConnectionInfo) => void) {
      this.listeners.add(listener);
      listener(this.info);
      return () => {
        this.listeners.delete(listener);
      };
    }

    getConnectionInfo() {
      return this.info;
    }

    getDaemonClient() {
      return null;
    }

    getCurrentProfile() {
      return this.profileLabel ? { label: this.profileLabel } : null;
    }

    async dispose() {}

    async connectToProfile() {}

    async disconnect() {}

    /** Test-only: simulates a real `HostController`'s `emitInfo` broadcast. */
    emit(
      status: HostsNamespace.HostControllerConnectionStatus,
      profileId: string | null,
      label: string | null,
    ) {
      this.profileLabel = label;
      this.info = { status, profileId, kind: profileId ? "direct" : null };
      for (const listener of this.listeners) listener(this.info);
    }
  }
  return { FakeHostController: FakeHostControllerImpl };
});

vi.mock("@picompanion/frontend-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@picompanion/frontend-core")>();
  return {
    ...actual,
    hosts: { ...actual.hosts, HostController: FakeHostController },
  };
});

function renderBadge() {
  render(
    <CoreProvider>
      <DaemonClientProvider>
        <ConnectionStatus />
      </DaemonClientProvider>
    </CoreProvider>,
  );
}

async function currentController() {
  await waitFor(() => expect(FakeHostController.instances).toHaveLength(1));
  return FakeHostController.instances[0]!;
}

describe("ConnectionStatus (header badge) reflects live connection changes", () => {
  afterEach(() => {
    cleanup();
    FakeHostController.instances.length = 0;
  });

  it("shows Connecting… while genuinely connecting, then the real transition to connected", async () => {
    renderBadge();
    const controller = await currentController();

    act(() => controller.emit("connecting", "profile-1", "192.168.0.158"));
    await waitFor(() => {
      expect(screen.getByText("Connecting…")).toBeTruthy();
    });

    act(() => controller.emit("connected", "profile-1", "192.168.0.158"));

    // The regression this task fixed: the header must not still say
    // "Connecting…" once the connection it is reporting on has already
    // reported "connected" — the same `info` every other live consumer
    // (e.g. the session rail's own connection foot) already reads.
    await waitFor(() => {
      expect(screen.queryByText("Connecting…")).toBeNull();
    });
    expect(screen.getByText("Connected")).toBeTruthy();
    expect(screen.getByText("192.168.0.158")).toBeTruthy();
  });

  it("still clears Connecting… after a reconnect cycle (drop, then reconnect)", async () => {
    renderBadge();
    const controller = await currentController();

    act(() => controller.emit("connecting", "profile-1", "192.168.0.158"));
    act(() => controller.emit("connected", "profile-1", "192.168.0.158"));
    await waitFor(() => expect(screen.getByText("Connected")).toBeTruthy());

    act(() => controller.emit("reconnect-pending", "profile-1", "192.168.0.158"));
    expect(screen.getByText("Connecting…")).toBeTruthy();

    act(() => controller.emit("connecting", "profile-1", "192.168.0.158"));
    act(() => controller.emit("connected", "profile-1", "192.168.0.158"));

    await waitFor(() => {
      expect(screen.queryByText("Connecting…")).toBeNull();
    });
    expect(screen.getByText("Connected")).toBeTruthy();
  });
});
