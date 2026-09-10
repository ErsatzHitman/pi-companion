#!/usr/bin/env node
/**
 * T334 — a scripted stand-in for the `pi` binary, spoken to over the same
 * JSONL RPC the daemon's Pi provider uses for the real thing
 * (`packages/server/src/server/agent/providers/pi/cli-runtime.ts` and
 * `providers/jsonl-rpc-process.ts`: one JSON object per stdout line, a
 * request `{id, type, ...}` on stdin answered by `{type: "response", id,
 * command, success, data | error}`, every other stdout line an event).
 *
 * Why it exists: Maestro run 34462826449 was the first dispatch to reach
 * the "New session" form with a client that could actually submit it, and
 * it showed the next wall plainly -- the isolated daemon `run-flow.ts`
 * starts has no `pi` on its PATH, so `notification-approval` and
 * `extension-sheets` could never see a permission request or a roster
 * element, and `cold-start-restore` could never open a session at all.
 * A real Pi needs real model credentials this harness's throwaway home
 * never provisions. This file needs nothing: it answers every startup
 * RPC the provider makes (`get_state`, `get_commands`,
 * `get_session_stats`, `get_entries`, `get_available_models`), runs a
 * short scripted turn for every prompt, and -- per scenario -- raises the
 * exact `extension_ui_request` frames a real extension would, so the
 * daemon's own code (not a test double) turns them into
 * `agent_permission_request` and `pi_ui_delta` messages the app renders.
 *
 * Provisioning (`scripted-pi-provision.ts`): the isolated home's
 * `config.json` points `agents.providers.pi.command` at
 * `[process.execPath, <this file>]`, so the daemon spawns it exactly the
 * way it would spawn `pi --mode rpc ...`. The scenario is chosen by the
 * `PICOMPANION_SCRIPTED_PI_SCENARIO` environment variable the same
 * config's `env` block sets:
 *
 * - `echo` (default): every prompt gets a one-message assistant turn.
 * - `approval`: a prompt starts a turn and raises a `confirm` dialog;
 *   once the client answers it, a second one follows after a short gap
 *   (long enough for Maestro to see the first sheet close), and the
 *   turn ends when that one is answered. Deny arrives as
 *   `{cancelled: true}`, approve as `{confirmed: true}` -- the shapes
 *   `respondToExtensionUiRequest` sends.
 * - `extension-sheets`: a prompt raises PIUI `set` notifications for a
 *   pinned `roster` (`subagents:fleet`) and a pinned `panel`
 *   (`loop:loop`); a prompt containing the word "form" raises a pinned
 *   `form` (`ask-user:confirm`) with one required text field instead.
 *   The form comes last on purpose: `form.tsx` always opens a `Sheet`,
 *   which would cover the roster and panel cards.
 *
 * Every `/pi_ui_event ...` prompt (what the daemon sends for a
 * `pi.ui.action.request`) is acknowledged with `agentInvoked: false`, so
 * an action tap never starts a turn.
 *
 * Plain JavaScript on purpose: the daemon runs it with the same `node`
 * that runs the harness, with no build step in between, so nothing here
 * can be stale relative to a `dist` the way a compiled entry could.
 * `createScriptedPi` is the whole behaviour and takes its output sink and
 * timer as arguments, so `scripted-pi.test.ts` drives it in-process;
 * `main` only wires stdin/stdout and runs when this file is the entry
 * point.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

export const SCRIPTED_PI_SCENARIO_ENV = "PICOMPANION_SCRIPTED_PI_SCENARIO";
export const SCRIPTED_PI_APPROVAL_GAP_ENV = "PICOMPANION_SCRIPTED_PI_APPROVAL_GAP_MS";
export const SCRIPTED_PI_SCENARIOS = Object.freeze(["echo", "approval", "extension-sheets"]);
export const DEFAULT_SCRIPTED_PI_SCENARIO = "echo";
/** Gap between the approval scenario's two dialogs; see the header. */
export const DEFAULT_APPROVAL_GAP_MS = 1500;
export const SCRIPTED_PI_SESSION_ID = "scripted-pi-session";
export const SCRIPTED_PI_VERSION_LINE = "scripted-pi 0.0.0-e2e (apps/android/e2e/harness)";
export const PIUI_MARKER = "PIUI ";

export const SCRIPTED_PI_MODEL = Object.freeze({
  provider: "scripted",
  id: "scripted-pi",
  name: "Scripted Pi (e2e)",
  reasoning: false,
  contextWindow: 200_000,
  maxTokens: 8_192,
});

/** The roster the `extension-sheets` flow asserts as `pi-roster-subagents-fleet`. */
export const SHEETS_ROSTER_ELEMENT = Object.freeze({
  id: "fleet",
  ns: "subagents",
  kind: "roster",
  placement: "pinned",
  title: "Subagent fleet",
  payload: {
    kind: "roster",
    rows: [
      {
        id: "research",
        label: "research",
        state: "running",
        detail: "reading the plan",
        actions: [{ id: "open", label: "Open" }],
      },
    ],
  },
});

/** The panel the `extension-sheets` flow asserts as `pi-panel-loop-loop`. */
export const SHEETS_PANEL_ELEMENT = Object.freeze({
  id: "loop",
  ns: "loop",
  kind: "panel",
  placement: "pinned",
  title: "Loop",
  payload: {
    kind: "panel",
    sections: [
      {
        id: "progress",
        ns: "loop",
        kind: "status",
        title: "Progress",
        payload: { kind: "status", text: "Iteration 3 of 10", tone: "accent" },
      },
    ],
  },
});

/**
 * The form the `extension-sheets` flow asserts as `pi-form-ask-user-confirm`.
 * One required text field, one `primary` action: `form-model.ts` only
 * validates on a primary action, and the flow's first submit must fail
 * with "Fix 1 field before submitting." before the typed value passes.
 */
export const SHEETS_FORM_ELEMENT = Object.freeze({
  id: "confirm",
  ns: "ask-user",
  kind: "form",
  placement: "pinned",
  title: "Confirm the host",
  actions: [{ id: "submit", label: "Submit", variant: "primary" }],
  payload: {
    kind: "form",
    description: "Which host should the scripted extension use?",
    fields: [{ kind: "text", id: "host", label: "Host", required: true }],
  },
});

export const APPROVAL_DIALOGS = Object.freeze([
  Object.freeze({
    id: "scripted-approval-1",
    title: "Run a shell command?",
    message: "The scripted extension wants to run `echo hello`.",
  }),
  Object.freeze({
    id: "scripted-approval-2",
    title: "Write a file?",
    message: "The scripted extension wants to write `notes.md`.",
  }),
]);

export function normalizeScenario(value) {
  return SCRIPTED_PI_SCENARIOS.includes(value) ? value : DEFAULT_SCRIPTED_PI_SCENARIO;
}

export function piUiSetMessage(element) {
  return `${PIUI_MARKER}${JSON.stringify({ v: 1, op: "set", el: element })}`;
}

function assistantMessage(text) {
  return { role: "assistant", content: [{ type: "text", text }] };
}

/**
 * @param {{
 *   scenario?: string,
 *   write: (line: string) => void,
 *   schedule?: (fn: () => void, ms: number) => unknown,
 *   approvalGapMs?: number,
 * }} options
 */
export function createScriptedPi(options) {
  const scenario = normalizeScenario(options.scenario);
  const write = options.write;
  const schedule = options.schedule ?? ((fn, ms) => setTimeout(fn, ms));
  const approvalGapMs = options.approvalGapMs ?? DEFAULT_APPROVAL_GAP_MS;

  let messageCount = 0;
  let nextUiRequestSerial = 1;
  /** Approval scenario: dialog ids raised and not yet answered. */
  const openDialogs = new Map();

  function emit(frame) {
    write(`${JSON.stringify(frame)}\n`);
  }
  function respond(id, command, data) {
    emit({ type: "response", id, command, success: true, data });
  }
  function fail(id, command, error) {
    emit({ type: "response", id, command, success: false, error });
  }

  function state() {
    return {
      model: { ...SCRIPTED_PI_MODEL },
      thinkingLevel: "off",
      isStreaming: false,
      isCompacting: false,
      steeringMode: "one-at-a-time",
      followUpMode: "one-at-a-time",
      autoCompactionEnabled: false,
      sessionId: SCRIPTED_PI_SESSION_ID,
      messageCount,
      pendingMessageCount: 0,
      contextUsage: { tokens: 0, contextWindow: SCRIPTED_PI_MODEL.contextWindow, percent: 0 },
    };
  }

  function notify(message) {
    emit({
      type: "extension_ui_request",
      id: `scripted-notify-${nextUiRequestSerial++}`,
      method: "notify",
      message,
    });
  }

  function finishTurn(text) {
    const message = assistantMessage(text);
    messageCount += 2;
    emit({ type: "message_start", message: assistantMessage("") });
    emit({
      type: "message_update",
      message,
      assistantMessageEvent: { type: "text_delta", delta: text },
    });
    emit({ type: "message_end", message });
    emit({ type: "turn_end", message });
    emit({ type: "agent_end", messages: [message] });
    emit({ type: "agent_settled" });
  }

  function startTurn() {
    emit({ type: "agent_start" });
    emit({ type: "turn_start" });
  }

  function raiseDialog(index) {
    const dialog = APPROVAL_DIALOGS[index];
    openDialogs.set(dialog.id, index);
    emit({
      type: "extension_ui_request",
      id: dialog.id,
      method: "confirm",
      title: dialog.title,
      message: dialog.message,
    });
  }

  function runScriptedTurn(prompt) {
    startTurn();
    if (scenario === "approval") {
      raiseDialog(0);
      return;
    }
    if (scenario === "extension-sheets") {
      if (/\bform\b/i.test(prompt)) {
        notify(piUiSetMessage(SHEETS_FORM_ELEMENT));
        finishTurn("Raised the confirm form.");
      } else {
        notify(piUiSetMessage(SHEETS_ROSTER_ELEMENT));
        notify(piUiSetMessage(SHEETS_PANEL_ELEMENT));
        finishTurn("Raised the fleet roster and the loop panel.");
      }
      return;
    }
    finishTurn(`Scripted pi heard: ${prompt}`);
  }

  function handleExtensionUiResponse(frame) {
    const index = openDialogs.get(frame.id);
    if (index === undefined) return;
    openDialogs.delete(frame.id);
    if (index + 1 < APPROVAL_DIALOGS.length) {
      schedule(() => raiseDialog(index + 1), approvalGapMs);
      return;
    }
    const outcome = frame.confirmed === true ? "approved" : "denied";
    finishTurn(`Scripted pi saw the last approval ${outcome}.`);
  }

  function handleCommand(frame) {
    const { id, type } = frame;
    switch (type) {
      case "get_state":
        respond(id, type, state());
        return;
      case "get_commands":
        respond(id, type, { commands: [] });
        return;
      case "get_session_stats":
        respond(id, type, {
          tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          cost: 0,
          contextUsage: { tokens: 0, contextWindow: SCRIPTED_PI_MODEL.contextWindow, percent: 0 },
        });
        return;
      case "get_entries":
        respond(id, type, { entries: [] });
        return;
      case "get_messages":
        respond(id, type, { messages: [] });
        return;
      case "get_available_models":
        respond(id, type, { models: [{ ...SCRIPTED_PI_MODEL }] });
        return;
      case "set_model":
        respond(id, type, { ...SCRIPTED_PI_MODEL });
        return;
      case "prompt": {
        const message = typeof frame.message === "string" ? frame.message : "";
        if (message.startsWith("/pi_ui_event")) {
          respond(id, type, { agentInvoked: false });
          return;
        }
        respond(id, type, { agentInvoked: true });
        // The ack goes out before any event, the way a real Pi orders them.
        schedule(() => runScriptedTurn(message), 0);
        return;
      }
      case "steer":
      case "follow_up":
      case "abort":
      case "compact":
      case "set_thinking_level":
      case "set_auto_compaction":
      case "set_steering_mode":
      case "set_follow_up_mode":
      case "set_auto_retry":
      case "set_session_name":
        respond(id, type, {});
        return;
      default:
        fail(id, type ?? "request", `scripted-pi: unknown command ${String(type)}`);
    }
  }

  function handleLine(line) {
    const trimmed = line.trim();
    if (!trimmed) return;
    let frame;
    try {
      frame = JSON.parse(trimmed);
    } catch {
      return;
    }
    if (!frame || typeof frame !== "object" || Array.isArray(frame)) return;
    if (frame.type === "extension_ui_response") {
      handleExtensionUiResponse(frame);
      return;
    }
    if (typeof frame.id !== "string" || typeof frame.type !== "string") return;
    handleCommand(frame);
  }

  return { scenario, handleLine };
}

export function main(argv = process.argv.slice(2), env = process.env) {
  if (argv.includes("--version")) {
    process.stdout.write(`${SCRIPTED_PI_VERSION_LINE}\n`);
    return;
  }
  const gap = Number(env[SCRIPTED_PI_APPROVAL_GAP_ENV]);
  const pi = createScriptedPi({
    scenario: env[SCRIPTED_PI_SCENARIO_ENV],
    write: (line) => process.stdout.write(line),
    approvalGapMs: Number.isFinite(gap) && gap >= 0 ? gap : DEFAULT_APPROVAL_GAP_MS,
  });
  process.stderr.write(`[scripted-pi] scenario=${pi.scenario} pid=${process.pid}\n`);
  let buffer = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    buffer += chunk;
    let newline = buffer.indexOf("\n");
    while (newline !== -1) {
      pi.handleLine(buffer.slice(0, newline));
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf("\n");
    }
  });
  process.stdin.on("end", () => {
    if (buffer.trim()) pi.handleLine(buffer);
    process.exit(0);
  });
}

// Entry-point check that survives Windows drive-letter casing and
// separators: both sides go through `path.resolve`.
const invokedDirectly =
  typeof process.argv[1] === "string" &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  main();
}
