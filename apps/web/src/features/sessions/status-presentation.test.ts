import { describe, expect, it } from "vitest";

import { statusPresentation } from "./status-presentation.js";
import type { SessionSummary } from "./types.js";

/**
 * Pins `status-presentation.ts`'s `STATUS_TONE` mapping for a `running`
 * session: the design reference's `.pill-run`
 * (`background: var(--accent-tint); color: var(--accent-ink)`) is this
 * app's `status.info` accent pair, not `status.success`'s green
 * settled-state pair (`.pill-ok`) — see that file's own `STATUS_TONE`
 * comment. Asserted by name (`=== "info"` and `!== "success"`) so a
 * revert back to `"success"` fails this test by name, not by a vague
 * shape check.
 */
function session(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: "agent-1",
    title: "Refactor router",
    provider: "pi",
    cwd: "/repo/existing",
    status: "running",
    updatedAt: "2026-01-02T00:00:00.000Z",
    ...overrides,
  };
}

describe("statusPresentation", () => {
  it("maps a running session to the info tone, not success", () => {
    const { tone } = statusPresentation(session({ status: "running" }));
    expect(tone).toBe("info");
    expect(tone).not.toBe("success");
  });

  it("still shows the visible Running label alongside the info tone", () => {
    const { text } = statusPresentation(session({ status: "running" }));
    expect(text).toBe("Running");
  });

  it("overrides the tone to warning, and the text to include the attention suffix, when requiresAttention is set on a running session", () => {
    const { tone, text } = statusPresentation(
      session({ status: "running", requiresAttention: true }),
    );
    expect(tone).toBe("warning");
    expect(text).toBe("Running · needs attention");
  });
});
