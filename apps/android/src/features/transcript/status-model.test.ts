import { describe, expect, it } from "vitest";

import {
  TRANSCRIPT_STATUSES,
  buildTranscriptStatusViewModel,
  deriveTranscriptStatus,
} from "./status-model";

/**
 * T33A1 status-strip logic coverage. `status-strip.tsx`/`header.tsx`
 * import `react-native` (via `../../ui/primitives`) and so can't be
 * rendered under this workspace's plain `vitest` setup — see
 * `../extensions/renderers/log-model.ts`'s doc comment — so this proves
 * the acceptance criterion ("given connected, reconnecting, streaming,
 * error it must produce distinct, human strings") directly against the
 * pure model both components render from.
 */
describe("buildTranscriptStatusViewModel", () => {
  it("gives connected/reconnecting/streaming/error each a distinct, non-empty statusText and announcement", () => {
    const focus = ["connected", "reconnecting", "streaming", "error"] as const;
    const models = focus.map((status) => buildTranscriptStatusViewModel(status));

    for (const model of models) {
      expect(model.statusText.length).toBeGreaterThan(0);
      expect(model.accessibilityAnnouncement.length).toBeGreaterThan(0);
    }
    expect(new Set(models.map((model) => model.statusText)).size).toBe(focus.length);
    expect(new Set(models.map((model) => model.accessibilityAnnouncement)).size).toBe(focus.length);
  });

  it("gives every declared status a distinct statusText — no two states read the same to TalkBack", () => {
    const models = TRANSCRIPT_STATUSES.map((status) => buildTranscriptStatusViewModel(status));
    expect(new Set(models.map((model) => model.statusText)).size).toBe(TRANSCRIPT_STATUSES.length);
  });

  it("maps tone by severity: error -> danger, reconnecting -> warning, connected -> success", () => {
    expect(buildTranscriptStatusViewModel("error").tone).toBe("danger");
    expect(buildTranscriptStatusViewModel("reconnecting").tone).toBe("warning");
    expect(buildTranscriptStatusViewModel("connected").tone).toBe("success");
  });

  it("folds an optional detail into statusText without discarding the base word", () => {
    const withDetail = buildTranscriptStatusViewModel("error", "request timed out");
    const withoutDetail = buildTranscriptStatusViewModel("error");
    expect(withDetail.statusText).toContain("request timed out");
    expect(withDetail.statusText).not.toBe(withoutDetail.statusText);
    expect(withDetail.statusText.startsWith(withoutDetail.statusText)).toBe(true);
  });

  it("ignores a blank/whitespace-only detail", () => {
    expect(buildTranscriptStatusViewModel("connected", "   ").statusText).toBe(
      buildTranscriptStatusViewModel("connected").statusText,
    );
  });

  it("always announces as '<label>: <statusText>'", () => {
    const model = buildTranscriptStatusViewModel("streaming");
    expect(model.accessibilityAnnouncement).toBe(`${model.label}: ${model.statusText}`);
  });
});

describe("deriveTranscriptStatus", () => {
  it("prioritises an agent error over an otherwise-healthy connection", () => {
    expect(deriveTranscriptStatus({ connection: "connected", agentActivity: "error" })).toBe(
      "error",
    );
  });

  it("treats a lost/disposed connection as disconnected even mid-error-free activity", () => {
    expect(deriveTranscriptStatus({ connection: "disconnected" })).toBe("disconnected");
    expect(deriveTranscriptStatus({ connection: "disposed" })).toBe("disconnected");
  });

  it("treats a first connect attempt as connecting, and a later attempt as reconnecting", () => {
    expect(deriveTranscriptStatus({ connection: "connecting", reconnectAttempt: 1 })).toBe(
      "connecting",
    );
    expect(deriveTranscriptStatus({ connection: "connecting" })).toBe("connecting");
    expect(deriveTranscriptStatus({ connection: "connecting", reconnectAttempt: 2 })).toBe(
      "reconnecting",
    );
  });

  it("surfaces streaming only once the connection is actually up", () => {
    expect(deriveTranscriptStatus({ connection: "connected", agentActivity: "streaming" })).toBe(
      "streaming",
    );
    expect(deriveTranscriptStatus({ connection: "connecting", agentActivity: "streaming" })).toBe(
      "connecting",
    );
  });

  it("defaults to plain connected once online with no active error or streaming", () => {
    expect(deriveTranscriptStatus({ connection: "connected" })).toBe("connected");
    expect(deriveTranscriptStatus({ connection: "connected", agentActivity: "idle" })).toBe(
      "connected",
    );
  });
});
