import type { AgentStreamEvent } from "@picompanion/protocol/agent-types";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type {
  DaemonPiNoticeClient,
  DaemonPiNoticeStreamMessage,
} from "./daemon-pi-notice-client.js";
import { PiNoticeBannerContainer } from "./PiNoticeBannerContainer.js";

afterEach(cleanup);

/** A minimal recording fake `DaemonPiNoticeClient` this test drives directly. */
function createFakeDaemon(): DaemonPiNoticeClient & {
  pushEvent: (agentId: string, event: AgentStreamEvent) => void;
} {
  const handlers = new Set<(message: DaemonPiNoticeStreamMessage) => void>();

  return {
    on: ((_type: "agent_stream", handler: (message: DaemonPiNoticeStreamMessage) => void) => {
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    }) as DaemonPiNoticeClient["on"],
    pushEvent(agentId, event) {
      for (const handler of handlers) {
        handler({ type: "agent_stream", payload: { agentId, event } });
      }
    },
  };
}

describe("PiNoticeBannerContainer", () => {
  it("renders nothing without a client", () => {
    const { container } = render(<PiNoticeBannerContainer agentId="agt_1" testId="pi-notices" />);
    expect(container.innerHTML).toBe("");
  });

  it("renders a live pi_notice event pushed by a real DaemonClient-shaped adapter", () => {
    const daemon = createFakeDaemon();
    render(<PiNoticeBannerContainer agentId="agt_1" client={daemon} testId="pi-notices" />);
    expect(screen.queryByTestId("pi-notices")).toBeNull();

    act(() => {
      daemon.pushEvent("agt_1", {
        type: "pi_notice",
        provider: "pi",
        level: "warning",
        message: "Pi UI bridge requested resync for agt_1 (agent-seq-gap)",
      });
    });

    expect(screen.getByTestId("pi-notices")).toBeTruthy();
    expect(
      screen.getByText("Pi UI bridge requested resync for agt_1 (agent-seq-gap)"),
    ).toBeTruthy();
  });

  it("ignores agent_stream events for a different agentId", () => {
    const daemon = createFakeDaemon();
    render(<PiNoticeBannerContainer agentId="agt_1" client={daemon} testId="pi-notices" />);

    act(() => {
      daemon.pushEvent("agt_other", {
        type: "pi_notice",
        provider: "pi",
        level: "error",
        message: "should not appear",
      });
    });

    expect(screen.queryByTestId("pi-notices")).toBeNull();
  });

  it("ignores non-pi_notice agent_stream events", () => {
    const daemon = createFakeDaemon();
    render(<PiNoticeBannerContainer agentId="agt_1" client={daemon} testId="pi-notices" />);

    act(() => {
      daemon.pushEvent("agt_1", {
        type: "pi_status",
        provider: "pi",
        key: "workflow",
        text: "implement",
      });
    });

    expect(screen.queryByTestId("pi-notices")).toBeNull();
  });

  it("dismisses a notice on its banner action", () => {
    const daemon = createFakeDaemon();
    render(<PiNoticeBannerContainer agentId="agt_1" client={daemon} testId="pi-notices" />);

    act(() => {
      daemon.pushEvent("agt_1", {
        type: "pi_notice",
        provider: "pi",
        level: "info",
        message: "dismiss me",
      });
    });
    expect(screen.getByText("dismiss me")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByTestId("pi-notices")).toBeNull();
  });
});
