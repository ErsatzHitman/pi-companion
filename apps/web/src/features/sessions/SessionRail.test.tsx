import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SessionRail } from "./SessionRail.js";
import type { SessionListState, SessionSummary } from "./types.js";

afterEach(cleanup);

const NOW = Date.parse("2026-01-01T12:00:00.000Z");

const SESSIONS: SessionSummary[] = [
  {
    id: "s-running",
    title: "T380 — emulator claims",
    provider: "pi",
    cwd: "/repo/pi-companion",
    status: "running",
    updatedAt: "2026-01-01T12:00:00.000Z",
    model: "opus-5",
    thinkingOptionId: "xhigh",
    currentModeId: "build",
    availableModes: [{ id: "build", label: "Build" }],
    lastUsage: { contextWindowUsedTokens: 131_600 },
  },
  {
    id: "s-idle",
    title: "Docs sweep",
    provider: "pi",
    cwd: "/repo/other",
    status: "idle",
    updatedAt: "2026-01-01T11:00:00.000Z",
  },
];

const READY: SessionListState = { kind: "ready", sessions: SESSIONS };
const CONNECTED_DIRECT = { status: "connected", kind: "direct" } as const;

function renderRail(overrides: Partial<Parameters<typeof SessionRail>[0]> = {}) {
  return render(
    <SessionRail state={READY} connection={CONNECTED_DIRECT} now={NOW} {...overrides} />,
  );
}

describe("SessionRail", () => {
  it("renders the Workspace eyebrow and navigates New session through the supplied callback", async () => {
    const user = userEvent.setup();
    const onNewSession = vi.fn();
    renderRail({ onNewSession });

    expect(screen.getByText("Workspace")).toBeTruthy();
    await user.click(screen.getByTestId("shell-session-rail-new-session"));
    expect(onNewSession).toHaveBeenCalledTimes(1);
  });

  it("renders no New session affordance without a handler rather than a dead button", () => {
    renderRail();
    expect(screen.queryByTestId("shell-session-rail-new-session")).toBeNull();
  });

  it("renders each row as one keyboard-reachable control with its glyph, title, and real meta line", () => {
    renderRail();

    const row = screen.getByTestId("shell-session-rail-row-s-running") as HTMLButtonElement;
    expect(row.tagName).toBe("BUTTON");
    // The running session's real fields, in the reference's order.
    expect(within(row).getByText("◐")).toBeTruthy();
    expect(row.textContent).toContain("T380 — emulator claims");
    expect(row.textContent).toContain("now · 131.6k · opus-5");

    // A session with no usage/model carries only the parts it really has.
    const idleRow = screen.getByTestId("shell-session-rail-row-s-idle");
    expect(idleRow.textContent).toContain("1h");
    expect(idleRow.textContent).not.toContain("k ·");
  });

  it("keeps aria-current on the selected row only", () => {
    renderRail({ selectedSessionId: "s-idle" });
    expect(screen.getByTestId("shell-session-rail-row-s-idle").getAttribute("aria-current")).toBe(
      "true",
    );
    expect(
      screen.getByTestId("shell-session-rail-row-s-running").getAttribute("aria-current"),
    ).toBeNull();
  });

  it("filters rows by title or cwd substring", async () => {
    const user = userEvent.setup();
    renderRail();
    await user.type(screen.getByTestId("shell-session-rail-search"), "other");

    expect(screen.queryByTestId("shell-session-rail-row-s-running")).toBeNull();
    expect(screen.getByTestId("shell-session-rail-row-s-idle")).toBeTruthy();

    await user.clear(screen.getByTestId("shell-session-rail-search"));
    await user.type(screen.getByTestId("shell-session-rail-search"), "T380");
    expect(screen.getByTestId("shell-session-rail-row-s-running")).toBeTruthy();
    expect(screen.queryByTestId("shell-session-rail-row-s-idle")).toBeNull();
  });

  it("states an empty result instead of showing the invented-empty list when nothing matches", async () => {
    const user = userEvent.setup();
    renderRail();
    await user.type(screen.getByTestId("shell-session-rail-search"), "zzz-nothing");

    expect(screen.getByTestId("shell-session-rail-filter-empty")).toBeTruthy();
    expect(screen.queryByTestId("shell-session-rail-empty")).toBeNull();
    expect(screen.queryByTestId("shell-session-rail-row-s-running")).toBeNull();
  });

  it("never hides the selected session's row silently: it stays listed and the filter says so", async () => {
    const user = userEvent.setup();
    renderRail({ selectedSessionId: "s-running" });
    await user.type(screen.getByTestId("shell-session-rail-search"), "other");

    const selectedRow = screen.getByTestId("shell-session-rail-row-s-running");
    expect(selectedRow).toBeTruthy();
    expect(selectedRow.getAttribute("aria-current")).toBe("true");
    expect(screen.getByTestId("shell-session-rail-filter-note").textContent).toContain("other");
  });

  it("focuses the search field on Ctrl+K (and ⌘K) but not on a bare k", async () => {
    renderRail();
    const input = screen.getByTestId("shell-session-rail-search");
    expect(document.activeElement).not.toBe(input);

    fireEvent.keyDown(window, { key: "k" });
    expect(document.activeElement).not.toBe(input);

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(document.activeElement).toBe(input);

    input.blur();
    fireEvent.keyDown(window, { key: "k", metaKey: true });
    expect(document.activeElement).toBe(input);
  });

  it("reports the real connection state and relay kind in the foot", () => {
    const { unmount } = renderRail();
    expect(screen.getByTestId("shell-session-rail-foot").textContent).toContain(
      "connected · relay off",
    );
    unmount();

    renderRail({ connection: { status: "connected", kind: "relay" } });
    expect(screen.getByTestId("shell-session-rail-foot").textContent).toContain(
      "connected · relay on",
    );
  });

  it("states no relay fact when no connection is open", () => {
    renderRail({ connection: { status: "offline", kind: null } });
    const foot = screen.getByTestId("shell-session-rail-foot");
    expect(foot.textContent).toContain("offline");
    expect(foot.textContent).not.toContain("relay");
  });

  it("keeps every pre-existing state test id", () => {
    const { unmount } = render(
      <SessionRail state={{ kind: "loading" }} connection={CONNECTED_DIRECT} />,
    );
    expect(screen.getByTestId("shell-session-rail-loading")).toBeTruthy();
    unmount();

    render(
      <SessionRail state={{ kind: "error", message: "boom" }} connection={CONNECTED_DIRECT} />,
    );
    expect(screen.getByTestId("shell-session-rail-error")).toBeTruthy();
    unmount();

    render(<SessionRail state={{ kind: "ready", sessions: [] }} connection={CONNECTED_DIRECT} />);
    expect(screen.getByTestId("shell-session-rail-empty")).toBeTruthy();
  });

  it("has no axe violations across states", async () => {
    const states: SessionListState[] = [
      { kind: "loading" },
      { kind: "error", message: "boom" },
      { kind: "ready", sessions: [] },
      { kind: "ready", sessions: SESSIONS, stale: true },
    ];
    for (const state of states) {
      const { container, unmount } = render(
        <SessionRail state={state} connection={CONNECTED_DIRECT} now={NOW} />,
      );
      expect(await axe(container)).toHaveNoViolations();
      unmount();
    }

    const selected = render(
      <SessionRail
        state={READY}
        connection={CONNECTED_DIRECT}
        selectedSessionId="s-running"
        onNewSession={vi.fn()}
        now={NOW}
      />,
    );
    expect(await axe(selected.container)).toHaveNoViolations();
  }, 30_000);
});
