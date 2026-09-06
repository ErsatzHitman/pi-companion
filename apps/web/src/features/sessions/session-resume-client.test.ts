import { describe, expect, it } from "vitest";

import {
  SESSION_RESUME_NOT_CONNECTED,
  explainSessionResumeError,
} from "./session-resume-client.js";

describe("explainSessionResumeError (T27B3)", () => {
  it("explains the not-connected sentinel", () => {
    const explanation = explainSessionResumeError(SESSION_RESUME_NOT_CONNECTED);
    expect(explanation.title).toBe("Not connected");
    expect(explanation.description).toMatch(/connect to a daemon/i);
  });

  it.each(["Agent not found: agt_missing", "agent not found: agt_missing"])(
    "explains a missing-session error: %s",
    (raw) => {
      const explanation = explainSessionResumeError(raw);
      expect(explanation.title).toMatch(/doesn't exist/i);
      expect(explanation.description).toMatch(/deleted|no longer valid/i);
    },
  );

  it("falls back to a generic explanation that still shows the raw message", () => {
    const explanation = explainSessionResumeError("something unexpected happened");
    expect(explanation.title).toMatch(/couldn't resume this session/i);
    expect(explanation.description).toBe("something unexpected happened");
  });

  it("falls back to a generic message when the raw text is empty", () => {
    const explanation = explainSessionResumeError("   ");
    expect(explanation.description).toMatch(/unknown error/i);
  });
});
