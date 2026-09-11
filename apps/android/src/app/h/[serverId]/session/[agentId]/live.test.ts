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

  it("T385: threads the signal's own turn-start timestamp to LiveScreen, so the elapsed reading is real", () => {
    const code = readCode();
    expect(code).toMatch(
      /const \[turnStartedAtMs, setTurnStartedAtMs\] = useState<number \| null>\(null\);/,
    );
    expect(code).toMatch(/setTurnStartedAtMs\(signal\.getStartedAtMs\(\)\);/);
    expect(code).toMatch(/turnStartedAtMs=\{turnStartedAtMs\}/);
    expect(code).not.toMatch(/turnStartedAtMs=\{\d/);
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

  it("T352: feeds the Context card from a real agent_update subscription, never a literal", () => {
    const code = readCode();
    expect(code).toMatch(/resolveAgentUsageClient\(core\.connection\)/);
    expect(code).toMatch(/createContextUsageSignal\(usageClient, agentId, setUsage\)/);
    expect(code).toMatch(/usage=\{usage\}/);
  });

  it("T352: opens no subscription with no client, and disposes the one it opens", () => {
    const code = readCode();
    expect(code).toMatch(/if \(!agentId \|\| !usageClient\) return;/);
    expect(code).toMatch(/return \(\) => signal\.dispose\(\);/);
  });

  it("T385: reads auto-compaction through the real controls client and passes it to the Context card, never a guessed default", () => {
    const code = readCode();
    expect(code).toMatch(/resolveSessionControlsClient\(core\.connection\)/);
    expect(code).toMatch(/controlsClient\s*\.getAutoCompaction\(agentId\)/);
    expect(code).toMatch(/setAutoCompaction\(enabled\)/);
    expect(code).toMatch(/autoCompaction=\{autoCompaction\}/);
    // Unknown stays `undefined` — never a literal false/true default.
    expect(code).toMatch(/useState<boolean \| undefined>\(undefined\)/);
  });
});
