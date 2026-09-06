import { describe, expect, it } from "vitest";

import type { ClassifiedShareContent } from "./share-intent-model";
import {
  IDLE_SHARE_CHOOSER_STATE,
  chooseSession,
  dismissChooser,
  presentShareForChoice,
} from "./share-session-chooser";

const TEXT_A: ClassifiedShareContent = {
  kind: "text",
  text: "first share",
  looksSecretShaped: false,
};
const TEXT_B: ClassifiedShareContent = {
  kind: "text",
  text: "second share",
  looksSecretShaped: false,
};

describe("presentShareForChoice", () => {
  it("opens the chooser when at least one session exists", () => {
    const { state, outcome } = presentShareForChoice(IDLE_SHARE_CHOOSER_STATE, TEXT_A, [
      "s1",
      "s2",
    ]);
    expect(outcome).toBe("opened");
    expect(state).toEqual({
      status: "choosing",
      content: TEXT_A,
      candidateSessionIds: ["s1", "s2"],
    });
  });

  it("reports 'no-sessions' when there is nothing to choose from, and does not open a chooser", () => {
    const { state, outcome } = presentShareForChoice(IDLE_SHARE_CHOOSER_STATE, TEXT_A, []);
    expect(outcome).toBe("no-sessions");
    expect(state).toEqual({ status: "no-sessions", content: TEXT_A });
  });

  it("queues a second share behind an already-open chooser instead of displacing it", () => {
    const opened = presentShareForChoice(IDLE_SHARE_CHOOSER_STATE, TEXT_A, ["s1"]).state;
    const { state, outcome } = presentShareForChoice(opened, TEXT_B, ["s1"]);
    expect(outcome).toBe("queued");
    // The chooser is still showing the FIRST share, not the second.
    expect(state).toMatchObject({ status: "choosing", content: TEXT_A, queuedNext: TEXT_B });
  });

  it("a third share while still open replaces the queued (not-yet-shown) one, reported distinctly", () => {
    const opened = presentShareForChoice(IDLE_SHARE_CHOOSER_STATE, TEXT_A, ["s1"]).state;
    const queued = presentShareForChoice(opened, TEXT_B, ["s1"]).state;
    const thirdContent: ClassifiedShareContent = {
      kind: "text",
      text: "third",
      looksSecretShaped: false,
    };
    const { state, outcome } = presentShareForChoice(queued, thirdContent, ["s1"]);
    expect(outcome).toBe("queued-replacing-pending");
    expect(state).toMatchObject({ status: "choosing", content: TEXT_A, queuedNext: thirdContent });
  });
});

describe("chooseSession", () => {
  it("resolves to the chosen session when it is still valid", () => {
    const opened = presentShareForChoice(IDLE_SHARE_CHOOSER_STATE, TEXT_A, ["s1", "s2"]).state;
    const result = chooseSession(opened, "s2", ["s1", "s2"]);
    expect(result).toEqual({
      state: { status: "resolved", content: TEXT_A, sessionId: "s2" },
      outcome: "resolved",
      nextPending: undefined,
    });
  });

  it("refuses (never resolves) a session that is no longer valid by the time the share resolves", () => {
    const opened = presentShareForChoice(IDLE_SHARE_CHOOSER_STATE, TEXT_A, ["s1", "s2"]).state;
    // s2 was a valid candidate when the chooser opened, but is gone by the time the user taps it.
    const result = chooseSession(opened, "s2", ["s1"]);
    expect(result).toEqual({
      state: { status: "invalid-session", content: TEXT_A, sessionId: "s2" },
      outcome: "invalid-session",
      nextPending: undefined,
    });
  });

  it("is a no-op when no chooser is open", () => {
    expect(chooseSession(IDLE_SHARE_CHOOSER_STATE, "s1", ["s1"])).toBeNull();
  });

  it("surfaces a queued share as nextPending on resolve, so the caller can present it next", () => {
    const opened = presentShareForChoice(IDLE_SHARE_CHOOSER_STATE, TEXT_A, ["s1"]).state;
    const queued = presentShareForChoice(opened, TEXT_B, ["s1"]).state;
    const result = chooseSession(queued, "s1", ["s1"]);
    expect(result?.nextPending).toBe(TEXT_B);
  });
});

describe("dismissChooser", () => {
  it("cancels an open chooser without resolving a session", () => {
    const opened = presentShareForChoice(IDLE_SHARE_CHOOSER_STATE, TEXT_A, ["s1"]).state;
    const result = dismissChooser(opened);
    expect(result).toEqual({
      state: { status: "cancelled", content: TEXT_A },
      nextPending: undefined,
    });
  });

  it("surfaces a queued share as nextPending on dismiss too", () => {
    const opened = presentShareForChoice(IDLE_SHARE_CHOOSER_STATE, TEXT_A, ["s1"]).state;
    const queued = presentShareForChoice(opened, TEXT_B, ["s1"]).state;
    const result = dismissChooser(queued);
    expect(result?.nextPending).toBe(TEXT_B);
  });

  it("is a no-op when no chooser is open", () => {
    expect(dismissChooser(IDLE_SHARE_CHOOSER_STATE)).toBeNull();
  });
});
