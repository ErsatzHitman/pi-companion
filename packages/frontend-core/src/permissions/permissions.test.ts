/**
 * Fixture-driven tests for the permissions domain (T21A).
 *
 * The tool-permission round trip is driven by the recorded
 * `packages/protocol/src/fixtures/daemon-ws/permission-dialog.json`
 * fixture (T06B). The extension-dialog (`select`/`input`/`editor`/
 * `confirm`) requests below are not separately recorded as daemon-ws
 * fixtures, but their exact shape is not invented: it mirrors the real
 * `AgentPermissionRequest` produced by the ported Pi provider's
 * `buildExtensionUiQuestionPermission` in
 * `packages/server/src/server/agent/providers/pi/agent.ts`, which maps
 * every Tier-1 `extension_ui_request` (plan.md §11.2) onto the same
 * `agent_permission_request` wire message this suite exercises.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { extractSessionMessage } from "@picompanion/protocol/messages";
import type { Clock, TimerHandle } from "../platform/clock.js";
import { PermissionsController } from "./controller.js";
import {
  buildActionResponse,
  buildDenyResponse,
  buildQuestionAnswerResponse,
} from "./responses.js";
import { isExtensionDialogMethod } from "./types.js";
import type { AgentPermissionRequest, AgentPermissionResponseWireMessage } from "./types.js";
import { toPermissionDialogViewModel } from "./view-model.js";

// --- Fixture loading -------------------------------------------------------
//
// packages/protocol/dist does not carry the fixture JSON assets (only the
// compiled loader functions), so — like packages/protocol's own
// fixtures.test.ts — this reads the recorded JSON directly from source.

const here = dirname(fileURLToPath(import.meta.url));
const DAEMON_WS_FIXTURES_DIR = join(here, "../../../protocol/src/fixtures/daemon-ws");

interface FixtureFrame {
  id: string;
  direction: "client_to_daemon" | "daemon_to_client";
  wireType: string;
  message: unknown;
}

interface DaemonWsFixture {
  scenario: string;
  frames: FixtureFrame[];
}

function loadDaemonWsFixture(name: string): DaemonWsFixture {
  const path = join(DAEMON_WS_FIXTURES_DIR, `${name}.json`);
  return JSON.parse(readFileSync(path, "utf8")) as DaemonWsFixture;
}

/** Unwraps a recorded `{ type: "session", message: <session message> }` envelope frame. */
function innerSessionMessage(frame: FixtureFrame): unknown {
  return extractSessionMessage(frame.message as never);
}

// --- Deterministic fake Clock ----------------------------------------------

class FakeClock implements Clock {
  private time = 0;
  private nextHandle = 1;
  private readonly pending = new Map<number, { dueAt: number; callback: () => void }>();

  now(): number {
    return this.time;
  }

  setTimeout(callback: () => void, delayMs: number): TimerHandle {
    const handle = this.nextHandle++;
    this.pending.set(handle, { dueAt: this.time + delayMs, callback });
    return handle as unknown as TimerHandle;
  }

  clearTimeout(handle: TimerHandle): void {
    this.pending.delete(handle as unknown as number);
  }

  setInterval(): TimerHandle {
    return this.nextHandle++ as unknown as TimerHandle;
  }

  clearInterval(): void {
    // Unused by PermissionsController; no-op for interface completeness.
  }

  /** Advances simulated time, firing due timeouts in due-time order. */
  advance(ms: number): void {
    this.time += ms;
    const due = Array.from(this.pending.entries())
      .filter(([, entry]) => entry.dueAt <= this.time)
      .sort((a, b) => a[1].dueAt - b[1].dueAt);
    for (const [handle, entry] of due) {
      this.pending.delete(handle);
      entry.callback();
    }
  }

  get pendingCount(): number {
    return this.pending.size;
  }
}

// --- Extension dialog request fixtures (see file header) -------------------

function extensionDialogRequest(
  method: "select" | "input" | "editor" | "confirm",
): AgentPermissionRequest {
  switch (method) {
    case "select":
      return {
        id: "ext_dialog_select_0001",
        provider: "pi",
        name: "Pi select",
        kind: "question",
        title: "Choose an environment",
        input: {
          questions: [
            {
              question: "Choose an environment",
              header: "Response",
              options: [{ label: "staging" }, { label: "production" }],
              multiSelect: false,
            },
          ],
        },
        metadata: { extensionUiMethod: "select", answerHeader: "Response" },
      };
    case "input":
      return {
        id: "ext_dialog_input_0001",
        provider: "pi",
        name: "Pi input",
        kind: "question",
        title: "Enter a commit message",
        input: {
          questions: [
            {
              question: "Enter a commit message",
              header: "Response",
              options: [],
              multiSelect: false,
              placeholder: "feat: ...",
            },
          ],
        },
        metadata: { extensionUiMethod: "input", answerHeader: "Response" },
      };
    case "editor":
      return {
        id: "ext_dialog_editor_0001",
        provider: "pi",
        name: "Pi editor",
        kind: "question",
        title: "Edit text",
        input: {
          questions: [
            { question: "Edit text", header: "Response", options: [], multiSelect: false },
          ],
        },
        metadata: { extensionUiMethod: "editor", answerHeader: "Response" },
      };
    case "confirm":
      return {
        id: "ext_dialog_confirm_0001",
        provider: "pi",
        name: "Pi confirm",
        kind: "question",
        title: "Delete the branch?\n\nThis cannot be undone.",
        input: {
          questions: [
            {
              question: "Delete the branch?\n\nThis cannot be undone.",
              header: "Response",
              options: [{ label: "Yes" }, { label: "No" }],
              multiSelect: false,
            },
          ],
        },
        metadata: { extensionUiMethod: "confirm", answerHeader: "Response" },
      };
  }
}

// --- Tests -------------------------------------------------------------

describe("PermissionsController — tool permission fixture round trip", () => {
  it("drives request -> pending view model -> answer -> resolved from permission-dialog.json", () => {
    const fixture = loadDaemonWsFixture("permission-dialog");
    expect(fixture.frames).toHaveLength(3);

    const [requestFrame, responseFrame, resolvedFrame] = fixture.frames;
    const clock = new FakeClock();
    const controller = new PermissionsController({ clock });

    const requestResult = controller.handleMessage(innerSessionMessage(requestFrame));
    expect(requestResult).toEqual({ handled: true, kind: "request" });

    const pending = controller.getPending();
    expect(pending).toHaveLength(1);
    const [view] = pending;
    expect(view.requestId).toBe("perm_fixture_0001");
    expect(view.agentId).toBe("agt_fixture_0001");
    expect(view.kind).toBe("tool");
    expect(view.presentation).toBe("tool-actions");
    expect(view.extensionUiMethod).toBeNull();
    expect(view.actions.map((action) => action.id)).toEqual(["allow_once", "allow_always", "deny"]);

    const entryBeforeAnswer = controller.get(view.requestId);
    expect(entryBeforeAnswer?.status).toBe("pending");

    const allowOnce = view.actions.find((action) => action.id === "allow_once");
    if (!allowOnce) throw new Error("fixture missing allow_once action");
    const wireResponse = controller.answer(view.requestId, buildActionResponse(allowOnce));

    const expectedResponseMessage = innerSessionMessage(
      responseFrame,
    ) as AgentPermissionResponseWireMessage;
    expect(wireResponse).toEqual(expectedResponseMessage);

    const entryAfterAnswer = controller.get(view.requestId);
    expect(entryAfterAnswer?.status).toBe("answered");
    expect(entryAfterAnswer?.localResponse).toEqual(expectedResponseMessage.response);
    expect(controller.getPending()).toHaveLength(0);

    const resolvedResult = controller.handleMessage(innerSessionMessage(resolvedFrame));
    expect(resolvedResult).toEqual({ handled: true, kind: "resolved" });

    const entryAfterResolution = controller.get(view.requestId);
    expect(entryAfterResolution?.status).toBe("answered");
    expect(entryAfterResolution?.resolution).toEqual(expectedResponseMessage.response);
    expect(entryAfterResolution?.resolvedAt).toBeDefined();
  });

  it("re-answering an already-answered request returns null instead of throwing", () => {
    const fixture = loadDaemonWsFixture("permission-dialog");
    const clock = new FakeClock();
    const controller = new PermissionsController({ clock });
    controller.handleMessage(innerSessionMessage(fixture.frames[0]));
    const [view] = controller.getPending();
    const denyAction = view.actions.find((action) => action.id === "deny");
    if (!denyAction) throw new Error("fixture missing deny action");
    controller.answer(view.requestId, buildActionResponse(denyAction));

    const secondAnswer = controller.answer(view.requestId, buildActionResponse(denyAction));
    expect(secondAnswer).toBeNull();
  });

  it("ignores malformed or unrelated messages without throwing", () => {
    const controller = new PermissionsController({ clock: new FakeClock() });
    expect(controller.handleMessage(null)).toEqual({ handled: false });
    expect(controller.handleMessage({ type: "agent_created" })).toEqual({ handled: false });
    expect(
      controller.handleMessage({ type: "agent_permission_request", payload: { oops: true } }),
    ).toEqual({ handled: false });
  });

  it("ignores a duplicate request id instead of resetting the pending entry", () => {
    const fixture = loadDaemonWsFixture("permission-dialog");
    const clock = new FakeClock();
    const controller = new PermissionsController({ clock, defaultTimeoutMs: 1000 });
    controller.handleMessage(innerSessionMessage(fixture.frames[0]));
    clock.advance(500);
    controller.handleMessage(innerSessionMessage(fixture.frames[0])); // duplicate
    expect(controller.list()).toHaveLength(1);
    expect(controller.get("perm_fixture_0001")?.requestedAt).toBe(0);
  });

  it("ignores a resolution for an unknown request id", () => {
    const controller = new PermissionsController({ clock: new FakeClock() });
    expect(() =>
      controller.applyResolution("agt_x", "unknown_request", { behavior: "deny" }),
    ).not.toThrow();
    expect(controller.get("unknown_request")).toBeUndefined();
  });
});

describe("PermissionsController — extension dialog kinds map to platform-neutral view models", () => {
  const methods = ["select", "input", "editor", "confirm"] as const;

  for (const method of methods) {
    it(`presents a "${method}" AgentPermissionRequest as a "${method}" dialog`, () => {
      const controller = new PermissionsController({ clock: new FakeClock() });
      const request = extensionDialogRequest(method);
      controller.ingestRequest("agt_ext_dialogs", request);

      const entry = controller.get(request.id);
      expect(entry?.status).toBe("pending");
      const view = entry?.view;
      expect(view?.kind).toBe("question");
      expect(view?.presentation).toBe(method);
      expect(view?.extensionUiMethod).toBe(method);
      expect(view?.questions).toHaveLength(1);
      expect(view?.questions[0]?.header).toBe("Response");
    });
  }

  it("answers a select dialog with the chosen option, keyed by question header", () => {
    const controller = new PermissionsController({ clock: new FakeClock() });
    const request = extensionDialogRequest("select");
    controller.ingestRequest("agt_ext_dialogs", request);

    const wireResponse = controller.answer(
      request.id,
      buildQuestionAnswerResponse({ Response: "staging" }),
    );
    expect(wireResponse).toEqual({
      type: "agent_permission_response",
      agentId: "agt_ext_dialogs",
      requestId: request.id,
      response: { behavior: "allow", updatedInput: { answers: { Response: "staging" } } },
    });
  });

  it("answers a confirm dialog and a cancelled input dialog", () => {
    const controller = new PermissionsController({ clock: new FakeClock() });
    const confirmRequest = extensionDialogRequest("confirm");
    controller.ingestRequest("agt_ext_dialogs", confirmRequest);
    const confirmResponse = controller.answer(
      confirmRequest.id,
      buildQuestionAnswerResponse({ Response: "Yes" }),
    );
    expect(confirmResponse?.response).toEqual({
      behavior: "allow",
      updatedInput: { answers: { Response: "Yes" } },
    });

    const inputRequest = extensionDialogRequest("input");
    controller.ingestRequest("agt_ext_dialogs", inputRequest);
    const cancelResponse = controller.answer(inputRequest.id, buildDenyResponse());
    expect(cancelResponse?.response).toEqual({ behavior: "deny" });
    expect(controller.get(inputRequest.id)?.status).toBe("answered");
  });

  it("validates isExtensionDialogMethod against known and unknown values", () => {
    expect(isExtensionDialogMethod("select")).toBe(true);
    expect(isExtensionDialogMethod("confirm")).toBe(true);
    expect(isExtensionDialogMethod("widget")).toBe(false);
    expect(isExtensionDialogMethod(42)).toBe(false);
    expect(isExtensionDialogMethod(undefined)).toBe(false);
  });

  it("falls back to the generic 'question' presentation for an unrecognized extensionUiMethod", () => {
    const request: AgentPermissionRequest = {
      id: "ext_dialog_unknown_0001",
      provider: "pi",
      name: "Pi mystery",
      kind: "question",
      title: "Mystery dialog",
      input: {
        questions: [{ question: "?", header: "Response", options: [], multiSelect: false }],
      },
      metadata: { extensionUiMethod: "carrier-pigeon" },
    };
    const view = toPermissionDialogViewModel("agt_x", request);
    expect(view.presentation).toBe("question");
    expect(view.extensionUiMethod).toBeNull();
  });

  it("never throws building a view model for a bare tool request with no actions or input", () => {
    const request: AgentPermissionRequest = {
      id: "bare_tool_0001",
      provider: "pi",
      name: "bash",
      kind: "tool",
    };
    const view = toPermissionDialogViewModel("agt_x", request);
    expect(view.presentation).toBe("tool-actions");
    expect(view.actions).toEqual([]);
    expect(view.questions).toEqual([]);
  });
});

describe("PermissionsController — timeouts resolve without leaking pending state", () => {
  it("times out a still-pending request after defaultTimeoutMs and clears its timer", () => {
    const clock = new FakeClock();
    const onTimeout = vi.fn();
    const controller = new PermissionsController({ clock, defaultTimeoutMs: 1000, onTimeout });
    const request = extensionDialogRequest("input");
    controller.ingestRequest("agt_x", request);

    expect(clock.pendingCount).toBe(1);
    clock.advance(999);
    expect(controller.get(request.id)?.status).toBe("pending");

    clock.advance(1);
    expect(controller.get(request.id)?.status).toBe("timeout");
    expect(controller.getPending()).toHaveLength(0);
    expect(onTimeout).toHaveBeenCalledTimes(1);
    expect(onTimeout.mock.calls[0]?.[0]?.status).toBe("timeout");
    // The fired timer must not still be registered (no leak, no double-fire).
    expect(clock.pendingCount).toBe(0);
  });

  it("does not time out a request that was answered before the deadline", () => {
    const clock = new FakeClock();
    const onTimeout = vi.fn();
    const controller = new PermissionsController({ clock, defaultTimeoutMs: 1000, onTimeout });
    const request = extensionDialogRequest("confirm");
    controller.ingestRequest("agt_x", request);
    controller.answer(request.id, buildQuestionAnswerResponse({ Response: "Yes" }));
    expect(clock.pendingCount).toBe(0); // answering must clear the scheduled timeout

    clock.advance(5000);
    expect(controller.get(request.id)?.status).toBe("answered");
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it("refuses to answer a request that already timed out", () => {
    const clock = new FakeClock();
    const controller = new PermissionsController({ clock, defaultTimeoutMs: 100 });
    const request = extensionDialogRequest("editor");
    controller.ingestRequest("agt_x", request);
    clock.advance(100);
    expect(controller.get(request.id)?.status).toBe("timeout");

    const wireResponse = controller.answer(
      request.id,
      buildQuestionAnswerResponse({ Response: "too late" }),
    );
    expect(wireResponse).toBeNull();
    expect(controller.get(request.id)?.status).toBe("timeout");
  });

  it("reconciles a late daemon resolution even after a client-side timeout", () => {
    const clock = new FakeClock();
    const controller = new PermissionsController({ clock, defaultTimeoutMs: 100 });
    const request = extensionDialogRequest("select");
    controller.ingestRequest("agt_x", request);
    clock.advance(100);
    expect(controller.get(request.id)?.status).toBe("timeout");

    controller.applyResolution("agt_x", request.id, { behavior: "deny", message: "timed out" });
    const entry = controller.get(request.id);
    expect(entry?.status).toBe("answered");
    expect(entry?.resolution).toEqual({ behavior: "deny", message: "timed out" });
  });

  it("never schedules a timeout when defaultTimeoutMs is omitted", () => {
    const clock = new FakeClock();
    const controller = new PermissionsController({ clock });
    controller.ingestRequest("agt_x", extensionDialogRequest("input"));
    expect(clock.pendingCount).toBe(0);
    clock.advance(1_000_000);
    expect(controller.get("ext_dialog_input_0001")?.status).toBe("pending");
  });

  it("dispose() clears every scheduled timer so a torn-down controller never leaks callbacks", () => {
    const clock = new FakeClock();
    const onTimeout = vi.fn();
    const controller = new PermissionsController({ clock, defaultTimeoutMs: 1000, onTimeout });
    controller.ingestRequest("agt_x", extensionDialogRequest("select"));
    controller.ingestRequest("agt_x", extensionDialogRequest("confirm"));
    expect(clock.pendingCount).toBe(2);

    controller.dispose();
    expect(clock.pendingCount).toBe(0);

    clock.advance(5000);
    expect(onTimeout).not.toHaveBeenCalled();

    // Idempotent: disposing twice must not throw.
    expect(() => controller.dispose()).not.toThrow();
  });

  it("subscribers are notified on request, answer, and timeout, and can unsubscribe", () => {
    const clock = new FakeClock();
    const controller = new PermissionsController({ clock, defaultTimeoutMs: 1000 });
    const listener = vi.fn();
    const unsubscribe = controller.subscribe(listener);

    controller.ingestRequest("agt_x", extensionDialogRequest("input"));
    expect(listener).toHaveBeenCalledTimes(1);

    controller.answer("ext_dialog_input_0001", buildDenyResponse());
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    controller.ingestRequest("agt_x", extensionDialogRequest("confirm"));
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
