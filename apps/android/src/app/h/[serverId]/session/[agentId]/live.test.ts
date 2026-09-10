import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * `live.tsx` source-level contract test (T350) — same reason as this
 * directory's `./index.test.ts`: the route imports `expo-router` and
 * `react-native`, so it cannot be rendered under this workspace's plain
 * `vitest` setup. The behavioural proof lives in
 * `../../../../../features/live/live-screen-model.test.ts`, which runs
 * the real selection functions; what this file pins is the WIRING only
 * a route can get wrong.
 *
 * `readCode()` strips comments first, so a claim made only in the
 * route's own doc comment can never satisfy an assertion here.
 */
function readCode(): string {
  return readFileSync(fileURLToPath(new URL("./live.tsx", import.meta.url)), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

describe("SessionLiveRoute source", () => {
  it("renders LiveScreen from features/live and holds no feature logic of its own", () => {
    const code = readCode();
    expect(code).toMatch(/from "\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/features\/live"/);
    expect(code).toMatch(/<LiveScreen\b/);
  });

  it("reads this session's elements from the one shared Pi UI store, never a second subscription", () => {
    const code = readCode();
    expect(code).toMatch(/usePiUiElements\(\s*core\.piUiSession\.store,\s*agentId \?\? "",?\s*\)/);
    expect(code).toMatch(/elements=\{elements\}/);
  });

  it("re-registers this agent's timeline as viewed, so the feed does not stop when the session route unmounts", () => {
    const code = readCode();
    expect(code).toMatch(/core\.setViewedAgentTimeline\(\[agentId\]\)/);
    expect(code).toMatch(/core\.setViewedAgentTimeline\(\[\]\)/);
  });

  it("drives the bar's pill from the real turn-running signal, never a fixed literal", () => {
    const code = readCode();
    expect(code).toMatch(/createTurnRunningSignal\(/);
    expect(code).toMatch(/turnRunning=\{turnRunning\}/);
    expect(code).not.toMatch(/turnRunning=\{false\}/);
    expect(code).not.toMatch(/turnRunning=\{true\}/);
  });

  it("mounts SessionNavActions here, with this route's own serverId/agentId — the Files/Terminal controls T350 moved off the session screen", () => {
    const code = readCode();
    expect(code).toMatch(/from "\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/app-shell\/session-nav-actions"/);
    expect(code).toMatch(
      /navActions=\{<SessionNavActions serverId=\{serverId \?\? ""\} agentId=\{agentId \?\? ""\} \/>\}/,
    );
  });

  it("takes its back navigation from the real router, never a hand-built path", () => {
    const code = readCode();
    expect(code).toMatch(/const router = useRouter\(\);/);
    expect(code).toMatch(/router\.back\(\)/);
    expect(code).not.toMatch(/router\.push\("/);
  });
});
