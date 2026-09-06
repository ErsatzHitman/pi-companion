import { describe, expect, it, vi } from "vitest";

import { createBrowserHostProbeTransport } from "./browser-probe-transport.js";
import type { ProbeSocket, ProbeSocketEventType } from "./browser-probe-transport.js";

class FakeSocket implements ProbeSocket {
  private readonly listeners = new Map<ProbeSocketEventType, Set<() => void>>();
  closed = false;

  addEventListener(type: ProbeSocketEventType, listener: () => void): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(listener);
  }

  removeEventListener(type: ProbeSocketEventType, listener: () => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  close(): void {
    this.closed = true;
  }

  emit(type: ProbeSocketEventType): void {
    for (const listener of this.listeners.get(type) ?? []) listener();
  }
}

describe("createBrowserHostProbeTransport", () => {
  it("resolves and closes the socket once it opens", async () => {
    let created: FakeSocket | null = null;
    const transport = createBrowserHostProbeTransport((url) => {
      created = new FakeSocket();
      expect(url).toBe("ws://localhost:6767/ws");
      return created;
    });

    const attempt = transport("ws://localhost:6767/ws");
    created!.emit("open");
    await expect(attempt).resolves.toBeUndefined();
    expect(created!.closed).toBe(true);
  });

  it("rejects when the socket errors", async () => {
    let created: FakeSocket | null = null;
    const transport = createBrowserHostProbeTransport(() => {
      created = new FakeSocket();
      return created;
    });

    const attempt = transport("ws://localhost:6767/ws");
    created!.emit("error");
    await expect(attempt).rejects.toThrow("Unable to reach ws://localhost:6767/ws");
  });

  it("rejects when the socket closes before opening", async () => {
    let created: FakeSocket | null = null;
    const transport = createBrowserHostProbeTransport(() => {
      created = new FakeSocket();
      return created;
    });

    const attempt = transport("ws://localhost:6767/ws");
    created!.emit("close");
    await expect(attempt).rejects.toThrow("Unable to reach ws://localhost:6767/ws");
  });

  it("never settles twice for the same attempt", async () => {
    let created: FakeSocket | null = null;
    const transport = createBrowserHostProbeTransport(() => {
      created = new FakeSocket();
      return created;
    });

    const attempt = transport("ws://localhost:6767/ws");
    created!.emit("open");
    created!.emit("error"); // must be ignored: already resolved
    await expect(attempt).resolves.toBeUndefined();
  });

  it("rejects synchronously when the socket factory throws", async () => {
    const transport = createBrowserHostProbeTransport(() => {
      throw new Error("blocked by CSP");
    });
    await expect(transport("ws://localhost:6767/ws")).rejects.toThrow("blocked by CSP");
  });

  it("defaults to the real WebSocket constructor when no factory is supplied", () => {
    const originalWebSocket = globalThis.WebSocket;
    const ctor = vi.fn(function FakeWebSocketCtor(this: ProbeSocket) {
      this.addEventListener = vi.fn();
      this.removeEventListener = vi.fn();
      this.close = vi.fn();
    });
    // @ts-expect-error -- test-only stand-in for the global constructor
    globalThis.WebSocket = ctor;
    try {
      const transport = createBrowserHostProbeTransport();
      void transport("ws://localhost:6767/ws");
      expect(ctor).toHaveBeenCalledWith("ws://localhost:6767/ws");
    } finally {
      globalThis.WebSocket = originalWebSocket;
    }
  });
});
