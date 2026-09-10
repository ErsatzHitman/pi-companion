/**
 * T334 — drives `scripted-pi.mjs`'s `createScriptedPi` in-process with a
 * captured output sink and a manual timer, and once as a real child
 * process, so the daemon-facing contract the stub promises in its header
 * is pinned here rather than discovered on an emulator.
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  APPROVAL_DIALOGS,
  DEFAULT_APPROVAL_GAP_MS,
  DEFAULT_SCRIPTED_PI_SCENARIO,
  PIUI_MARKER,
  SCRIPTED_PI_SCENARIOS,
  SCRIPTED_PI_SCENARIO_ENV,
  SCRIPTED_PI_SESSION_ID,
  SCRIPTED_PI_VERSION_LINE,
  SHEETS_FORM_ELEMENT,
  SHEETS_PANEL_ELEMENT,
  SHEETS_ROSTER_ELEMENT,
  createScriptedPi,
  normalizeScenario,
  piUiSetMessage,
} from "./scripted-pi.mjs";

const STUB_PATH = fileURLToPath(new URL("./scripted-pi.mjs", import.meta.url));

interface Frame {
  type: string;
  id?: string;
  command?: string;
  success?: boolean;
  data?: Record<string, unknown>;
  error?: string;
  method?: string;
  message?: unknown;
  [key: string]: unknown;
}

interface ManualTimer {
  schedule: (fn: () => void, ms: number) => void;
  /** Runs every scheduled callback whose delay is <= `upToMs`, in order. */
  advance: (upToMs: number) => void;
  pending: () => number[];
}

function manualTimer(): ManualTimer {
  const queue: Array<{ fn: () => void; ms: number }> = [];
  return {
    schedule: (fn, ms) => {
      queue.push({ fn, ms });
    },
    advance: (upToMs) => {
      for (;;) {
        const index = queue.findIndex((entry) => entry.ms <= upToMs);
        if (index === -1) return;
        const [entry] = queue.splice(index, 1);
        entry!.fn();
      }
    },
    pending: () => queue.map((entry) => entry.ms),
  };
}

function harness(scenario?: string) {
  const frames: Frame[] = [];
  const timer = manualTimer();
  const pi = createScriptedPi({
    scenario,
    write: (line: string) => {
      for (const raw of line.split("\n")) {
        if (raw.trim()) frames.push(JSON.parse(raw) as Frame);
      }
    },
    schedule: timer.schedule,
  });
  const send = (frame: Record<string, unknown>) => pi.handleLine(JSON.stringify(frame));
  const responses = () => frames.filter((frame) => frame.type === "response");
  const events = () => frames.filter((frame) => frame.type !== "response");
  return { pi, frames, timer, send, responses, events };
}

describe("scripted-pi: scenario selection", () => {
  it("defaults to echo and accepts exactly the three documented scenarios", () => {
    expect(SCRIPTED_PI_SCENARIOS).toEqual(["echo", "approval", "extension-sheets"]);
    expect(normalizeScenario(undefined)).toBe(DEFAULT_SCRIPTED_PI_SCENARIO);
    expect(normalizeScenario("nonsense")).toBe("echo");
    expect(normalizeScenario("approval")).toBe("approval");
    expect(normalizeScenario("extension-sheets")).toBe("extension-sheets");
    expect(SCRIPTED_PI_SCENARIO_ENV).toBe("PICOMPANION_SCRIPTED_PI_SCENARIO");
  });
});

describe("scripted-pi: the daemon's startup RPCs", () => {
  it("answers get_state with the fields PiSessionState requires, under the stub's own session id", () => {
    const { send, responses } = harness();
    send({ id: "req_1", type: "get_state" });
    const [reply] = responses();
    expect(reply).toMatchObject({
      type: "response",
      id: "req_1",
      command: "get_state",
      success: true,
    });
    expect(reply!.data).toMatchObject({
      sessionId: SCRIPTED_PI_SESSION_ID,
      thinkingLevel: "off",
      isStreaming: false,
      isCompacting: false,
      messageCount: 0,
      pendingMessageCount: 0,
      steeringMode: "one-at-a-time",
      followUpMode: "one-at-a-time",
    });
  });

  it("answers every probe the provider makes right after construction", () => {
    const { send, responses } = harness();
    send({ id: "a", type: "get_commands" });
    send({ id: "b", type: "get_session_stats" });
    send({ id: "c", type: "get_entries" });
    send({ id: "d", type: "get_available_models" });
    send({ id: "e", type: "get_messages" });
    const byId = new Map(responses().map((reply) => [reply.id, reply]));
    expect(byId.get("a")!.data).toEqual({ commands: [] });
    expect(byId.get("b")!.data).toMatchObject({ tokens: { total: 0 }, cost: 0 });
    expect(byId.get("c")!.data).toEqual({ entries: [] });
    expect((byId.get("d")!.data as { models: unknown[] }).models).toHaveLength(1);
    expect(byId.get("e")!.data).toEqual({ messages: [] });
    for (const reply of byId.values()) expect(reply.success).toBe(true);
  });

  it("fails an unknown command with success:false rather than hanging the daemon's 30s timeout", () => {
    const { send, responses } = harness();
    send({ id: "x", type: "get_tree" });
    expect(responses()).toEqual([
      expect.objectContaining({
        id: "x",
        success: false,
        error: expect.stringContaining("get_tree"),
      }),
    ]);
  });

  it("ignores blank lines, non-JSON, and frames without an id or type", () => {
    const { pi, frames } = harness();
    pi.handleLine("");
    pi.handleLine("   ");
    pi.handleLine("not json");
    pi.handleLine(JSON.stringify({ type: "get_state" }));
    pi.handleLine(JSON.stringify([1, 2]));
    expect(frames).toEqual([]);
  });
});

describe("scripted-pi: echo turns", () => {
  it("acks a prompt with agentInvoked:true BEFORE any event, then runs a complete turn ending in agent_settled", () => {
    const { send, frames, timer, events } = harness("echo");
    send({ id: "req_9", type: "prompt", message: "hello" });
    // The ack is synchronous; the turn waits for the next tick.
    expect(frames).toEqual([
      expect.objectContaining({ type: "response", id: "req_9", data: { agentInvoked: true } }),
    ]);
    timer.advance(0);
    expect(events().map((event) => event.type)).toEqual([
      "agent_start",
      "turn_start",
      "message_start",
      "message_update",
      "message_end",
      "turn_end",
      "agent_end",
      "agent_settled",
    ]);
    const end = events().find((event) => event.type === "message_end")!;
    expect(end.message).toEqual({
      role: "assistant",
      content: [{ type: "text", text: "Scripted pi heard: hello" }],
    });
  });

  it("acks a /pi_ui_event prompt with agentInvoked:false and starts no turn", () => {
    const { send, frames, timer } = harness("echo");
    send({ id: "req_2", type: "prompt", message: "/pi_ui_event eyJ4IjoxfQ" });
    timer.advance(0);
    expect(frames).toEqual([
      expect.objectContaining({ id: "req_2", data: { agentInvoked: false } }),
    ]);
  });

  it("counts messages so get_state reflects the turns that ran", () => {
    const { send, timer, responses } = harness("echo");
    send({ id: "p", type: "prompt", message: "one" });
    timer.advance(0);
    send({ id: "s", type: "get_state" });
    expect(responses().find((reply) => reply.id === "s")!.data).toMatchObject({ messageCount: 2 });
  });
});

describe("scripted-pi: approval scenario", () => {
  it("raises a confirm dialog after turn_start and holds the turn open until the client answers", () => {
    const { send, timer, events } = harness("approval");
    send({ id: "p", type: "prompt", message: "run it" });
    timer.advance(0);
    expect(events().map((event) => event.type)).toEqual([
      "agent_start",
      "turn_start",
      "extension_ui_request",
    ]);
    const request = events()[2]!;
    expect(request).toMatchObject({
      id: APPROVAL_DIALOGS[0]!.id,
      method: "confirm",
      title: APPROVAL_DIALOGS[0]!.title,
      message: APPROVAL_DIALOGS[0]!.message,
    });
  });

  it("raises the second dialog only after the gap, once the first is answered (deny or approve), and ends the turn on the second answer", () => {
    const { send, timer, events } = harness("approval");
    send({ id: "p", type: "prompt", message: "run it" });
    timer.advance(0);
    // Deny the first: what respondToExtensionUiRequest sends for a deny.
    send({ type: "extension_ui_response", id: APPROVAL_DIALOGS[0]!.id, cancelled: true });
    expect(events().filter((event) => event.type === "extension_ui_request")).toHaveLength(1);
    expect(timer.pending()).toEqual([DEFAULT_APPROVAL_GAP_MS]);
    timer.advance(DEFAULT_APPROVAL_GAP_MS);
    const requests = events().filter((event) => event.type === "extension_ui_request");
    expect(requests).toHaveLength(2);
    expect(requests[1]).toMatchObject({ id: APPROVAL_DIALOGS[1]!.id, method: "confirm" });
    expect(events().some((event) => event.type === "agent_settled")).toBe(false);
    // Approve the second: the turn completes.
    send({ type: "extension_ui_response", id: APPROVAL_DIALOGS[1]!.id, confirmed: true });
    const types = events().map((event) => event.type);
    expect(types.slice(-3)).toEqual(["turn_end", "agent_end", "agent_settled"]);
    const end = events().find((event) => event.type === "message_end")!;
    expect((end.message as { content: Array<{ text: string }> }).content[0]!.text).toContain(
      "approved",
    );
  });

  it("ignores an extension_ui_response for a dialog it never raised", () => {
    const { send, frames } = harness("approval");
    send({ type: "extension_ui_response", id: "someone-elses", confirmed: true });
    expect(frames).toEqual([]);
  });
});

describe("scripted-pi: extension-sheets scenario", () => {
  function piuiPayloads(frames: Frame[]) {
    return frames
      .filter((frame) => frame.type === "extension_ui_request" && frame.method === "notify")
      .map((frame) => {
        const message = frame.message as string;
        expect(message.startsWith(PIUI_MARKER)).toBe(true);
        return JSON.parse(message.slice(PIUI_MARKER.length)) as {
          v: number;
          op: string;
          el: Record<string, unknown>;
        };
      });
  }

  it("a plain prompt raises the pinned roster and the pinned panel as PIUI set notifies, then finishes the turn", () => {
    const { send, timer, events } = harness("extension-sheets");
    send({ id: "p", type: "prompt", message: "show me the fleet" });
    timer.advance(0);
    const payloads = piuiPayloads(events());
    expect(payloads.map((payload) => [payload.v, payload.op])).toEqual([
      [1, "set"],
      [1, "set"],
    ]);
    expect(payloads[0]!.el).toEqual(SHEETS_ROSTER_ELEMENT);
    expect(payloads[1]!.el).toEqual(SHEETS_PANEL_ELEMENT);
    expect(events().at(-1)!.type).toBe("agent_settled");
  });

  it("a prompt containing the word form raises the pinned form instead, and nothing else", () => {
    const { send, timer, events } = harness("extension-sheets");
    send({ id: "p", type: "prompt", message: "now the form please" });
    timer.advance(0);
    const payloads = piuiPayloads(events());
    expect(payloads).toHaveLength(1);
    expect(payloads[0]!.el).toEqual(SHEETS_FORM_ELEMENT);
  });

  it("the three elements carry exactly the ids the extension-sheets flow asserts on", () => {
    // `pi-roster-${ns}-${id}`, `pi-panel-${ns}-${id}`, `pi-form-${ns}-${id}`
    // (extension-sheets-contract.ts) -- and every notify carries the marker.
    expect(`${SHEETS_ROSTER_ELEMENT.ns}-${SHEETS_ROSTER_ELEMENT.id}`).toBe("subagents-fleet");
    expect(`${SHEETS_PANEL_ELEMENT.ns}-${SHEETS_PANEL_ELEMENT.id}`).toBe("loop-loop");
    expect(`${SHEETS_FORM_ELEMENT.ns}-${SHEETS_FORM_ELEMENT.id}`).toBe("ask-user-confirm");
    expect(SHEETS_ROSTER_ELEMENT.placement).toBe("pinned");
    expect(SHEETS_PANEL_ELEMENT.placement).toBe("pinned");
    expect(SHEETS_FORM_ELEMENT.placement).toBe("pinned");
    // The roster row has an action (the flow taps `-action-.*`); the form's
    // one action is primary (validation runs) and its one field required.
    expect(SHEETS_ROSTER_ELEMENT.payload.rows[0]!.actions!.length).toBeGreaterThan(0);
    expect(SHEETS_FORM_ELEMENT.actions[0]!.variant).toBe("primary");
    expect(SHEETS_FORM_ELEMENT.payload.fields[0]!.required).toBe(true);
    expect(SHEETS_PANEL_ELEMENT.payload.sections.length).toBeGreaterThan(0);
    expect(piUiSetMessage(SHEETS_ROSTER_ELEMENT)).toMatch(/^PIUI \{"v":1,"op":"set","el":/);
  });
});

describe("scripted-pi: as the executable the daemon spawns", () => {
  it("prints a version line for --version and exits 0", async () => {
    const result = await runStub(["--version"]);
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe(SCRIPTED_PI_VERSION_LINE);
  });

  it("speaks JSONL over stdio: a get_state request on stdin gets its response on stdout, and stdin EOF exits 0", async () => {
    const result = await runStub(["--mode", "rpc", "--no-session"], {
      stdin: `${JSON.stringify({ id: "req_1", type: "get_state" })}\n`,
      env: { [SCRIPTED_PI_SCENARIO_ENV]: "approval" },
    });
    expect(result.code).toBe(0);
    const lines = result.stdout.split("\n").filter((line) => line.trim());
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({
      type: "response",
      id: "req_1",
      success: true,
      data: { sessionId: SCRIPTED_PI_SESSION_ID },
    });
    expect(result.stderr).toContain("scenario=approval");
  });
});

function runStub(
  argv: string[],
  options: { stdin?: string; env?: Record<string, string> } = {},
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [STUB_PATH, ...argv], {
      env: { ...process.env, ...options.env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, stdout, stderr }));
    if (options.stdin !== undefined) child.stdin.write(options.stdin);
    child.stdin.end();
  });
}
