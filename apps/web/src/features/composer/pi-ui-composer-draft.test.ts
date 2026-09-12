import { describe, expect, it, vi } from "vitest";

import type { extensions } from "@picompanion/frontend-core";

import {
  PI_UI_COMPOSER_ACCEPT_ACTION_ID,
  PI_UI_COMPOSER_UNDO_ACTION_ID,
  appendToComposerDraft,
  applyComposerProposal,
  createPiUiComposerDraftSource,
  resolvePiUiComposerSettlement,
  type PiUiComposerActionTarget,
  type PiUiComposerProposal,
} from "./pi-ui-composer-draft.js";

function target(actionId: string): PiUiComposerActionTarget {
  return { agentId: "agent-1", namespace: "composer", elementId: "composer", actionId };
}

function settled(actionId: string): extensions.ExtensionActionState {
  return {
    target: target(actionId),
    requestId: "req-1",
    status: "success",
    staleRevision: false,
    source: "result",
    settledAt: 1,
  };
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

const NO_RECORDS: ReadonlyMap<string, string> = new Map();

describe("appendToComposerDraft", () => {
  it("returns the appended text on an empty draft", () => {
    expect(appendToComposerDraft("", "add a test")).toBe("add a test");
  });

  it("inserts one separating space when the draft does not end in whitespace", () => {
    expect(appendToComposerDraft("fix the bug", "and add a test")).toBe(
      "fix the bug and add a test",
    );
  });

  it("does not double an existing trailing space", () => {
    expect(appendToComposerDraft("fix the bug ", "and add a test")).toBe(
      "fix the bug and add a test",
    );
  });
});

describe("applyComposerProposal", () => {
  it("replaces the draft with the proposed text for the default (replace) mode", () => {
    expect(applyComposerProposal("typed", proposal({ mode: undefined }).payload)).toBe(
      "Synthetic rewritten prompt",
    );
  });

  it("replaces the draft for prefill mode too — accepting a prefill is the whole point of the card", () => {
    expect(applyComposerProposal("typed", proposal({ mode: "prefill" }).payload)).toBe(
      "Synthetic rewritten prompt",
    );
  });

  it("appends for append mode", () => {
    expect(applyComposerProposal("typed", proposal({ mode: "append", text: "more" }).payload)).toBe(
      "typed more",
    );
  });

  it("never clears the draft for a blank proposal", () => {
    expect(applyComposerProposal("typed", proposal({ text: "   " }).payload)).toBe("typed");
    expect(applyComposerProposal("typed", proposal({ text: "" }).payload)).toBe("typed");
  });
});

describe("createPiUiComposerDraftSource", () => {
  function element(kind: string, payload?: unknown) {
    return { id: "composer", ns: "composer", kind, placement: "inline", payload } as never;
  }

  it("resolves a composer element's typed payload", () => {
    const source = createPiUiComposerDraftSource({
      agentId: "agent-1",
      subscribe: () => () => undefined,
      getElement: () => element("composer", proposal().payload),
    });
    expect(source.resolveProposal(target("accept"))?.payload.text).toBe(
      "Synthetic rewritten prompt",
    );
  });

  it("returns null for a non-composer element", () => {
    const source = createPiUiComposerDraftSource({
      agentId: "agent-1",
      subscribe: () => () => undefined,
      getElement: () => element("status", { kind: "status", text: "hi" }),
    });
    expect(source.resolveProposal(target("accept"))).toBeNull();
  });

  it("returns null for a missing element", () => {
    const source = createPiUiComposerDraftSource({
      agentId: "agent-1",
      subscribe: () => () => undefined,
      getElement: () => undefined,
    });
    expect(source.resolveProposal(target("accept"))).toBeNull();
  });

  it("returns null for a target belonging to a different agent", () => {
    const source = createPiUiComposerDraftSource({
      agentId: "agent-1",
      subscribe: () => () => undefined,
      getElement: () => element("composer", proposal().payload),
    });
    expect(source.resolveProposal({ ...target("accept"), agentId: "agent-2" })).toBeNull();
  });

  it("delegates subscribe to the session's own controller", () => {
    const subscribe = vi.fn(() => () => undefined);
    const source = createPiUiComposerDraftSource({
      agentId: "agent-1",
      subscribe,
      getElement: () => undefined,
    });
    const listener = () => undefined;
    source.subscribe(listener);
    expect(subscribe).toHaveBeenCalledWith(listener);
  });
});

describe("resolvePiUiComposerSettlement", () => {
  it("accept writes the proposed text and records what it replaced", () => {
    const settlement = resolvePiUiComposerSettlement(
      "typed",
      NO_RECORDS,
      target(PI_UI_COMPOSER_ACCEPT_ACTION_ID),
      settled(PI_UI_COMPOSER_ACCEPT_ACTION_ID),
      proposal(),
    );
    expect(settlement?.draft).toBe("Synthetic rewritten prompt");
    expect(settlement?.previousByElement.get("composer\u0001composer")).toBe(
      "synthetic original draft",
    );
  });

  it("undo restores the recorded previous draft and clears the record", () => {
    const accepted = resolvePiUiComposerSettlement(
      "typed",
      NO_RECORDS,
      target(PI_UI_COMPOSER_ACCEPT_ACTION_ID),
      settled(PI_UI_COMPOSER_ACCEPT_ACTION_ID),
      proposal(),
    );
    const undone = resolvePiUiComposerSettlement(
      accepted!.draft,
      accepted!.previousByElement,
      target(PI_UI_COMPOSER_UNDO_ACTION_ID),
      settled(PI_UI_COMPOSER_UNDO_ACTION_ID),
      proposal(),
    );
    expect(undone?.draft).toBe("synthetic original draft");
    expect(undone?.previousByElement.size).toBe(0);
  });

  it("undo falls back to the payload's previousText when nothing was recorded locally", () => {
    const undone = resolvePiUiComposerSettlement(
      "rewritten",
      NO_RECORDS,
      target(PI_UI_COMPOSER_UNDO_ACTION_ID),
      settled(PI_UI_COMPOSER_UNDO_ACTION_ID),
      proposal(),
    );
    expect(undone?.draft).toBe("synthetic original draft");
  });

  it("a decline/dismiss leaves the draft untouched", () => {
    expect(
      resolvePiUiComposerSettlement(
        "typed",
        NO_RECORDS,
        target("decline"),
        settled("decline"),
        proposal(),
      ),
    ).toBeNull();
  });

  it("a blank proposal is a no-op even on accept", () => {
    expect(
      resolvePiUiComposerSettlement(
        "typed",
        NO_RECORDS,
        target(PI_UI_COMPOSER_ACCEPT_ACTION_ID),
        settled(PI_UI_COMPOSER_ACCEPT_ACTION_ID),
        proposal({ text: "   " }),
      ),
    ).toBeNull();
  });

  it("a failed (non-success) settlement is a no-op even on accept", () => {
    expect(
      resolvePiUiComposerSettlement(
        "typed",
        NO_RECORDS,
        target(PI_UI_COMPOSER_ACCEPT_ACTION_ID),
        {
          target: target(PI_UI_COMPOSER_ACCEPT_ACTION_ID),
          requestId: "req-1",
          status: "rejected",
          error: "nope",
          staleRevision: false,
          source: "result",
          settledAt: 1,
        } satisfies extensions.ExtensionActionState,
        proposal(),
      ),
    ).toBeNull();
  });

  it("a pending or timed-out settlement is a no-op even on accept", () => {
    expect(
      resolvePiUiComposerSettlement(
        "typed",
        NO_RECORDS,
        target(PI_UI_COMPOSER_ACCEPT_ACTION_ID),
        { status: "pending", target: target("accept"), requestId: "r", dispatchedAt: 1 },
        proposal(),
      ),
    ).toBeNull();
    expect(
      resolvePiUiComposerSettlement(
        "typed",
        NO_RECORDS,
        target(PI_UI_COMPOSER_ACCEPT_ACTION_ID),
        {
          target: target(PI_UI_COMPOSER_ACCEPT_ACTION_ID),
          requestId: "req-1",
          status: "timeout",
          staleRevision: false,
          source: "timeout",
          settledAt: 1,
        } satisfies extensions.ExtensionActionState,
        proposal(),
      ),
    ).toBeNull();
  });

  it("a non-composer target (no proposal) is a no-op", () => {
    expect(
      resolvePiUiComposerSettlement(
        "typed",
        NO_RECORDS,
        target(PI_UI_COMPOSER_ACCEPT_ACTION_ID),
        settled(PI_UI_COMPOSER_ACCEPT_ACTION_ID),
        null,
      ),
    ).toBeNull();
  });
});
