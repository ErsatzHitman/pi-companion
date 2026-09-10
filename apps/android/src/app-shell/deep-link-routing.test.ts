import { describe, expect, it } from "vitest";

import { matchDeepLinkPath } from "./deep-link-routing";

/**
 * `matchDeepLinkPath` coverage — T32S2 (piece 1 of its "deep link opens
 * the right destination" / "invalid link lands on an explained fallback"
 * acceptance criteria). Plain unit tests: this module imports nothing
 * from `react-native`/`expo-router`, so — unlike most of this app's
 * route-level coverage — these are genuine behavioral assertions against
 * the real function, not source-text contract tests.
 *
 * Deep link and cold-start behavior on a real device/emulator is out of
 * scope here (no emulator in this workspace) — that is T37/T59's to
 * prove. This file proves the pure path -> destination mapping those
 * later on-device flows would exercise.
 */
describe("matchDeepLinkPath", () => {
  it("matches /connect", () => {
    expect(matchDeepLinkPath("/connect")).toEqual({ kind: "connect" });
  });

  it("matches /h/:serverId/sessions", () => {
    expect(matchDeepLinkPath("/h/abc123/sessions")).toEqual({
      kind: "sessionList",
      serverId: "abc123",
    });
  });

  it("matches /h/:serverId/settings", () => {
    expect(matchDeepLinkPath("/h/abc123/settings")).toEqual({
      kind: "settings",
      serverId: "abc123",
    });
  });

  it("matches /h/:serverId/session/:agentId", () => {
    expect(matchDeepLinkPath("/h/abc123/session/agent-9")).toEqual({
      kind: "session",
      serverId: "abc123",
      agentId: "agent-9",
    });
  });

  it("matches /h/:serverId/session/:agentId/live", () => {
    expect(matchDeepLinkPath("/h/abc123/session/agent-9/live")).toEqual({
      kind: "sessionLive",
      serverId: "abc123",
      agentId: "agent-9",
    });
  });

  it("does not match a deeper path under live, which registers no route of its own", () => {
    expect(matchDeepLinkPath("/h/abc123/session/agent-9/live/extra")).toEqual({
      kind: "not-found",
      path: "/h/abc123/session/agent-9/live/extra",
    });
  });

  it("matches /h/:serverId/session/:agentId/files/... with an empty path", () => {
    expect(matchDeepLinkPath("/h/abc123/session/agent-9/files")).toEqual({
      kind: "sessionFiles",
      serverId: "abc123",
      agentId: "agent-9",
      path: [],
    });
  });

  it("matches /h/:serverId/session/:agentId/files/:path* with a nested path", () => {
    expect(matchDeepLinkPath("/h/abc123/session/agent-9/files/src/index.ts")).toEqual({
      kind: "sessionFiles",
      serverId: "abc123",
      agentId: "agent-9",
      path: ["src", "index.ts"],
    });
  });

  it("matches /h/:serverId/session/:agentId/terminal/:terminalId", () => {
    expect(matchDeepLinkPath("/h/abc123/session/agent-9/terminal/term-1")).toEqual({
      kind: "sessionTerminal",
      serverId: "abc123",
      agentId: "agent-9",
      terminalId: "term-1",
    });
  });

  it("decodes a URL-encoded serverId/agentId segment", () => {
    expect(matchDeepLinkPath("/h/my%20host/session/agent%2F1")).toEqual({
      kind: "session",
      serverId: "my host",
      agentId: "agent/1",
    });
  });

  it('falls back to not-found for a bare /h/:serverId (frontend-core\'s "host" intent has no matching route)', () => {
    expect(matchDeepLinkPath("/h/abc123")).toEqual({ kind: "not-found", path: "/h/abc123" });
  });

  it("falls back to not-found for an empty serverId (/h//sessions)", () => {
    expect(matchDeepLinkPath("/h//sessions")).toEqual({ kind: "not-found", path: "/h//sessions" });
  });

  it("falls back to not-found for an unrecognized tail under a session", () => {
    expect(matchDeepLinkPath("/h/abc123/session/agent-9/nonsense")).toEqual({
      kind: "not-found",
      path: "/h/abc123/session/agent-9/nonsense",
    });
  });

  it("falls back to not-found for a completely unrelated path", () => {
    expect(matchDeepLinkPath("/totally/unknown/path")).toEqual({
      kind: "not-found",
      path: "/totally/unknown/path",
    });
  });

  it("falls back to not-found for the bare root", () => {
    expect(matchDeepLinkPath("/")).toEqual({ kind: "not-found", path: "/" });
  });
});
