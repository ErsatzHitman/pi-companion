import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * `AppCoreProvider` teardown coverage — the production caller of
 * `AppCore.shutdown()` (T74).
 *
 * Source-level contract test, same reason as
 * `h/[serverId]/session/[agentId]/index.test.ts`: this module reaches
 * `expo-router` (and transitively everything `createAppCore()` builds),
 * so nothing in it can be imported and called directly under plain
 * `vitest`. `readCode()` strips comments before matching — this file's
 * own doc comment names every symbol these assertions check for, so an
 * unanchored match against the raw source would stay green even if the
 * real effect were deleted.
 *
 * Proof split, stated plainly so neither half is mistaken for the
 * whole: THIS file proves the *wiring* — the provider that owns the one
 * process-lifetime `AppCore` calls its `shutdown()` from its own
 * unmount cleanup. `../app-shell/core.test.ts`'s `AppCore.shutdown()
 * (T74)` suite proves the *effect* — a disposed
 * offline-cache/connection/turn-outbox state actually observed after
 * `shutdown()`. Wiring plus effect is what closes "dispose() is never
 * called in production".
 *
 * Teardown is unmount-only, deliberately: backgrounding must NOT shut
 * the core down (that would drop every live socket each time the user
 * switches apps), and foreground/background already has an owner —
 * `useResumeSignals`/`attachResumeSignals` feed those transitions into
 * the resume controller, which is built to survive them. A future
 * background-teardown hook belongs nowhere near this effect.
 */
function readSource(): string {
  return readFileSync(fileURLToPath(new URL("./core-context.tsx", import.meta.url)), "utf8");
}

function readCode(): string {
  return readSource()
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

describe("AppCoreProvider teardown", () => {
  it("constructs the one process-lifetime AppCore it owns in a mount-stable useMemo", () => {
    expect(readCode()).toMatch(/useMemo\(\(\) => createAppCore\(\), \[\]\)/);
  });

  it("calls core.shutdown() from its own unmount cleanup, so the shutdown path runs when the app unmounts", () => {
    expect(readCode()).toMatch(/return \(\) => \{\s*void core\.shutdown\(\);\s*\}/);
  });

  it("tears down on unmount only — no background/AppState hook shuts the core down", () => {
    const code = readCode();
    // `AppState` (React Native's foreground/background source) must not
    // appear here at all: a background transition routed into
    // `shutdown()` would drop the live daemon connection on every app
    // switch, which is exactly what `useResumeSignals` (same file)
    // exists to survive instead.
    expect(code).not.toMatch(/AppState/);
    expect(code).not.toMatch(/addEventListener/);
  });
});
