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
    // T385: the drawn label is the ticking elapsed reading (with
    // `Working` as the fallback before a start time exists), and the
    // spoken name always carries the state word.
    expect(code).toMatch(
      /const pillLabel = turnRunning \? \(elapsedText \?\? "Working"\) : "Idle";/,
    );
    expect(code).toMatch(/label=\{pillLabel\}/);
    expect(code).toMatch(/accessibilityLabel=\{pillAccessibilityLabel\}/);
    expect(code).toMatch(/`Working, \$\{elapsedText\}`/);
  });

  it("T385: takes the running turn's elapsed reading from the route's real start time and ticks it, never a constant", () => {
    const code = readCode();
    expect(code).toMatch(/turnStartedAtMs\?: number \| null;/);
    expect(code).toMatch(
      /formatLiveElapsed\(Math\.max\(0, \(nowMs - turnStartedAtMs\) \/ 1000\)\)/,
    );
    expect(code).toMatch(/const ELAPSED_TICK_MS = 500;/);
    expect(code).toMatch(/setInterval\(\(\) => setNowMs\(Date\.now\(\)\), ELAPSED_TICK_MS\)/);
    // The clock only runs while there is a turn to count from.
    expect(code).toMatch(
      /if \(!turnRunning \|\| turnStartedAtMs === null \|\| turnStartedAtMs === undefined\) return;/,
    );
  });

  it("T385: tones the running pill with the artifact's accent (info), not green", () => {
    expect(readCode()).toMatch(/tone=\{turnRunning \? "info" : "neutral"\}/);
  });

  it("UI-A-SHAPE: draws A2's card chrome at the Expressive md radius (22), a 13/500 title and an 11.5px ink-2 summary, matching the confirmed spec's .card/.card h3/.card p", () => {
    const code = readCode();
    expect(code).toMatch(/borderRadius: EXPRESSIVE_RADII\.md/);
    expect(code).not.toMatch(/borderRadius: theme\.radii\.window/);
    expect(code).toMatch(/paddingVertical: theme\.spacing\[3\],/);
    expect(code).toMatch(/paddingHorizontal: theme\.spacing\[3\] \+ 1,/);
    expect(code).toMatch(/const CARD_TITLE_FONT_SIZE = 13;/);
    expect(code).toMatch(/fontSize: CARD_TITLE_FONT_SIZE/);
    expect(code).toMatch(/fontWeight: asFontWeight\(theme\.typography\.fontWeight\.medium\)/);
    expect(code).not.toMatch(/fontWeight: asFontWeight\(theme\.typography\.fontWeight\.semibold\)/);
    expect(code).toMatch(/const CARD_SUMMARY_SIZE = 11\.5;/);
    expect(code).toMatch(/fontSize: CARD_SUMMARY_SIZE/);
    expect(code).toMatch(/cardSummary: \{\s*color: theme\.colors\["ink-2"\],/);
  });

  it("T385: renders a subagent's state word through the neutral StatusPill, not as bare text", () => {
    expect(readCode()).toMatch(/<StatusPill label=\{row\.stateWord\} tone="neutral" \/>/);
  });

  it("T352: the Context card takes every string and the band from the shared telemetry model", () => {
    const code = readCode();
    expect(code).toMatch(/buildContextCardViewModel\(\{ usage, autoCompaction \}\)/);
    expect(code).toMatch(/\{model\.summary\}/);
    expect(code).toMatch(/bandColors\[model\.band\]/);
    expect(code).not.toMatch(/"auto-compaction/);
  });

  it("T352: draws an empty track when the provider has reported no window, never a full or half one", () => {
    const code = readCode();
    expect(code).toMatch(/model\.fraction === null \? null :/);
  });

  it("T352: speaks the context reading, so its colour band is never the only signal", () => {
    expect(readCode()).toMatch(/accessibilityLabel=\{model\.accessibilityLabel\}/);
  });

  it("T352: hides the stats row entirely when the provider reported nothing countable", () => {
    expect(readCode()).toMatch(/model\.statsText\.length > 0 \?/);
  });
});

// PAD-FADEUP (P10-W15): the spec's `.pad>.row,.pad>.card` entrance is
// wired HERE, not merely available from the primitives barrel. This
// case exists because six defects in this session's own waves took one
// shape — a component built, exported, type-correct, and reached by
// nothing. A `PadEntrance` that no screen renders would pass every case
// in `../../ui/primitives/pad-entrance-model.test.ts` and
// `PadEntrance.test.ts` and still ship a screen with no entrance at
// all, so the wiring needs an assertion of its own against the screen's
// own source.
describe("PAD-FADEUP: the Live screen renders the pad entrance (P10-W15)", () => {
  it("wraps its animated pad children in PadEntrance, and every opening tag carries both a kind and a position", () => {
    const code = readCode();
    expect(code).toMatch(/<PadEntrance[\s>]/);
    const openTags = code.match(/<PadEntrance[\s\S]*?>/g) ?? [];
    expect(openTags.length).toBeGreaterThan(0);
    for (const tag of openTags) {
      // `kind` decides whether the child animates at all; `position` is
      // the `:nth-child` index the spec's 45ms schedule is keyed to.
      // Either one omitted is a silent default, never a type error.
      expect(tag).toMatch(/kind=/);
      expect(tag).toMatch(/position=/);
    }
  });

  it("reads the delay schedule from the shared model instead of restating the spec's step here", () => {
    const code = readCode();
    // The 45ms step and the eighth-child boundary live in
    // `pad-entrance-model.ts`, where a real vitest run executes them.
    // A screen computing its own delay would be provable only by source
    // text, which is what that module exists to avoid.
    expect(code).not.toMatch(/45\s*\*/);
    expect(code).not.toMatch(/animationDelay/);
  });
});
