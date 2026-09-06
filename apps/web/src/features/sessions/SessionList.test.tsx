import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SessionList } from "./SessionList.js";
import type { SessionListState, SessionSummary } from "./types.js";

afterEach(cleanup);

const SESSIONS: SessionSummary[] = [
  {
    id: "s-attention",
    title: "Fix flaky test",
    provider: "claude",
    cwd: "/repo/a",
    status: "error",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "s-active",
    title: "Refactor router",
    provider: "codex",
    cwd: "/repo/b",
    status: "running",
    updatedAt: "2026-01-02T00:00:00.000Z",
  },
  {
    id: "s-idle",
    title: null,
    provider: "claude",
    cwd: "/repo/c",
    status: "idle",
    updatedAt: "2026-01-03T00:00:00.000Z",
  },
];

describe("SessionList", () => {
  it("renders a loading state from the shared placeholder primitive", () => {
    render(<SessionList state={{ kind: "loading" }} />);
    expect(screen.getByTestId("session-list-loading")).toBeTruthy();
    expect(screen.getByRole("status")).toBeTruthy();
  });

  it("renders an error state from the shared placeholder primitive", () => {
    const state: SessionListState = { kind: "error", message: "The host did not respond." };
    render(<SessionList state={state} />);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("The host did not respond.");
    expect(screen.getByTestId("session-list-error")).toBeTruthy();
  });

  it("renders an empty state from the shared placeholder primitive when ready with no sessions", () => {
    render(<SessionList state={{ kind: "ready", sessions: [] }} />);
    expect(screen.getByTestId("session-list-empty")).toBeTruthy();
  });

  it("renders sessions grouped by status with the group label and per-row status text visible", () => {
    render(<SessionList state={{ kind: "ready", sessions: SESSIONS }} />);

    expect(screen.getByRole("heading", { name: "Needs attention" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Active" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Idle" })).toBeTruthy();

    const attentionRow = screen.getByTestId("session-row-s-attention");
    expect(attentionRow.textContent).toContain("Error");

    const activeRow = screen.getByTestId("session-row-s-active");
    expect(activeRow.textContent).toContain("Running");

    const idleRow = screen.getByTestId("session-row-s-idle");
    expect(idleRow.textContent).toContain("Idle");
    expect(idleRow.textContent).toContain("Untitled session");
  });

  it("appends a needs-attention suffix to the status text for requiresAttention sessions", () => {
    const attentionSession: SessionSummary = {
      id: "s-permission",
      title: "Waiting on permission",
      provider: "claude",
      cwd: "/repo/d",
      status: "idle",
      requiresAttention: true,
      updatedAt: "2026-01-04T00:00:00.000Z",
    };
    render(<SessionList state={{ kind: "ready", sessions: [attentionSession] }} />);
    expect(screen.getByTestId("session-row-s-permission").textContent).toContain(
      "Idle · needs attention",
    );
  });

  it("does not render a group heading for a status with no sessions", () => {
    render(
      <SessionList
        state={{
          kind: "ready",
          sessions: [SESSIONS[1]!],
        }}
      />,
    );
    expect(screen.queryByRole("heading", { name: "Needs attention" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Idle" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Archived" })).toBeNull();
  });

  it("marks the selected session's row with aria-current", () => {
    render(
      <SessionList state={{ kind: "ready", sessions: SESSIONS }} selectedSessionId="s-active" />,
    );
    expect(screen.getByTestId("session-row-s-active").getAttribute("aria-current")).toBe("true");
    expect(screen.getByTestId("session-row-s-idle").getAttribute("aria-current")).toBeNull();
  });

  it("rows are keyboard reachable and activate onSelectSession", async () => {
    const user = userEvent.setup();
    const onSelectSession = vi.fn();
    render(
      <SessionList
        state={{ kind: "ready", sessions: SESSIONS }}
        onSelectSession={onSelectSession}
      />,
    );

    await user.tab();
    expect(screen.getByTestId("session-row-s-attention")).toBe(document.activeElement);

    await user.keyboard("{Enter}");
    expect(onSelectSession).toHaveBeenCalledWith("s-attention");

    await user.tab();
    expect(screen.getByTestId("session-row-s-active")).toBe(document.activeElement);
    await user.keyboard(" ");
    expect(onSelectSession).toHaveBeenCalledWith("s-active");
  });

  it("shows an Archive action for a live session and hides it for an already-archived one", async () => {
    const user = userEvent.setup();
    const archivedSession: SessionSummary = {
      ...SESSIONS[1]!,
      id: "s-archived",
      archivedAt: "2026-01-05T00:00:00.000Z",
    };
    const onArchiveSession = vi.fn();
    render(
      <SessionList
        state={{ kind: "ready", sessions: [SESSIONS[1]!, archivedSession] }}
        onArchiveSession={onArchiveSession}
        onRequestDeleteSession={vi.fn()}
      />,
    );

    await user.click(screen.getByTestId(`session-row-actions-trigger-${SESSIONS[1]!.id}`));
    const archiveButton = screen.getByTestId(`session-row-archive-${SESSIONS[1]!.id}`);
    await user.click(archiveButton);
    expect(onArchiveSession).toHaveBeenCalledWith(SESSIONS[1]);

    await user.click(screen.getByTestId(`session-row-actions-trigger-${archivedSession.id}`));
    expect(screen.queryByTestId(`session-row-archive-${archivedSession.id}`)).toBeNull();
  });

  it("shows a Delete action and reports the archiving state on the archiving row", async () => {
    const user = userEvent.setup();
    const onRequestDeleteSession = vi.fn();
    render(
      <SessionList
        state={{ kind: "ready", sessions: [SESSIONS[1]!] }}
        onArchiveSession={vi.fn()}
        onRequestDeleteSession={onRequestDeleteSession}
        archivingSessionId={SESSIONS[1]!.id}
      />,
    );

    await user.click(screen.getByTestId(`session-row-actions-trigger-${SESSIONS[1]!.id}`));
    const archiveButton = screen.getByTestId(
      `session-row-archive-${SESSIONS[1]!.id}`,
    ) as HTMLButtonElement;
    expect(archiveButton.disabled).toBe(true);
    expect(archiveButton.textContent).toMatch(/archiving/i);

    const deleteButton = screen.getByTestId(`session-row-delete-${SESSIONS[1]!.id}`);
    await user.click(deleteButton);
    expect(onRequestDeleteSession).toHaveBeenCalledWith(SESSIONS[1]);
  });

  it("shows Fork and Clone actions and reports the forking/cloning states on their rows (T38A3)", async () => {
    const user = userEvent.setup();
    const onForkSession = vi.fn();
    const onCloneSession = vi.fn();
    render(
      <SessionList
        state={{ kind: "ready", sessions: [SESSIONS[1]!] }}
        onForkSession={onForkSession}
        onCloneSession={onCloneSession}
        forkingSessionId={SESSIONS[1]!.id}
      />,
    );

    await user.click(screen.getByTestId(`session-row-actions-trigger-${SESSIONS[1]!.id}`));

    const forkButton = screen.getByTestId(
      `session-row-fork-${SESSIONS[1]!.id}`,
    ) as HTMLButtonElement;
    expect(forkButton.disabled).toBe(true);
    expect(forkButton.textContent).toMatch(/forking/i);

    const cloneButton = screen.getByTestId(`session-row-clone-${SESSIONS[1]!.id}`);
    await user.click(cloneButton);
    expect(onCloneSession).toHaveBeenCalledWith(SESSIONS[1]);
    expect(onForkSession).not.toHaveBeenCalled();
  });

  it("hides Fork and Clone actions when neither callback is given", () => {
    render(<SessionList state={{ kind: "ready", sessions: [SESSIONS[1]!] }} />);
    expect(screen.queryByTestId(`session-row-fork-${SESSIONS[1]!.id}`)).toBeNull();
    expect(screen.queryByTestId(`session-row-clone-${SESSIONS[1]!.id}`)).toBeNull();
  });

  it("renders no row actions when neither onArchiveSession nor onRequestDeleteSession is given", () => {
    render(<SessionList state={{ kind: "ready", sessions: [SESSIONS[1]!] }} />);
    expect(screen.queryByTestId(`session-row-actions-trigger-${SESSIONS[1]!.id}`)).toBeNull();
  });

  it("shows a stale banner rather than silently presenting a stale list as current (T27B6)", () => {
    render(<SessionList state={{ kind: "ready", sessions: SESSIONS, stale: true }} />);
    const banner = screen.getByTestId("session-list-stale-banner");
    expect(banner.textContent).toMatch(/reconnecting/i);
    expect(banner.getAttribute("role")).toBe("status");
    // The rows themselves stay fully rendered and interactive underneath.
    expect(screen.getByTestId("session-row-s-active")).toBeTruthy();
  });

  it("renders no stale banner once the list is confirmed current", () => {
    render(<SessionList state={{ kind: "ready", sessions: SESSIONS, stale: false }} />);
    expect(screen.queryByTestId("session-list-stale-banner")).toBeNull();
  });

  it("has no axe violations across loading, error, empty, and populated states", async () => {
    const states: SessionListState[] = [
      { kind: "loading" },
      { kind: "error", message: "The host did not respond." },
      { kind: "ready", sessions: [] },
      { kind: "ready", sessions: SESSIONS },
      { kind: "ready", sessions: SESSIONS, stale: true },
    ];

    for (const state of states) {
      const { container, unmount } = render(<SessionList state={state} />);
      expect(await axe(container)).toHaveNoViolations();
      unmount();
    }
  }, 20_000);

  it("has no axe violations with row actions rendered and open (T27B4)", async () => {
    const { container } = render(
      <SessionList
        state={{ kind: "ready", sessions: [SESSIONS[1]!] }}
        onArchiveSession={vi.fn()}
        onRequestDeleteSession={vi.fn()}
      />,
    );
    expect(await axe(container)).toHaveNoViolations();

    const user = userEvent.setup();
    await user.click(screen.getByTestId(`session-row-actions-trigger-${SESSIONS[1]!.id}`));
    expect(await axe(container)).toHaveNoViolations();
  }, 20_000);
});
