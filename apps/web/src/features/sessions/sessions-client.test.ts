import { describe, expect, it } from "vitest";

import {
  SESSIONS_ACTION_UNSUPPORTED,
  SESSIONS_NOT_CONNECTED,
  explainSessionsActionError,
  explainSessionsCreateError,
} from "./sessions-client.js";

describe("explainSessionsCreateError (T27B2)", () => {
  it("explains the not-connected sentinel", () => {
    const explanation = explainSessionsCreateError(SESSIONS_NOT_CONNECTED);
    expect(explanation.title).toBe("Not connected");
    expect(explanation.description).toMatch(/connect to a daemon/i);
  });

  it.each(["cwd is required", "createAgent requires provider and cwd", "provider is required"])(
    "explains a missing session details error: %s",
    (raw) => {
      const explanation = explainSessionsCreateError(raw);
      expect(explanation.title).toMatch(/missing session details/i);
    },
  );

  it.each([
    "ENOENT: no such file or directory, stat '/workspace/missing'",
    "no such file or directory",
  ])("explains a missing working directory: %s", (raw) => {
    const explanation = explainSessionsCreateError(raw);
    expect(explanation.title).toMatch(/doesn't exist/i);
  });

  it("falls back to a generic explanation that still shows the raw message", () => {
    const explanation = explainSessionsCreateError("something unexpected happened");
    expect(explanation.title).toMatch(/couldn't create this session/i);
    expect(explanation.description).toBe("something unexpected happened");
  });

  it("falls back to a generic message when the raw text is empty", () => {
    const explanation = explainSessionsCreateError("   ");
    expect(explanation.description).toMatch(/unknown error/i);
  });
});

describe("explainSessionsActionError (T27B4)", () => {
  it.each(["archive", "delete"] as const)(
    "explains the not-connected sentinel for %s",
    (action) => {
      const explanation = explainSessionsActionError(action, SESSIONS_NOT_CONNECTED);
      expect(explanation.title).toBe("Not connected");
      expect(explanation.description).toMatch(/connect to a daemon/i);
    },
  );

  it.each(["archive", "delete"] as const)("explains the unsupported sentinel for %s", (action) => {
    const explanation = explainSessionsActionError(action, SESSIONS_ACTION_UNSUPPORTED);
    expect(explanation.title).toBe("Not supported");
  });

  it.each(["archive", "delete"] as const)("explains a not-found error for %s", (action) => {
    const explanation = explainSessionsActionError(action, "Agent not found: agt_missing");
    expect(explanation.title).toMatch(/not found/i);
  });

  it("falls back to a generic archive explanation that still shows the raw message", () => {
    const explanation = explainSessionsActionError("archive", "something unexpected happened");
    expect(explanation.title).toMatch(/couldn't archive this session/i);
    expect(explanation.description).toBe("something unexpected happened");
  });

  it("falls back to a generic delete explanation that still shows the raw message", () => {
    const explanation = explainSessionsActionError("delete", "something unexpected happened");
    expect(explanation.title).toMatch(/couldn't delete this session/i);
    expect(explanation.description).toBe("something unexpected happened");
  });

  it("falls back to a generic message when the raw text is empty", () => {
    const explanation = explainSessionsActionError("delete", "   ");
    expect(explanation.description).toMatch(/unknown error/i);
  });
});
