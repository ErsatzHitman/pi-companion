import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * T39C source-level proof that `Composer.tsx` actually mounts
 * `QueueModePicker`/`TurnStatusBanner` and wires them to
 * `queueModeClient`/`turnStatusClient` — the acceptance criterion
 * "where no live client is reachable, a truthful unavailable state
 * renders" needs proof at the MOUNT, not only inside
 * `QueueModePicker.test.ts`/`TurnStatusBanner.test.ts`'s own isolated
 * view tests (T39B left this gap for its own `ModelThinkingPicker`
 * mount — `grep -rn modelThinkingClient apps/android` before this task
 * found no test covering it — so this file closes the same gap for its
 * own two new mounts rather than repeating it a third time).
 *
 * `Composer.tsx` imports `react-native` directly, so it cannot be
 * rendered under this workspace's plain `vitest` setup (the same
 * RolldownError constraint every `*.test.ts` in this directory that
 * reads `.tsx` source cites) — this statically verifies the wiring a
 * render pass would otherwise check, same `readCode()` helper
 * `composer-accessibility.test.ts` already uses on this same file.
 *
 * Every assertion below was mutation-checked by hand (delete the real
 * construct, re-run this file, confirm the specific `it` fails, restore
 * byte-identically). See this task's (T39C) report for the run log.
 */
function readSource(): string {
  return readFileSync(fileURLToPath(new URL("./Composer.tsx", import.meta.url)), "utf8");
}

function readCode(): string {
  return readSource()
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

describe("Composer.tsx: mounts QueueModePicker, wired to queueModeClient through a real controller", () => {
  it("destructures queueModeClient as a ComposerProps field", () => {
    expect(readCode()).toMatch(/queueModeClient\?: DaemonQueueModeSource;/);
  });

  it("builds a queueModesController from { agentId: resolvedSessionId, client: queueModeClient } — never a hard-coded client", () => {
    expect(readCode()).toMatch(
      /createQueueModesController\(\{ agentId: resolvedSessionId, client: queueModeClient \}\)/,
    );
  });

  it("calls controller.load() once per controller identity, mirroring its own state back with setQueueModesState", () => {
    const code = readCode();
    expect(code).toMatch(/void queueModesController\.load\(\)\.then\(\(\) => \{/);
    expect(code).toMatch(/setQueueModesState\(queueModesController\.getState\(\)\)/);
  });

  it("renders <QueueModePicker> with state from queueModesState, not a locally re-derived value", () => {
    const code = readCode();
    expect(code).toMatch(/<QueueModePicker\s*\n\s*state=\{queueModesState\}/);
    expect(code).toMatch(/onSelectSteeringMode=\{handleSelectSteeringMode\}/);
    expect(code).toMatch(/onSelectFollowUpMode=\{handleSelectFollowUpMode\}/);
  });

  it("handleSelectSteeringMode/handleSelectFollowUpMode call the controller's own setters, not a private re-implementation", () => {
    const code = readCode();
    expect(code).toMatch(/queueModesController\s*\n\s*\.setSteeringMode\(mode\)/);
    expect(code).toMatch(/queueModesController\s*\n\s*\.setFollowUpMode\(mode\)/);
  });
});

describe("Composer.tsx: mounts TurnStatusBanner, wired to turnStatusClient through a real controller", () => {
  it("destructures turnStatusClient as a ComposerProps field", () => {
    expect(readCode()).toMatch(/turnStatusClient\?: DaemonTurnStatusSource;/);
  });

  it("builds a turnStatusController from { agentId: resolvedSessionId, client: turnStatusClient }", () => {
    expect(readCode()).toMatch(
      /createTurnStatusController\(\{ agentId: resolvedSessionId, client: turnStatusClient \}\)/,
    );
  });

  it("subscribes with a live onChange callback, and unsubscribes on cleanup", () => {
    const code = readCode();
    expect(code).toMatch(
      /turnStatusController\.subscribe\(\(\) => setTurnStatusState\(turnStatusController\.getState\(\)\)\);/,
    );
    expect(code).toMatch(/turnStatusController\.unsubscribe\(\);/);
  });

  it("renders <TurnStatusBanner> with state from turnStatusState", () => {
    expect(readCode()).toMatch(/<TurnStatusBanner state=\{turnStatusState\}/);
  });
});

describe("Composer.tsx: no live client wired at the real production mount today", () => {
  it("never assigns queueModeClient/turnStatusClient a real DaemonClient inline — both stay caller-supplied props with no default value", () => {
    const code = readCode();
    // The only two appearances of each identifier outside the doc comments
    // are: (1) the ComposerProps field declaration, (2) the destructured
    // parameter, (3) the controller constructor call. None of those three
    // sites assigns a fallback value (no `??`), unlike e.g. `sessionId ??
    // "local"` elsewhere in this file — omitting either prop leaves the
    // corresponding controller's `client` genuinely `undefined`, which is
    // exactly what drives `supportsQueueModes(undefined) === false` /
    // `typeof client?.on === "function" === false` and the truthful
    // unavailable render — proven in `queue-mode-model.test.ts`'s and
    // `turn-status-model.test.ts`'s "no-client" cases.
    expect(code).not.toMatch(/queueModeClient\s*\?\?/);
    expect(code).not.toMatch(/turnStatusClient\s*\?\?/);
  });
});
