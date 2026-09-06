import { describe, expect, it } from "vitest";
import { PiUiElementSchema, type PiUiElement } from "@picompanion/protocol/pi-ui-bridge/schema";
import type { PiRuntimeSession } from "../runtime.js";
import { PiUiActionRouter } from "./actions.js";
import { normalizePiUiElementInput } from "./payload-compat.js";
import { PiUiStateStore } from "./state.js";

const AGENT = "agent-1";

function decodeEnvelope(prompt: string): Record<string, unknown> {
  const b64 = prompt.replace("/pi_ui_event ", "");
  return JSON.parse(Buffer.from(b64, "base64url").toString("utf8")) as Record<string, unknown>;
}

function setup() {
  const prompts: string[] = [];
  const runtime = {
    prompt: async (text: string) => {
      prompts.push(text);
    },
  } as unknown as PiRuntimeSession;
  const store = new PiUiStateStore(
    () => {},
    () => {},
  );
  const router = new PiUiActionRouter(runtime, store);
  return { prompts, store, router };
}

const element = (raw: Record<string, unknown>): PiUiElement =>
  PiUiElementSchema.parse(normalizePiUiElementInput(raw));

describe("PiUiActionRouter (plan.md §4.2 composite action identity)", () => {
  it("dispatches a resolved composite identity to /pi_ui_event", async () => {
    const { prompts, store, router } = setup();
    store.applySet(
      AGENT,
      element({
        id: "main",
        ns: "loop",
        kind: "roster",
        placement: "pinned",
        rows: [{ id: "r1", label: "one", actions: [{ id: "stop", label: "Stop" }] }],
      }),
    );

    const result = await router.handleActionRequest({
      agentId: AGENT,
      elementId: "loop:main#r1",
      actionId: "stop",
      payload: { confirmed: true },
      requestId: "req-1",
    });

    expect(result).toEqual({ ok: true });
    expect(prompts).toHaveLength(1);
    expect(decodeEnvelope(prompts[0]!)).toMatchObject({
      v: 1,
      ns: "loop",
      id: "main",
      elementKey: "loop:main",
      rowId: "r1",
      actionId: "stop",
      actionKey: "loop:main#r1:stop",
      requestId: "req-1",
      value: { confirmed: true },
    });
  });

  it("refuses to dispatch an unknown element instead of guessing", async () => {
    const { prompts, router } = setup();

    const result = await router.handleActionRequest({
      agentId: AGENT,
      elementId: "loop:ghost",
      actionId: "stop",
      requestId: "req-2",
    });

    expect(result.ok).toBe(false);
    expect(prompts).toEqual([]);
  });

  it("refuses an ambiguous bare element id", async () => {
    const { prompts, store, router } = setup();
    for (const ns of ["loop", "btw"]) {
      store.applySet(
        AGENT,
        element({
          id: "main",
          ns,
          kind: "status",
          placement: "status",
          text: ns,
          actions: [{ id: "go", label: "Go" }],
        }),
      );
    }

    const result = await router.handleActionRequest({
      agentId: AGENT,
      elementId: "main",
      actionId: "go",
      requestId: "req-3",
    });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/ambiguous/i);
    expect(prompts).toEqual([]);
  });

  it("surfaces prompt failures as a failed action result", async () => {
    const store = new PiUiStateStore(
      () => {},
      () => {},
    );
    const runtime = {
      prompt: async () => {
        throw new Error("pi is down");
      },
    } as unknown as PiRuntimeSession;
    const router = new PiUiActionRouter(runtime, store);
    store.applySet(
      AGENT,
      element({ id: "main", ns: "loop", kind: "status", placement: "status", text: "x" }),
    );

    const result = await router.handleActionRequest({
      agentId: AGENT,
      elementId: "loop:main",
      actionId: "anything",
      requestId: "req-4",
    });

    expect(result).toEqual({ ok: false, error: "pi is down" });
  });
});
