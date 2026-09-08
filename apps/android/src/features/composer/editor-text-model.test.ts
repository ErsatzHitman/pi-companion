import { describe, expect, it, vi } from "vitest";

import type { DaemonEditorTextRequestMessage, DaemonEditorTextSource } from "./editor-text-model";
import { wireEditorTextResponder } from "./editor-text-model";

/** Minimal fake satisfying `DaemonEditorTextSource`, driven by the test. */
class FakeDaemonEditorTextSource implements DaemonEditorTextSource {
  readonly respondToEditorText = vi.fn(
    async (_agentId: string, _requestId: string, _text: string): Promise<void> => undefined,
  );
  private readonly requestHandlers = new Set<(message: DaemonEditorTextRequestMessage) => void>();

  on(
    type: "agent_editor_text_request",
    handler: (message: DaemonEditorTextRequestMessage) => void,
  ): () => void {
    expect(type).toBe("agent_editor_text_request");
    this.requestHandlers.add(handler);
    return () => this.requestHandlers.delete(handler);
  }

  emitRequest(agentId: string, requestId: string): void {
    const message: DaemonEditorTextRequestMessage = {
      type: "agent_editor_text_request",
      payload: { agentId, requestId },
    };
    for (const handler of this.requestHandlers) handler(message);
  }
}

describe("wireEditorTextResponder (T293, android)", () => {
  it("answers a request for its own agentId with the current draft text", () => {
    const daemon = new FakeDaemonEditorTextSource();
    wireEditorTextResponder(daemon, { agentId: "agent-1", getDraftText: () => "hello world" });

    daemon.emitRequest("agent-1", "req-1");

    expect(daemon.respondToEditorText).toHaveBeenCalledWith("agent-1", "req-1", "hello world");
  });

  it("ignores a request for a different agentId", () => {
    const daemon = new FakeDaemonEditorTextSource();
    wireEditorTextResponder(daemon, { agentId: "agent-1", getDraftText: () => "mine" });

    daemon.emitRequest("agent-2", "req-other");

    expect(daemon.respondToEditorText).not.toHaveBeenCalled();
  });

  it("reads getDraftText() fresh on every request, not once at wire time", () => {
    const daemon = new FakeDaemonEditorTextSource();
    let draft = "first";
    wireEditorTextResponder(daemon, { agentId: "agent-1", getDraftText: () => draft });

    daemon.emitRequest("agent-1", "req-1");
    draft = "second";
    daemon.emitRequest("agent-1", "req-2");

    expect(daemon.respondToEditorText).toHaveBeenNthCalledWith(1, "agent-1", "req-1", "first");
    expect(daemon.respondToEditorText).toHaveBeenNthCalledWith(2, "agent-1", "req-2", "second");
  });

  it("stops answering once unsubscribed", () => {
    const daemon = new FakeDaemonEditorTextSource();
    const unsubscribe = wireEditorTextResponder(daemon, {
      agentId: "agent-1",
      getDraftText: () => "draft",
    });

    unsubscribe();
    daemon.emitRequest("agent-1", "req-1");

    expect(daemon.respondToEditorText).not.toHaveBeenCalled();
  });

  it("swallows a respondToEditorText rejection rather than throwing", async () => {
    const daemon = new FakeDaemonEditorTextSource();
    daemon.respondToEditorText.mockRejectedValueOnce(new Error("connection dropped"));
    wireEditorTextResponder(daemon, { agentId: "agent-1", getDraftText: () => "draft" });

    expect(() => daemon.emitRequest("agent-1", "req-1")).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
  });
});
