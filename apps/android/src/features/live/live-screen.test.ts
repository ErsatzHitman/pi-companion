import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * `live-screen.tsx` source-level contract test (T350) — the module
 * imports `react-native`, so it cannot render under this workspace's
 * plain `vitest` setup. Every decision worth proving behaviourally
 * lives in `./live-screen-model.test.ts`, which runs the real
 * functions; this file pins only what the drawing itself must not lose.
 *
 * `readCode()` strips comments first, so the doc comment's own prose
 * cannot satisfy an assertion.
 */
function readCode(): string {
  return readFileSync(fileURLToPath(new URL("./live-screen.tsx", import.meta.url)), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

describe("LiveScreen source", () => {
  it("takes every string and every selection from the model, deriving none of its own", () => {
    const code = readCode();
    expect(code).toMatch(/buildLiveScreenViewModel\(elements\)/);
    // The card titles and summaries are the model's; a literal "Subagents"
    // or a hand-counted "running" here would be a second source of truth.
    expect(code).toMatch(/title=\{model\.subagents\.title\}/);
    expect(code).toMatch(/summary=\{model\.subagents\.summary\}/);
    expect(code).toMatch(/title=\{model\.workflow\.title\}/);
    expect(code).toMatch(/summary=\{model\.workflow\.summary\}/);
  });

  it("stays router-free: the route supplies back navigation and the nav actions node", () => {
    const code = readCode();
    expect(code).not.toMatch(/expo-router/);
    expect(code).not.toMatch(/useRouter\(/);
    expect(code).toMatch(/onBack: \(\) => void;/);
  });

  it("reads every colour from the theme and hardcodes no product colour", () => {
    const code = readCode();
    expect(code).toMatch(/useTheme\(\)/);
    expect(code).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(code).not.toMatch(/rgba?\(/);
  });

  it("renders an empty card rather than hiding it, so a silent feed is distinguishable from an idle one", () => {
    const code = readCode();
    expect(code).toMatch(
      /\{emptyText \? <Text style=\{styles\.emptyText\}>\{emptyText\}<\/Text> : children\}/,
    );
  });

  it("draws an indeterminate workflow step as an empty track, never a full one", () => {
    const code = readCode();
    expect(code).toMatch(
      /row\.fraction === null \? 0 : Math\.round\(WORKFLOW_BAR_WIDTH \* row\.fraction\)/,
    );
  });

  it("speaks each row as one utterance built by the model, not as loose text nodes", () => {
    const code = readCode();
    expect(code).toMatch(/accessibilityLabel=\{row\.accessibilityLabel\}/);
  });

  it("reports the turn state in words on the pill, never by tone alone", () => {
    const code = readCode();
    expect(code).toMatch(/label=\{turnRunning \? "Working" : "Idle"\}/);
  });
});
