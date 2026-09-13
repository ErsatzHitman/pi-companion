import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import * as core from "@picompanion/frontend-core";

/**
 * The T64 `pi_queue_update` signal seam, pinned as documentation rather
 * than wiring — the "else" branch of its own close.
 *
 * The session route (`app/h/[serverId]/session/[agentId]/index.tsx`)
 * derives `turnRunning` from the LOCAL `createTurnRunningSignal`
 * (`../sessions/turn-running-signal.ts`), OR'd with the Send-tap
 * `submitting` overlap (`index.test.ts` pins both halves). The question
 * this close asked was whether `frontend-core` now owns a queue-update
 * / turn-running signal this route should read instead: measured
 * against the real package exports (below), it does not, so there is
 * nothing to wire and the local signal stays the one true source. If a
 * future `frontend-core` change adds one, the scan below fails loudly
 * on purpose — that failure is the prompt to wire the route to it, not
 * a stale pin to delete.
 *
 * The same close covers the terminal route's honest fallback, which
 * sits in `terminal-screen.tsx` (not in the session route): the
 * "Terminal unavailable" `EmptyState` renders only when no available
 * webview port is injected — a conditional fallback, not an
 * unconditional one — and the terminal route injects the real
 * `core.terminalWebview` plus a real `createTerminalTransport`
 * (`terminal/[terminalId].test.ts` pins both props). What is pinned
 * here is the screen side of that contract: the fallback stays gated
 * on the injected port, so a future edit cannot silently make the
 * terminal unconditionally unavailable again.
 *
 * Source-text half follows `index.test.ts`'s `readCode()` convention
 * (`terminal-screen.tsx` reaches `react-native`): comments are stripped
 * first so prose naming these symbols cannot keep a deleted fallback
 * green.
 */
function readScreenSource(): string {
  return readFileSync(fileURLToPath(new URL("./terminal-screen.tsx", import.meta.url)), "utf8");
}

function readScreenCode(): string {
  return readScreenSource()
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

/** Export names that would mean `frontend-core` now owns the queue-update signal. */
const QUEUE_SIGNAL_EXPORT_PATTERN = /turn.?running|queue.?signal|queue.?update|turn.?signal/i;

function collectExportNames(scope: Record<string, unknown>): string[] {
  return Object.keys(scope);
}

describe("T64 signal seam: frontend-core owns no queue-update signal, so the local one stands", () => {
  it("no top-level frontend-core export matches the queue-signal shape", () => {
    const matches = collectExportNames(core as unknown as Record<string, unknown>).filter((name) =>
      QUEUE_SIGNAL_EXPORT_PATTERN.test(name),
    );
    expect(matches).toEqual([]);
  });

  it("no sessions-namespace export matches it either — the likeliest home for one", () => {
    const sessions = (core as unknown as { sessions?: Record<string, unknown> }).sessions;
    expect(sessions, "frontend-core should still export a sessions namespace").toBeDefined();
    const matches = collectExportNames(sessions ?? {}).filter((name) =>
      QUEUE_SIGNAL_EXPORT_PATTERN.test(name),
    );
    expect(matches).toEqual([]);
  });
});

describe("terminal honest fallback: conditional on the injected port, never unconditional", () => {
  it("keeps the disconnected-transport default for callers that pass nothing", () => {
    expect(readScreenCode()).toMatch(
      /transport \?\? createNotConnectedTerminalBinaryTransport\(\)/,
    );
  });

  it("keeps the unavailable-webview default for callers that pass nothing", () => {
    expect(readScreenCode()).toMatch(/webview \?\? createUnavailableTerminalWebViewPort\(\)/);
  });

  it("renders 'Terminal unavailable' only when the resolved webview is unavailable or unbindable", () => {
    expect(readScreenCode()).toMatch(
      /if \(!resolvedWebview\.isAvailable \|\| !resolvedWebview\.attachHost\)/,
    );
  });
});
