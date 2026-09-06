import { describe, expect, it } from "vitest";

import { buildGenericToolCallViewModel } from "./fallback.js";

describe("buildGenericToolCallViewModel", () => {
  it("never throws, even when detail.input carries a circular reference", () => {
    const circular: Record<string, unknown> = { a: 1 };
    circular.self = circular;
    const raw = {
      name: "circular_tool",
      callId: "c1",
      status: "running",
      detail: { type: "unknown", input: circular, output: null },
    };
    expect(() =>
      buildGenericToolCallViewModel(raw, { reason: "test: circular input" }),
    ).not.toThrow();
    const view = buildGenericToolCallViewModel(raw, { reason: "test: circular input" });
    expect(view.family).toBe("generic");
    expect(view.callId).toBe("c1");
    expect(view.collapsibleInput).toBe("[unserializable value]");
    expect(() => JSON.parse(view.copyPayload)).not.toThrow();
  });

  it("extracts a namespace as `source` for a namespaced tool name", () => {
    const view = buildGenericToolCallViewModel(
      {
        name: "acme_server.custom_tool",
        callId: "c2",
        status: "completed",
        detail: { type: "unknown" },
      },
      { reason: "test: namespaced tool" },
    );
    expect(view.source).toBeDefined();
  });

  it("defaults to a stable placeholder callId/toolName for totally empty input", () => {
    const a = buildGenericToolCallViewModel({}, { reason: "empty" });
    const b = buildGenericToolCallViewModel(null, { reason: "null" });
    expect(a.callId).toBe("unknown-call");
    expect(b.callId).toBe("unknown-call");
    expect(a.toolName).toBe("unknown_tool");
  });

  it("produces a JSON-parseable copyPayload", () => {
    const view = buildGenericToolCallViewModel(
      {
        name: "x",
        callId: "c3",
        status: "completed",
        detail: { type: "unknown", input: { a: 1 }, output: { b: 2 } },
      },
      { reason: "test" },
    );
    expect(() => JSON.parse(view.copyPayload)).not.toThrow();
  });

  it("marks blocked status when requested", () => {
    const view = buildGenericToolCallViewModel(
      { name: "x", callId: "c4", status: "running" },
      { reason: "test", blockedByPermissionRequestId: "perm-1" },
    );
    expect(view.status).toBe("blocked");
    expect(view.blockedByPermissionRequestId).toBe("perm-1");
  });
});
