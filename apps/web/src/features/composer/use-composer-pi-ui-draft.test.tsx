import { act, cleanup, renderHook } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { extensions } from "@picompanion/frontend-core";

import {
  PI_UI_COMPOSER_ACCEPT_ACTION_ID,
  PI_UI_COMPOSER_UNDO_ACTION_ID,
  type PiUiComposerActionState,
  type PiUiComposerActionTarget,
  type PiUiComposerDraftSource,
  type PiUiComposerProposal,
} from "./pi-ui-composer-draft.js";
import { useComposerPiUiDraft } from "./use-composer-pi-ui-draft.js";

afterEach(cleanup);

function target(actionId: string): PiUiComposerActionTarget {
  return { agentId: "agent-1", namespace: "composer", elementId: "composer", actionId };
}

function proposal(overrides: Partial<PiUiComposerProposal["payload"]> = {}): PiUiComposerProposal {
  return {
    namespace: "composer",
    elementId: "composer",
    payload: {
      kind: "composer",
      text: "Synthetic rewritten prompt",
      mode: "prefill",
      previousText: "synthetic original draft",
      ...overrides,
    },
  };
}

function settled(actionId: string): PiUiComposerActionState {
  return {
    target: target(actionId),
    requestId: "req-1",
    status: "success",
    staleRevision: false,
    source: "result",
    settledAt: 1,
  };
}

/** A manual, in-memory `ExtensionActionController` stand-in: tests decide when a settlement fires. */
class FakeComposerDraftSource implements PiUiComposerDraftSource {
  private readonly listeners = new Set<
    (target: PiUiComposerActionTarget, state: PiUiComposerActionState) => void
  >();
  private readonly proposals = new Map<string, PiUiComposerProposal>();

  subscribe(
    listener: (target: PiUiComposerActionTarget, state: PiUiComposerActionState) => void,
  ): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  resolveProposal(target: PiUiComposerActionTarget): PiUiComposerProposal | null {
    return this.proposals.get(target.elementId) ?? null;
  }

  setProposal(value: PiUiComposerProposal): void {
    this.proposals.set(value.elementId, value);
  }

  settle(actionId: string, status: extensions.ExtensionActionState["status"] = "success"): void {
    const base = settled(actionId);
    const state = (status === "success" ? base : { ...base, status }) as PiUiComposerActionState;
    for (const listener of this.listeners) listener(target(actionId), state);
  }

  get subscriberCount(): number {
    return this.listeners.size;
  }
}

function renderComposer(source: PiUiComposerDraftSource | undefined, initialDraft: string) {
  return renderHook(() => {
    const [draft, setDraft] = useState(initialDraft);
    useComposerPiUiDraft({ source, draftText: draft, setDraftText: setDraft });
    return { draft, setDraft };
  });
}

describe("useComposerPiUiDraft", () => {
  it("writes an accepted proposal's text into the live draft", () => {
    const source = new FakeComposerDraftSource();
    source.setProposal(proposal());
    const { result } = renderComposer(source, "typed");

    act(() => source.settle(PI_UI_COMPOSER_ACCEPT_ACTION_ID));

    expect(result.current.draft).toBe("Synthetic rewritten prompt");
  });

  it("restores the previous draft on undo", () => {
    const source = new FakeComposerDraftSource();
    source.setProposal(proposal());
    const { result } = renderComposer(source, "typed");

    act(() => source.settle(PI_UI_COMPOSER_ACCEPT_ACTION_ID));
    expect(result.current.draft).toBe("Synthetic rewritten prompt");

    act(() => source.settle(PI_UI_COMPOSER_UNDO_ACTION_ID));
    expect(result.current.draft).toBe("synthetic original draft");
  });

  it("leaves the draft untouched on a decline", () => {
    const source = new FakeComposerDraftSource();
    source.setProposal(proposal());
    const { result } = renderComposer(source, "typed");

    act(() => source.settle("decline"));

    expect(result.current.draft).toBe("typed");
  });

  it("leaves the draft untouched for a blank proposal", () => {
    const source = new FakeComposerDraftSource();
    source.setProposal(proposal({ text: "   " }));
    const { result } = renderComposer(source, "typed");

    act(() => source.settle(PI_UI_COMPOSER_ACCEPT_ACTION_ID));

    expect(result.current.draft).toBe("typed");
  });

  it("leaves the draft untouched for a failed (non-success) settlement", () => {
    const source = new FakeComposerDraftSource();
    source.setProposal(proposal());
    const { result } = renderComposer(source, "typed");

    act(() => source.settle(PI_UI_COMPOSER_ACCEPT_ACTION_ID, "timeout"));

    expect(result.current.draft).toBe("typed");
  });

  it("reads the draft fresh, so a typed edit after wiring is what gets replaced", () => {
    const source = new FakeComposerDraftSource();
    source.setProposal(proposal());
    const { result } = renderComposer(source, "typed");

    act(() => result.current.setDraft("typed some more"));
    act(() => source.settle(PI_UI_COMPOSER_ACCEPT_ACTION_ID));

    expect(result.current.draft).toBe("Synthetic rewritten prompt");

    act(() => source.settle(PI_UI_COMPOSER_UNDO_ACTION_ID));
    expect(result.current.draft).toBe("synthetic original draft");
  });

  it("does not subscribe at all when no source is wired", () => {
    const source = new FakeComposerDraftSource();
    const subscribeSpy = vi.spyOn(source, "subscribe");
    renderComposer(undefined, "typed");
    expect(subscribeSpy).not.toHaveBeenCalled();
  });

  it("unsubscribes on unmount", () => {
    const source = new FakeComposerDraftSource();
    const { unmount } = renderComposer(source, "typed");
    expect(source.subscriberCount).toBe(1);
    unmount();
    expect(source.subscriberCount).toBe(0);
  });
});
