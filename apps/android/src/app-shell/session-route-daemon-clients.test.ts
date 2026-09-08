import { describe, expect, it, vi } from "vitest";

import {
  resolveAttachmentDownloadClient,
  resolveEditorTextClient,
  resolveQueueModeClient,
  resolveSlashCommandsClient,
  resolveTranscribeClient,
  resolveTurnStatusClient,
  type SessionRouteConnectionSource,
} from "./session-route-daemon-clients";

/**
 * T132: proves the resolve step itself — not merely that `index.tsx`'s
 * source text mentions these functions (that lives in `index.test.ts`),
 * but that a real value `AppCore.connection.getActiveLifecycle()?.
 * getDaemonClient()` could return actually reaches the object
 * `Composer`'s `queueModeClient`/`turnStatusClient` props would receive,
 * unchanged, and that calling a method on the RETURNED value reaches
 * the exact counting fake this test constructs — never a clone, an
 * adapter, or a value dropped along the way.
 *
 * This file imports no `react-native` (`./session-route-daemon-clients.ts`
 * pulls only *types* from `features/composer`, erased at compile time),
 * so it runs under plain `vitest` with no mocks at all, unlike every
 * test in this directory that touches `index.tsx` itself.
 */

/** A counting fake shaped like the slice of `DaemonClient` both `DaemonQueueModeSource` and `DaemonTurnStatusSource` need — one object standing in for the ONE live client both resolve functions read off the same connection. */
function createCountingFakeDaemonClient() {
  const calls: unknown[][] = [];
  return {
    calls,
    getQueueModes: vi.fn(async (agentId: string) => {
      calls.push(["getQueueModes", agentId]);
      return { steeringMode: "all", followUpMode: "one-at-a-time" };
    }),
    setSteeringMode: vi.fn(async (agentId: string, mode: string) => {
      calls.push(["setSteeringMode", agentId, mode]);
      return null;
    }),
    setFollowUpMode: vi.fn(async (agentId: string, mode: string) => {
      calls.push(["setFollowUpMode", agentId, mode]);
      return null;
    }),
    on: vi.fn((type: string, handler: (message: unknown) => void) => {
      calls.push(["on", type]);
      handler({ type: "pi_retry", phase: "retrying", attempt: 1, maxAttempts: 3 });
      return () => {
        calls.push(["unsubscribe"]);
      };
    }),
    transcribeVoiceClip: vi.fn(
      async (input: { audioBase64: string; format: string; language?: string }) => {
        calls.push(["transcribeVoiceClip", input.audioBase64, input.format, input.language]);
        return { text: "hello from groq", error: null };
      },
    ),
    listCommands: vi.fn(async (agentId: string) => {
      calls.push(["listCommands", agentId]);
      return {
        agentId,
        commands: [{ name: "help", description: "Show help", argumentHint: "" }],
        error: null,
        requestId: "req_t292",
      };
    }),
    requestAttachmentDownloadToken: vi.fn(async (agentId: string, path: string) => {
      calls.push(["requestAttachmentDownloadToken", agentId, path]);
      return { token: "tok_1", mimeType: "image/png", error: null };
    }),
    respondToEditorText: vi.fn(async (agentId: string, requestId: string, text: string) => {
      calls.push(["respondToEditorText", agentId, requestId, text]);
    }),
  };
}

function connectionWithClient(client: unknown): SessionRouteConnectionSource {
  return {
    getActiveLifecycle: () => ({ getDaemonClient: () => client }),
  };
}

describe("resolveQueueModeClient", () => {
  it("returns the exact live client reference unchanged — never a wrapper or a clone", () => {
    const fakeClient = createCountingFakeDaemonClient();
    const resolved = resolveQueueModeClient(connectionWithClient(fakeClient));
    expect(resolved).toBe(fakeClient as unknown as typeof resolved);
  });

  it("a value passed to getQueueModes on the resolved client reaches the real counting fake", async () => {
    const fakeClient = createCountingFakeDaemonClient();
    const resolved = resolveQueueModeClient(connectionWithClient(fakeClient));

    await resolved!.getQueueModes!("agt_t132_queue_modes");

    expect(fakeClient.getQueueModes).toHaveBeenCalledTimes(1);
    expect(fakeClient.calls).toEqual([["getQueueModes", "agt_t132_queue_modes"]]);
  });

  it("setSteeringMode/setFollowUpMode calls on the resolved client both reach the fake, with the exact agentId/mode given", async () => {
    const fakeClient = createCountingFakeDaemonClient();
    const resolved = resolveQueueModeClient(connectionWithClient(fakeClient));

    await resolved!.setSteeringMode!("agt_t132_queue_modes", "all");
    await resolved!.setFollowUpMode!("agt_t132_queue_modes", "one-at-a-time");

    expect(fakeClient.calls).toEqual([
      ["setSteeringMode", "agt_t132_queue_modes", "all"],
      ["setFollowUpMode", "agt_t132_queue_modes", "one-at-a-time"],
    ]);
  });

  it("returns undefined when there is no active lifecycle (disconnected) — never throws", () => {
    const connection: SessionRouteConnectionSource = { getActiveLifecycle: () => null };
    expect(resolveQueueModeClient(connection)).toBeUndefined();
  });

  it("returns undefined when the active lifecycle has no live client yet", () => {
    const connection: SessionRouteConnectionSource = {
      getActiveLifecycle: () => ({ getDaemonClient: () => null }),
    };
    expect(resolveQueueModeClient(connection)).toBeUndefined();
  });
});

describe("resolveTurnStatusClient", () => {
  it("returns the exact live client reference unchanged — never a wrapper or a clone", () => {
    const fakeClient = createCountingFakeDaemonClient();
    const resolved = resolveTurnStatusClient(connectionWithClient(fakeClient));
    expect(resolved).toBe(fakeClient as unknown as typeof resolved);
  });

  it("an on('agent_stream', handler) call on the resolved client reaches the real counting fake, and its handler receives a real pushed event", () => {
    const fakeClient = createCountingFakeDaemonClient();
    const resolved = resolveTurnStatusClient(connectionWithClient(fakeClient));
    const received: unknown[] = [];

    const unsubscribe = resolved!.on!("agent_stream", (message) => {
      received.push(message);
    });

    expect(fakeClient.on).toHaveBeenCalledTimes(1);
    expect(fakeClient.calls[0]).toEqual(["on", "agent_stream"]);
    expect(received).toEqual([{ type: "pi_retry", phase: "retrying", attempt: 1, maxAttempts: 3 }]);

    unsubscribe();
    expect(fakeClient.calls[1]).toEqual(["unsubscribe"]);
  });

  it("returns undefined when there is no active lifecycle (disconnected) — never throws", () => {
    const connection: SessionRouteConnectionSource = { getActiveLifecycle: () => undefined };
    expect(resolveTurnStatusClient(connection)).toBeUndefined();
  });
});

describe("resolveTranscribeClient", () => {
  it("returns the exact live client reference unchanged — never a wrapper or a clone", () => {
    const fakeClient = createCountingFakeDaemonClient();
    const resolved = resolveTranscribeClient(connectionWithClient(fakeClient));
    expect(resolved).toBe(fakeClient as unknown as typeof resolved);
  });

  it("a transcribeVoiceClip call on the resolved client reaches the real counting fake and its resolved value round-trips", async () => {
    const fakeClient = createCountingFakeDaemonClient();
    const resolved = resolveTranscribeClient(connectionWithClient(fakeClient));

    const result = await resolved!.transcribeVoiceClip!({
      audioBase64: "QUJD",
      format: "m4a",
      language: "en",
    });

    expect(fakeClient.transcribeVoiceClip).toHaveBeenCalledTimes(1);
    expect(fakeClient.calls).toEqual([["transcribeVoiceClip", "QUJD", "m4a", "en"]]);
    expect(result).toEqual({ text: "hello from groq", error: null });
  });

  it("returns undefined when there is no active lifecycle (disconnected) — never throws", () => {
    const connection: SessionRouteConnectionSource = { getActiveLifecycle: () => null };
    expect(resolveTranscribeClient(connection)).toBeUndefined();
  });

  it("returns undefined when the active lifecycle has no live client yet", () => {
    const connection: SessionRouteConnectionSource = {
      getActiveLifecycle: () => ({ getDaemonClient: () => null }),
    };
    expect(resolveTranscribeClient(connection)).toBeUndefined();
  });
});

describe("resolveAttachmentDownloadClient", () => {
  it("returns the exact live client reference unchanged — never a wrapper or a clone", () => {
    const fakeClient = createCountingFakeDaemonClient();
    const resolved = resolveAttachmentDownloadClient(connectionWithClient(fakeClient));
    expect(resolved).toBe(fakeClient as unknown as typeof resolved);
  });

  it("a requestAttachmentDownloadToken call on the resolved client reaches the real counting fake and its resolved value round-trips", async () => {
    const fakeClient = createCountingFakeDaemonClient();
    const resolved = resolveAttachmentDownloadClient(connectionWithClient(fakeClient));

    const result = await resolved!.requestAttachmentDownloadToken(
      "agt_t284_attachment",
      "/tmp/paseo-attachments-x/a.png",
    );

    expect(fakeClient.requestAttachmentDownloadToken).toHaveBeenCalledTimes(1);
    expect(fakeClient.calls).toEqual([
      ["requestAttachmentDownloadToken", "agt_t284_attachment", "/tmp/paseo-attachments-x/a.png"],
    ]);
    expect(result).toEqual({ token: "tok_1", mimeType: "image/png", error: null });
  });

  it("returns undefined when there is no active lifecycle (disconnected) — never throws", () => {
    const connection: SessionRouteConnectionSource = { getActiveLifecycle: () => null };
    expect(resolveAttachmentDownloadClient(connection)).toBeUndefined();
  });

  it("returns undefined when the active lifecycle has no live client yet", () => {
    const connection: SessionRouteConnectionSource = {
      getActiveLifecycle: () => ({ getDaemonClient: () => null }),
    };
    expect(resolveAttachmentDownloadClient(connection)).toBeUndefined();
  });
});

describe("resolveQueueModeClient and resolveTurnStatusClient read the SAME underlying client", () => {
  it("both resolve functions, given the same connection, return the identical object reference — one live client serves both features, never two", () => {
    const fakeClient = createCountingFakeDaemonClient();
    const connection = connectionWithClient(fakeClient);
    const queueModeClient = resolveQueueModeClient(connection);
    const turnStatusClient = resolveTurnStatusClient(connection);
    expect(queueModeClient).toBe(turnStatusClient as unknown as typeof queueModeClient);
  });
});

describe("resolveSlashCommandsClient", () => {
  it("returns the exact live client reference unchanged — never a wrapper or a clone", () => {
    const fakeClient = createCountingFakeDaemonClient();
    const resolved = resolveSlashCommandsClient(connectionWithClient(fakeClient));
    expect(resolved).toBe(fakeClient as unknown as typeof resolved);
  });

  it("a listCommands call on the resolved client reaches the real counting fake and its resolved value round-trips", async () => {
    const fakeClient = createCountingFakeDaemonClient();
    const resolved = resolveSlashCommandsClient(connectionWithClient(fakeClient));

    const result = await resolved!.listCommands!("agt_t292_slash_commands");

    expect(fakeClient.listCommands).toHaveBeenCalledTimes(1);
    expect(fakeClient.calls).toEqual([["listCommands", "agt_t292_slash_commands"]]);
    expect(result.commands).toEqual([{ name: "help", description: "Show help", argumentHint: "" }]);
    expect(result.error).toBeNull();
  });

  it("returns undefined when there is no active lifecycle (disconnected) — never throws", () => {
    const connection: SessionRouteConnectionSource = { getActiveLifecycle: () => null };
    expect(resolveSlashCommandsClient(connection)).toBeUndefined();
  });

  it("returns undefined when the active lifecycle has no live client yet", () => {
    const connection: SessionRouteConnectionSource = {
      getActiveLifecycle: () => ({ getDaemonClient: () => null }),
    };
    expect(resolveSlashCommandsClient(connection)).toBeUndefined();
  });
});

describe("resolveEditorTextClient (T293)", () => {
  it("returns the exact live client reference unchanged — never a wrapper or a clone", () => {
    const fakeClient = createCountingFakeDaemonClient();
    const resolved = resolveEditorTextClient(connectionWithClient(fakeClient));
    expect(resolved).toBe(fakeClient as unknown as typeof resolved);
  });

  it("respondToEditorText and on(...) calls on the resolved client reach the real counting fake", () => {
    const fakeClient = createCountingFakeDaemonClient();
    const resolved = resolveEditorTextClient(connectionWithClient(fakeClient));

    const unsubscribe = resolved!.on("agent_editor_text_request", () => {});
    void resolved!.respondToEditorText("agt_t293", "req-1", "the current draft");

    expect(fakeClient.on).toHaveBeenCalledWith("agent_editor_text_request", expect.any(Function));
    expect(fakeClient.respondToEditorText).toHaveBeenCalledWith(
      "agt_t293",
      "req-1",
      "the current draft",
    );
    unsubscribe();
  });

  it("returns undefined when there is no active lifecycle (disconnected) — never throws", () => {
    const connection: SessionRouteConnectionSource = { getActiveLifecycle: () => null };
    expect(resolveEditorTextClient(connection)).toBeUndefined();
  });

  it("returns undefined when the active lifecycle has no live client yet", () => {
    const connection: SessionRouteConnectionSource = {
      getActiveLifecycle: () => ({ getDaemonClient: () => null }),
    };
    expect(resolveEditorTextClient(connection)).toBeUndefined();
  });
});

describe("resolveTranscribeClient and resolveQueueModeClient read the SAME underlying client", () => {
  it("both resolve functions, given the same connection, return the identical object reference — the mic's transcription client is the same live DaemonClient every other Composer daemon prop reads, never a second connection", () => {
    const fakeClient = createCountingFakeDaemonClient();
    const connection = connectionWithClient(fakeClient);
    const transcribeClient = resolveTranscribeClient(connection);
    const queueModeClient = resolveQueueModeClient(connection);
    expect(transcribeClient).toBe(queueModeClient as unknown as typeof transcribeClient);
  });
});
