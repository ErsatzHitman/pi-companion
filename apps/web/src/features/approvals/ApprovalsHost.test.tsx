import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { permissions } from "@picompanion/frontend-core";

import { ApprovalsHost } from "./ApprovalsHost.js";
import type { OutcomeNoticeViewModel } from "./outcome-notice.js";

afterEach(cleanup);

const VIEW: permissions.PermissionDialogViewModel = {
  requestId: "perm_0001",
  agentId: "agt_0001",
  provider: "pi",
  name: "bash",
  kind: "tool",
  presentation: "tool-actions",
  extensionUiMethod: null,
  title: "Run shell command",
  description: "npm test",
  actions: [],
  questions: [],
  metadata: {},
  raw: { id: "perm_0001", provider: "pi", name: "bash", kind: "tool", title: "Run shell command" },
};

describe("ApprovalsHost", () => {
  it("renders nothing when there is no pending request and no error", () => {
    const { container } = render(
      <ApprovalsHost
        current={null}
        waitingCount={0}
        error={null}
        onAnswer={() => {}}
        onDismissError={() => {}}
      />,
    );
    expect(container.textContent).toBe("");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("renders the dialog for a pending request", () => {
    render(
      <ApprovalsHost
        current={VIEW}
        waitingCount={0}
        error={null}
        onAnswer={() => {}}
        onDismissError={() => {}}
      />,
    );
    expect(screen.getByRole("dialog", { name: "Run shell command" })).toBeTruthy();
  });

  it("shows a dismissible, non-colour send-failure banner that survives the dialog closing", async () => {
    const user = userEvent.setup();
    const onDismissError = vi.fn();
    render(
      <ApprovalsHost
        current={null}
        waitingCount={0}
        error="socket closed"
        onAnswer={() => {}}
        onDismissError={onDismissError}
      />,
    );
    const banner = screen.getByRole("status");
    expect(banner.textContent).toContain("Could not send your answer: socket closed");
    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onDismissError).toHaveBeenCalledTimes(1);
  });

  it("has no axe violations with a dialog and an error banner both showing", async () => {
    const { container } = render(
      <ApprovalsHost
        current={VIEW}
        waitingCount={1}
        error="socket closed"
        onAnswer={() => {}}
        onDismissError={() => {}}
      />,
    );
    expect(await axe(container)).toHaveNoViolations();
  }, 20_000);

  describe("T47A2: notice takes over the one-modal-at-a-time slot", () => {
    const NOTICE: OutcomeNoticeViewModel = {
      requestId: "perm_0001",
      title: "Run shell command",
      statusLabel: "Superseded",
      answeredByLabel: "Android",
      message: "Android answered this request first. The request was resolved as denied.",
    };

    it("renders the notice instead of the dialog when both a notice and a current request are present", () => {
      render(
        <ApprovalsHost
          current={VIEW}
          waitingCount={0}
          error={null}
          notice={NOTICE}
          onAnswer={() => {}}
          onDismissError={() => {}}
          onDismissNotice={() => {}}
        />,
      );
      expect(screen.queryByRole("dialog")).toBeNull();
      const alert = screen.getByRole("alertdialog");
      expect(alert.textContent).toContain("Android answered this request first");
    });

    it("renders the dialog again once the notice is dismissed", async () => {
      const user = userEvent.setup();
      const onDismissNotice = vi.fn();
      const { rerender } = render(
        <ApprovalsHost
          current={VIEW}
          waitingCount={0}
          error={null}
          notice={NOTICE}
          onAnswer={() => {}}
          onDismissError={() => {}}
          onDismissNotice={onDismissNotice}
        />,
      );
      await user.click(screen.getByRole("button", { name: "OK" }));
      expect(onDismissNotice).toHaveBeenCalledTimes(1);

      rerender(
        <ApprovalsHost
          current={VIEW}
          waitingCount={0}
          error={null}
          notice={null}
          onAnswer={() => {}}
          onDismissError={() => {}}
          onDismissNotice={onDismissNotice}
        />,
      );
      expect(screen.getByRole("dialog", { name: "Run shell command" })).toBeTruthy();
      expect(screen.queryByRole("alertdialog")).toBeNull();
    });

    it("has no axe violations with the notice, the dialog it is replacing, and an error banner all in play", async () => {
      const { container } = render(
        <ApprovalsHost
          current={VIEW}
          waitingCount={1}
          error="socket closed"
          notice={NOTICE}
          onAnswer={() => {}}
          onDismissError={() => {}}
          onDismissNotice={() => {}}
        />,
      );
      expect(await axe(container)).toHaveNoViolations();
    }, 20_000);
  });
});
