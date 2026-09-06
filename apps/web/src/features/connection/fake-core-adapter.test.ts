import { describe, expect, it } from "vitest";

import {
  type FakeCoreAdapterPlatform,
  SAVED_DAEMON_HOST_STORAGE_KEY,
  createFakeCoreAdapter,
} from "./fake-core-adapter.js";

function fakePlatform(savedHost: string | null = null): FakeCoreAdapterPlatform {
  return {
    clock: { now: () => 1_000 },
    storage: {
      async getItem(key) {
        return key === SAVED_DAEMON_HOST_STORAGE_KEY ? savedHost : null;
      },
    },
  };
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("createFakeCoreAdapter", () => {
  it("starts connecting before any source resolves", () => {
    const adapter = createFakeCoreAdapter(fakePlatform());
    expect(adapter.getConnectionSnapshot().state).toBe("connecting");
    adapter.dispose();
  });

  it("resolves to connected using the daemon-served hint when present", async () => {
    const adapter = createFakeCoreAdapter(fakePlatform("saved-host"), {
      hint: { listen: "localhost:4317", useTls: false, label: "My Mac" },
    });
    await flush();
    expect(adapter.getConnectionSnapshot()).toMatchObject({
      state: "connected",
      serverId: "localhost:4317",
      label: "My Mac",
    });
    adapter.dispose();
  });

  it("falls back to an explicit standalone dev host over a saved host", async () => {
    const adapter = createFakeCoreAdapter(fakePlatform("saved-host"), {
      devDaemonHost: "localhost:9999",
    });
    await flush();
    expect(adapter.getConnectionSnapshot()).toMatchObject({
      state: "connected",
      serverId: "localhost:9999",
    });
    adapter.dispose();
  });

  it("falls back to a manually saved host when no hint or dev host is set", async () => {
    const adapter = createFakeCoreAdapter(fakePlatform("saved-host"));
    await flush();
    expect(adapter.getConnectionSnapshot()).toMatchObject({
      state: "connected",
      serverId: "saved-host",
    });
    adapter.dispose();
  });

  it("resolves to disconnected when no source provides a host", async () => {
    const adapter = createFakeCoreAdapter(fakePlatform(null));
    await flush();
    expect(adapter.getConnectionSnapshot()).toMatchObject({
      state: "disconnected",
      serverId: null,
    });
    adapter.dispose();
  });

  it("notifies subscribers exactly once when the snapshot resolves", async () => {
    const adapter = createFakeCoreAdapter(fakePlatform(null));
    let notifications = 0;
    const unsubscribe = adapter.subscribeConnection(() => {
      notifications += 1;
    });
    await flush();
    expect(notifications).toBe(1);
    unsubscribe();
    adapter.dispose();
  });

  it("stops notifying after dispose", async () => {
    const adapter = createFakeCoreAdapter(fakePlatform("saved-host"));
    let notifications = 0;
    adapter.subscribeConnection(() => {
      notifications += 1;
    });
    adapter.dispose();
    await flush();
    expect(notifications).toBe(0);
  });
});
