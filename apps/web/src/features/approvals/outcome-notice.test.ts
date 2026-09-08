import { describe, expect, it } from "vitest";

import type { permissions } from "@picompanion/frontend-core";

import { buildOutcomeNotice, describeAnsweredBy, describeOutcome } from "./outcome-notice.js";

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
  actions: [
    { id: "allow_once", label: "Allow once", behavior: "allow", variant: "primary" },
    { id: "deny", label: "Deny", behavior: "deny", variant: "secondary" },
  ],
  questions: [],
  metadata: {},
  raw: { id: "perm_0001", provider: "pi", name: "bash", kind: "tool", title: "Run shell command" },
};

describe("describeAnsweredBy", () => {
  it("prefers a human label when the daemon supplies one", () => {
    expect(describeAnsweredBy({ label: "Android", clientId: "clid_1" })).toBe("Android");
  });

  // T134: every production emitter — `session.ts`'s `dispatchPiUiMessage`
  // and `handleAgentPermissionResponse` (both `answeredBy` sites) — sets
  // exactly `{ clientId: this.clientId }` and never a `label`. This test
  // builds that exact payload shape (no hand-supplied `label`, the defect
  // T134 exists to fix) and asserts the text a real user actually reads.
  it("degrades to the honest unknown phrase for a real production payload (clientId with no label)", () => {
    expect(describeAnsweredBy({ clientId: "clid_9f2a3b7c" })).toBe("an unknown client");
  });

  it("degrades honestly to an explicit unknown phrase rather than inventing an identity", () => {
    expect(describeAnsweredBy(undefined)).toBe("an unknown client");
    expect(describeAnsweredBy({})).toBe("an unknown client");
  });
});

describe("describeOutcome", () => {
  it("uses the offered action's own label when selectedActionId names one", () => {
    expect(
      describeOutcome({ behavior: "allow", selectedActionId: "allow_once" }, VIEW.actions),
    ).toBe('"Allow once"');
  });

  it("falls back to a plain approved/denied when no action matches", () => {
    expect(describeOutcome({ behavior: "allow" }, VIEW.actions)).toBe("approved");
    expect(describeOutcome({ behavior: "deny" }, VIEW.actions)).toBe("denied");
    expect(
      describeOutcome({ behavior: "deny", selectedActionId: "unknown_id" }, VIEW.actions),
    ).toBe("denied");
  });
});

describe("buildOutcomeNotice", () => {
  it("returns null for every non-contested status (pending, answered-locally, confirmed)", () => {
    expect(buildOutcomeNotice(VIEW, { status: "pending" })).toBeNull();
    expect(
      buildOutcomeNotice(VIEW, {
        status: "answered-locally",
        localResponse: { behavior: "allow" },
        answeredAt: 1,
      }),
    ).toBeNull();
    expect(
      buildOutcomeNotice(VIEW, {
        status: "confirmed",
        response: { behavior: "allow" },
        answeredBy: undefined,
        resolvedAt: 1,
      }),
    ).toBeNull();
  });

  it("builds a readable, named explanation for a superseded outcome", () => {
    const notice = buildOutcomeNotice(VIEW, {
      status: "superseded",
      localResponse: { behavior: "allow", selectedActionId: "allow_once" },
      response: { behavior: "deny", selectedActionId: "deny" },
      answeredBy: { label: "Android" },
      resolvedAt: 5,
    });
    expect(notice).not.toBeNull();
    expect(notice?.requestId).toBe("perm_0001");
    expect(notice?.title).toBe("Run shell command");
    expect(notice?.statusLabel).toBe("Superseded");
    expect(notice?.answeredByLabel).toBe("Android");
    expect(notice?.message).toContain("Android");
    expect(notice?.message).toContain('"Deny"');
  });

  it("builds a readable explanation for a resolved-elsewhere outcome, degrading honestly when the daemon named no client", () => {
    const notice = buildOutcomeNotice(VIEW, {
      status: "resolved-elsewhere",
      response: { behavior: "allow", selectedActionId: "allow_once" },
      answeredBy: undefined,
      resolvedAt: 5,
    });
    expect(notice).not.toBeNull();
    expect(notice?.statusLabel).toBe("Answered elsewhere");
    expect(notice?.answeredByLabel).toBe("an unknown client");
    expect(notice?.message).toContain("an unknown client");
    expect(notice?.message).toContain('"Allow once"');
    // The unknown case is *stated*, not silently omitted.
    expect(notice?.message.toLowerCase()).toContain("unknown");
  });

  // T134: `handleAgentPermissionResponse` (in `session.ts`) — the one real
  // production site that answers a permission request — supplies exactly
  // `{ clientId: this.clientId }`, never a `label`. This builds the
  // resolution with that exact shape (no hand-supplied `label`) and asserts
  // the sentence a real user reads never contains the raw connection id.
  it("never surfaces a raw clientId in the rendered message for a real production resolution", () => {
    const notice = buildOutcomeNotice(VIEW, {
      status: "resolved-elsewhere",
      response: { behavior: "deny", selectedActionId: "deny" },
      answeredBy: { clientId: "clid_9f2a3b7c" },
      resolvedAt: 5,
    });
    expect(notice).not.toBeNull();
    expect(notice?.answeredByLabel).toBe("an unknown client");
    expect(notice?.message).not.toContain("clid_9f2a3b7c");
    expect(notice?.message).toContain("an unknown client");
  });
});
