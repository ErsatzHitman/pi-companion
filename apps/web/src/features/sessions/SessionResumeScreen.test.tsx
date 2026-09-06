import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { axe } from "jest-axe";
import { afterEach, describe, expect, it } from "vitest";

import { timeline as coreTimeline } from "@picompanion/frontend-core";

import { SessionResumeScreen } from "./SessionResumeScreen.js";
import type { SessionResumeClient, SessionResumeResult } from "./session-resume-client.js";
import { FakeClock, InMemoryStructuredStorage } from "./test-doubles.js";
import type { SessionSummary } from "./types.js";

afterEach(cleanup);

const SESSION: SessionSummary = {
  id: "agent-1",
  title: "Refactor router",
  provider: "pi",
  cwd: "/repo/existing",
  status: "running",
  updatedAt: "2026-01-02T00:00:00.000Z",
};

function timelineWithMessages(count: number): coreTimeline.TimelineState {
  return coreTimeline.ingestTimelineWindow(coreTimeline.createEmptyTimelineState(), {
    type: "fetch_agent_timeline_response",
    payload: {
      requestId: "req-1",
      agentId: "agent-1",
      agent: null,
      direction: "tail",
      projection: "projected",
      epoch: "epoch-1",
      reset: false,
      staleCursor: false,
      gap: false,
      window: { minSeq: 0, maxSeq: count - 1, nextSeq: count },
      startCursor: { epoch: "epoch-1", seq: 0 },
      endCursor: { epoch: "epoch-1", seq: count - 1 },
      hasOlder: false,
      hasNewer: false,
      entries: Array.from({ length: count }, (_, index) => ({
        provider: "pi",
        item: { type: "user_message" as const, text: `message ${index}` },
        timestamp: "2026-01-02T00:00:00.000Z",
        seqStart: index,
        seqEnd: index,
        sourceSeqRanges: [{ startSeq: index, endSeq: index }],
        collapsed: [],
      })),
      error: null,
    },
  });
}

function renderSessionScreenAt(
  initialPath: string,
  overrides: Partial<{ client: SessionResumeClient }> = {},
) {
  const storage = new InMemoryStructuredStorage();
  const clock = new FakeClock();
  const rootRoute = createRootRoute();
  const sessionRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/h/$serverId/session/$agentId",
    component: () => {
      const { serverId, agentId } = sessionRoute.useParams();
      return (
        <SessionResumeScreen
          serverId={serverId}
          agentId={agentId}
          client={overrides.client}
          clock={clock}
          structuredStorage={storage}
        />
      );
    },
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([sessionRoute]),
    history: createMemoryHistory({ initialEntries: [initialPath] }),
  });
  const result = render(<RouterProvider router={router} />);
  return { ...result, router };
}

describe("SessionResumeScreen (T27B3)", () => {
  it("shows a loading state before the resume resolves", async () => {
    const client: SessionResumeClient = { resumeSession: () => new Promise(() => {}) };
    renderSessionScreenAt("/h/host-1/session/agent-1", { client });

    expect(await screen.findByTestId("session-resume-loading")).toBeTruthy();
  });

  it("opens correctly on a cold load: a direct URL with no prior app state resolves and restores state", async () => {
    const client: SessionResumeClient = {
      resumeSession: async (sessionId) => {
        expect(sessionId).toBe("agent-1");
        return { session: SESSION, timeline: timelineWithMessages(3) };
      },
    };
    renderSessionScreenAt("/h/host-1/session/agent-1", { client });

    await screen.findByTestId("session-resume-ready");
    expect(screen.getByText("Refactor router")).toBeTruthy();
    expect(screen.getByTestId("session-resume-message-count").textContent).toBe("3");
    expect(screen.getByTestId("session-resume-queue-count").textContent).toBe("0");
    expect(screen.getByText(/running/i)).toBeTruthy();
  });

  it("fails with a clear message when resuming a session that does not exist", async () => {
    const client: SessionResumeClient = {
      resumeSession: async () => {
        throw new Error("Agent not found: agent-1");
      },
    };
    renderSessionScreenAt("/h/host-1/session/agent-1", { client });

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/doesn't exist/i);
  });

  it("explains the not-connected placeholder when no client is wired in", async () => {
    renderSessionScreenAt("/h/host-1/session/agent-1");

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/not connected/i);
  });

  it("recovers via Retry after a transient failure", async () => {
    let attempt = 0;
    const client: SessionResumeClient = {
      resumeSession: async (): Promise<SessionResumeResult> => {
        attempt += 1;
        if (attempt === 1) throw new Error("temporary daemon hiccup");
        return { session: SESSION, timeline: timelineWithMessages(1) };
      },
    };
    renderSessionScreenAt("/h/host-1/session/agent-1", { client });
    const user = userEvent.setup();

    await screen.findByRole("alert");
    await user.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => expect(screen.getByTestId("session-resume-message-count")).toBeTruthy());
    expect(attempt).toBe(2);
  });

  it("has no axe violations on the ready state", async () => {
    const client: SessionResumeClient = {
      resumeSession: async () => ({ session: SESSION, timeline: timelineWithMessages(2) }),
    };
    const { container } = renderSessionScreenAt("/h/host-1/session/agent-1", { client });
    await screen.findByTestId("session-resume-ready");

    expect(await axe(container)).toHaveNoViolations();
  }, 20_000);

  it("has no axe violations on the error state", async () => {
    const client: SessionResumeClient = {
      resumeSession: async () => {
        throw new Error("Agent not found: agent-1");
      },
    };
    const { container } = renderSessionScreenAt("/h/host-1/session/agent-1", { client });
    await screen.findByRole("alert");

    expect(await axe(container)).toHaveNoViolations();
  }, 20_000);
});
