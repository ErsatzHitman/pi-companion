import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * T276 source-level contract for `voice-capture-indicator.tsx` — the
 * same treatment `composer-voice-wiring.test.ts` gives `Composer.tsx`,
 * for the identical reason: this file imports `react-native` and
 * `react-native-reanimated`, so it cannot be rendered under this
 * workspace's plain `vitest` setup (the RN-in-vitest limitation this
 * repository's `CLAUDE.md` catalogues). The numeric timing/shape facts
 * this component depends on are proven for real, behaviourally, by
 * `voice-capture-indicator-constants.test.ts` — this file only proves
 * that the component actually USES those constants (imports them,
 * rather than re-declaring its own numbers) and wires the branching/
 * accessibility contract the brief requires.
 *
 * Every assertion reads through `readCode()` (comments stripped) and
 * anchors to a real statement naming real identifiers, never a bare
 * literal satisfied by a doc comment — CLAUDE.md's catalogued defect
 * classes 1/2/5. Each assertion was mutation-checked: the real code was
 * deleted/changed (comments and imports left intact), the corresponding
 * `it` was confirmed to fail, and the file was restored byte-for-byte
 * before this suite was left green — see this task's report for the
 * exact mutations and results.
 */

function readSource(): string {
  return readFileSync(
    fileURLToPath(new URL("./voice-capture-indicator.tsx", import.meta.url)),
    "utf8",
  );
}

function readCode(): string {
  return readSource()
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

/** Slices `readCode()` down to one top-level `function` declaration, by name — closes defect (5) (a sibling occurrence satisfying a whole-file match), same helper shape as `composer-voice-wiring.test.ts`'s `readComponentCode`. */
function readFunctionCode(name: string): string {
  const code = readCode();
  const body = code
    .split(/^(?:export default |export )?function /m)
    .map((part) => `function ${part}`)
    .find((part) => part.startsWith(`function ${name}(`));
  expect(
    body,
    `voice-capture-indicator.tsx should declare a top-level function ${name}`,
  ).toBeDefined();
  return body ?? "";
}

describe("VoiceCaptureIndicator renders a waveform (recording) or a distinct ring (processing) — never visible status text (T276)", () => {
  const fullCode = readCode();

  it('branches on status === "processing" before falling through to the recording view', () => {
    const code = readFunctionCode("VoiceCaptureIndicator");
    expect(code).toMatch(/if \(status === "processing"\) \{/);
    expect(code).toMatch(/<ProcessingRing\b/);
  });

  it("renders exactly the bars EQ_BAR_DELAYS_MS names — imported from the constants module, not redeclared here", () => {
    expect(fullCode).toMatch(
      /import \{\s*EQ_BAR_DELAYS_MS,[\s\S]{0,300}?\} from "\.\/voice-capture-indicator-constants"/,
    );
    const code = readFunctionCode("VoiceCaptureIndicator");
    expect(code).toMatch(/\{EQ_BAR_DELAYS_MS\.map\(\(delayMs, index\) => \(/);
    expect(code).toMatch(/<EqBar\s+key=\{index\}\s+delayMs=\{delayMs\}/);
  });

  it("the recording view carries an accessible, live-region 'Recording' announcement — the only signal a screen-reader user gets, since no visible label is rendered", () => {
    const code = readFunctionCode("VoiceCaptureIndicator");
    expect(code).toMatch(
      /accessible\s*\n\s*accessibilityLiveRegion="polite"\s*\n\s*accessibilityLabel="Recording"/,
    );
  });

  it("the processing view carries a DIFFERENT accessible announcement, 'Processing' — distinguishable from recording", () => {
    const code = readFunctionCode("VoiceCaptureIndicator");
    expect(code).toMatch(
      /accessible\s*\n\s*accessibilityLiveRegion="polite"\s*\n\s*accessibilityLabel="Processing"/,
    );
  });

  it('never renders a "Listening"/"Recording…"/"Processing…" text label — the artifact this component matches carries none, and the brief forbids introducing one', () => {
    expect(fullCode).not.toMatch(/Listening/);
    expect(fullCode).not.toMatch(/Recording…/);
    expect(fullCode).not.toMatch(/Processing…/);
    expect(fullCode).not.toMatch(/<Text\b/);
  });
});

describe("EqBar respects reduceMotion — a static peak frame, not a continuing loop or a hidden bar (plan.md §10.5)", () => {
  it("freezes at EQ_MAX_SCALE and returns before starting any withRepeat when reduceMotion is true", () => {
    const code = readFunctionCode("EqBar");
    expect(code).toMatch(/if \(reduceMotion\) \{\s*scale\.value = EQ_MAX_SCALE;\s*return;\s*\}/);
  });

  it("otherwise loops withRepeat(withSequence(...), -1, false), bouncing between EQ_MAX_SCALE and EQ_MIN_SCALE, delayed by this bar's own delayMs", () => {
    const code = readFunctionCode("EqBar");
    expect(code).toMatch(
      /scale\.value = withDelay\(\s*delayMs,\s*withRepeat\(\s*withSequence\(\s*withTiming\(EQ_MAX_SCALE,[\s\S]{0,80}?withTiming\(EQ_MIN_SCALE,[\s\S]{0,80}?\),\s*-1,\s*false,\s*\),\s*\);/,
    );
  });
});

describe("ProcessingRing respects reduceMotion — a static, unrotated ring, not a spinning one", () => {
  it("freezes rotation at 0 and returns before starting any withRepeat when reduceMotion is true", () => {
    const code = readFunctionCode("ProcessingRing");
    expect(code).toMatch(/if \(reduceMotion\) \{\s*rotation\.value = 0;\s*return;\s*\}/);
  });

  it("otherwise spins withRepeat(withTiming(360, ...), -1, false) using PROCESSING_SPIN_DURATION_MS and linear easing", () => {
    const code = readFunctionCode("ProcessingRing");
    expect(code).toMatch(
      /rotation\.value = withRepeat\(\s*withTiming\(360, \{ duration: PROCESSING_SPIN_DURATION_MS, easing: Easing\.linear \}\),\s*-1,\s*false,\s*\);/,
    );
  });
});
