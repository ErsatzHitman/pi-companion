import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { composer as coreComposer } from "@picompanion/frontend-core";

import { RecoveredTurnBanner } from "./recovered-turn-banner.js";
import type { AwaitingConfirmationEntry, RecoveredTurnOutbox } from "./recovered-turn-model.js";

afterEach(cleanup);

function makeTurn(overrides: Partial<AwaitingConfirmationEntry> = {}): AwaitingConfirmationEntry {
  return {
    id: "outbox_1",
    sessionId: "agt_1",
    kind: "prompt",
    payload: { text: "hi", clientMessageId: "cmid-1" },
    status: "awaiting-confirmation",
    createdAt: 0,
    attempts: 1,
    ...overrides,
  };
}

function createCountingOutbox(
  confirmResendResult: coreComposer.OutboxEntry | null = null,
): RecoveredTurnOutbox & { calls: { confirmResend: string[]; remove: string[] } } {
  const calls = { confirmResend: [] as string[], remove: [] as string[] };
  return {
    calls,
    async confirmResend(id: string) {
      calls.confirmResend.push(id);
      return confirmResendResult;
    },
    async remove(id: string) {
      calls.remove.push(id);
    },
  };
}

describe("RecoveredTurnBanner (FIX-W6)", () => {
  it("renders nothing when nothing is parked", () => {
    const outbox = createCountingOutbox();
    const { container } = render(
      <RecoveredTurnBanner turns={[]} outbox={outbox} testId="recovered-turn" />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders the banner with both Resend and Discard actions for a parked entry", () => {
    const outbox = createCountingOutbox();
    const turn = makeTurn();
    render(<RecoveredTurnBanner turns={[turn]} outbox={outbox} testId="recovered-turn" />);
    expect(screen.getByTestId("recovered-turn-outbox_1")).toBeTruthy();
    expect(
      screen.getByRole("button", {
        name: "Resend the message that could not be confirmed as sent",
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", {
        name: "Discard the message that could not be confirmed as sent",
      }),
    ).toBeTruthy();
  });

  it("Resend calls outbox.confirmResend exactly once, with the turn's own id — never a new clientMessageId", async () => {
    const turn = makeTurn({ id: "outbox_resend_1" });
    const outbox = createCountingOutbox({ ...turn, status: "pending" });
    const onChange = vi.fn();
    render(<RecoveredTurnBanner turns={[turn]} outbox={outbox} onChange={onChange} testId="rt" />);
    fireEvent.click(
      screen.getByRole("button", {
        name: "Resend the message that could not be confirmed as sent",
      }),
    );
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    expect(outbox.calls.confirmResend).toEqual(["outbox_resend_1"]);
    expect(outbox.calls.remove).toEqual([]);
  });

  it("Discard calls outbox.remove exactly once and never confirmResend", async () => {
    const turn = makeTurn({ id: "outbox_discard_1" });
    const outbox = createCountingOutbox();
    const onChange = vi.fn();
    render(<RecoveredTurnBanner turns={[turn]} outbox={outbox} onChange={onChange} testId="rt" />);
    fireEvent.click(
      screen.getByRole("button", {
        name: "Discard the message that could not be confirmed as sent",
      }),
    );
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    expect(outbox.calls.remove).toEqual(["outbox_discard_1"]);
    expect(outbox.calls.confirmResend).toEqual([]);
  });

  it("has no axe violations", async () => {
    const outbox = createCountingOutbox();
    const { container } = render(
      <RecoveredTurnBanner turns={[makeTurn()]} outbox={outbox} testId="rt" />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
