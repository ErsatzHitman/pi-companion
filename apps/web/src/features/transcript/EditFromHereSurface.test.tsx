import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Clock, TimerHandle, timeline } from "@picompanion/frontend-core";

import { EditFromHereSurface } from "./EditFromHereSurface.js";
import type { EditFromHereForkClient } from "./use-edit-from-here.js";

afterEach(cleanup);

class FakeClock implements Clock {
  constructor(private currentMs = 1_000) {}
  now(): number {
    return this.currentMs;
  }
  setTimeout(): TimerHandle {
    throw new Error("not implemented");
  }
  clearTimeout(): void {}
  setInterval(): TimerHandle {
    throw new Error("not implemented");
  }
  clearInterval(): void {}
}

function row(
  overrides: Record<string, unknown> & { kind: string; id: string },
): timeline.TranscriptEntry {
  return {
    epoch: "epoch-1",
    seqStart: 1,
    seqEnd: 1,
    timestamp: "2026-01-01T00:00:00.000Z",
    provider: "pi",
    pending: false,
    stale: false,
    ...overrides,
  } as timeline.TranscriptEntry;
}

const ENTRIES: timeline.TranscriptEntry[] = [
  row({ kind: "user-message", id: "u1", text: "please add a login form" }),
  row({ kind: "assistant-message", id: "a1", text: "here's a login form", corrected: false }),
  row({ kind: "user-message", id: "u2", text: "actually, use TypeScript instead" }),
];

/**
 * Full production wiring, end to end: a click on the transcript's real
 * "Edit from here" button reaches `useEditFromHere`, which calls the
 * injected fork client, builds a real frontend-core fork node, and
 * surfaces it as a confirmation banner whose "Open branch" action hands
 * the caller the arrived value — never a router or a live `DaemonClient`,
 * matching this component's own "router- and daemon-agnostic" doc
 * comment. `routes/screens/host-session-screen.tsx` is what supplies a
 * real adapter and a real `navigate()` in production; this proves the
 * reusable half those depend on.
 */
describe("EditFromHereSurface (T105)", () => {
  it("clicking Edit from here on an eligible message forks through the client and shows the arrived fork", async () => {
    const user = userEvent.setup();
    const forkAgent = vi.fn<EditFromHereForkClient["forkAgent"]>(async () => ({
      agentId: "edit-branch-1",
    }));
    const onOpenSession = vi.fn();

    render(
      <EditFromHereSurface
        sessionId="source-session"
        entries={ENTRIES}
        clock={new FakeClock(5_000)}
        client={{ forkAgent }}
        onOpenSession={onOpenSession}
        testId="surface"
      />,
    );

    expect(screen.queryByTestId("surface-edit-from-here-banner")).toBeNull();

    await user.click(screen.getByTestId("transcript-row-u2-edit-from-here"));

    expect(forkAgent).toHaveBeenCalledWith("source-session", { entryId: "a1", entryIndex: 1 });

    const banner = await screen.findByTestId("surface-edit-from-here-banner");
    expect(banner.textContent).toContain("actually, use TypeScript instead");

    await user.click(screen.getByRole("button", { name: "Open branch" }));

    expect(onOpenSession).toHaveBeenCalledTimes(1);
    const outcome = onOpenSession.mock.calls[0]?.[0];
    expect(outcome.newSessionId).toBe("edit-branch-1");
    expect(outcome.sourceSessionId).toBe("source-session");
    expect(outcome.node.kind).toBe("fork");
    expect(outcome.draftText).toBe("actually, use TypeScript instead");
  });

  /**
   * T114 — settles the gating decision `host-session-screen.tsx`'s
   * adapter doc left open: with no fork-capable `client` wired (every
   * production render today, per that file's own record), the button is
   * disabled rather than shipped enabled with a guaranteed-failure
   * outcome. Disabled, not hidden — the same "reasoned rejection"
   * treatment `message-row.tsx` already gives an invalid fork target, so
   * a reader still sees the affordance exists.
   */
  it("disables (never hides) Edit from here on every message when no client is wired, instead of shipping a button that can only fail", () => {
    render(
      <EditFromHereSurface
        sessionId="source-session"
        entries={ENTRIES}
        clock={new FakeClock()}
        client={undefined}
        testId="surface"
      />,
    );

    const button = screen.getByTestId("transcript-row-u2-edit-from-here");
    expect(button.hasAttribute("disabled")).toBe(true);
    expect(screen.queryByTestId("surface-edit-from-here-error")).toBeNull();
    expect(screen.queryByTestId("surface-edit-from-here-banner")).toBeNull();
  });

  /**
   * `useEditFromHere`'s "not connected" message itself stays covered at
   * the hook level (`use-edit-from-here.test.ts`'s "reports 'not
   * connected' ... when no client is wired yet") as defense in depth —
   * this surface's own button simply never reaches it once gated.
   */
});
