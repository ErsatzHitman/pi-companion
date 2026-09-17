import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * `TurnStatusBanner.tsx` imports `react-native` (via `Banner` from
 * `../../ui/primitives`), which cannot be rendered under this
 * workspace's plain `vitest` setup — the RolldownError on
 * `node_modules/react-native/index.js:1:0`, proven 27+ times across this
 * codebase (see `./ModelThinkingPicker.test.ts`'s identical constraint
 * and the `readCode()`/`readComponentCode()` pattern this file copies).
 * All real logic (availability derivation, retry/compaction copy, the
 * reducer, the live-update wiring) already has render-free behavioural
 * proof in `./turn-status-model.test.ts`; this file only proves the
 * `.tsx` actually wires that into the render tree — the silent
 * "nothing to show" states, the retry/compaction rows appearing only
 * when their own text is non-null, and the tone derivation.
 *
 * `readComponentCode()` anchors every assertion below to the one
 * top-level `TurnStatusBanner` function.
 *
 * Every assertion below was mutation-checked by hand (delete the real
 * construct, re-run this file, confirm the specific `it` fails, restore
 * byte-identically). See this task's (T39C) report for the run log.
 */
function readSource(): string {
  return readFileSync(fileURLToPath(new URL("./TurnStatusBanner.tsx", import.meta.url)), "utf8");
}

function readCode(): string {
  return readSource()
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

/** Slices `readCode()` down to the one top-level `function TurnStatusBanner(...)` declaration. */
function readComponentCode(): string {
  const code = readCode();
  const body = code
    .split(/^(?:export default |export )?function /m)
    .map((part) => `function ${part}`)
    .find((part) => part.startsWith("function TurnStatusBanner("));
  expect(
    body,
    "TurnStatusBanner.tsx should declare a top-level function TurnStatusBanner",
  ).toBeDefined();
  return body ?? "";
}

/** Same technique as `readComponentCode()`, sliced to `useRetryCountdownSeconds` instead — the hook that owns the countdown's 1-second interval (W7-COUNTDOWN). */
function readCountdownHookCode(): string {
  const code = readCode();
  const body = code
    .split(/^(?:export default |export )?function /m)
    .map((part) => `function ${part}`)
    .find((part) => part.startsWith("function useRetryCountdownSeconds("));
  expect(
    body,
    "TurnStatusBanner.tsx should declare a top-level function useRetryCountdownSeconds",
  ).toBeDefined();
  return body ?? "";
}

describe("TurnStatusBanner: composes only the already-audited Banner primitive", () => {
  it("declares no raw Pressable/Touchable* of its own", () => {
    const code = readCode();
    expect(code).not.toMatch(/<(Pressable|TouchableOpacity|TouchableHighlight)\b/);
  });

  it("imports Banner from ../../ui/primitives", () => {
    expect(readCode()).toMatch(/import \{ Banner \} from "\.\.\/\.\.\/ui\/primitives";/);
  });
});

describe("TurnStatusBanner: renders nothing when there is nothing to say", () => {
  it("returns null while unavailable and alwaysShowUnavailable is false", () => {
    const code = readComponentCode();
    expect(code).toMatch(
      /if \(state\.availability !== "ready"\) \{\s*\n\s*if \(!alwaysShowUnavailable\) return null;/,
    );
  });

  it("returns null when both retryText and compactionText are falsy", () => {
    expect(readComponentCode()).toMatch(
      /if \(!retryText && !compactionText\) \{\s*\n\s*return null;\s*\n\s*\}/,
    );
  });
});

describe("TurnStatusBanner: derives its copy from turn-status-model, never a private re-derivation", () => {
  it("uses describeRetryStatus for retryText, passing the live countdown seconds", () => {
    expect(readComponentCode()).toMatch(
      /const retryText = useMemo\(\s*\n\s*\(\) => describeRetryStatus\(state\.retry, remainingSeconds\),\s*\n\s*\[state\.retry, remainingSeconds\],\s*\n\s*\);/,
    );
  });

  it("uses describeCompactionStatus for compactionText", () => {
    expect(readComponentCode()).toMatch(
      /const compactionText = useMemo\(\s*\n\s*\(\) => describeCompactionStatus\(state\.compaction\),\s*\n\s*\[state\.compaction\],\s*\n\s*\);/,
    );
  });

  it("derives remainingSeconds from useRetryCountdownSeconds(state.retry), not a private re-derivation", () => {
    expect(readComponentCode()).toMatch(
      /const remainingSeconds = useRetryCountdownSeconds\(state\.retry\);/,
    );
  });
});

describe("TurnStatusBanner: useRetryCountdownSeconds ticks only while a countdown is live (W7-COUNTDOWN)", () => {
  it("imports retryCountdownSecondsRemaining from turn-status-model", () => {
    expect(readCode()).toMatch(
      /\n\s*retryCountdownSecondsRemaining,\n\s*type TurnStatusState,\n\s*\} from "\.\/turn-status-model";/,
    );
  });

  it("derives remaining seconds from retryCountdownSecondsRemaining(retry, nowMs), not a stored counter", () => {
    expect(readCountdownHookCode()).toMatch(
      /const remaining = retryCountdownSecondsRemaining\(retry, nowMs\);/,
    );
  });

  it("gates the interval on remaining being a live, not-yet-expired count", () => {
    expect(readCountdownHookCode()).toMatch(
      /const counting = remaining !== null && remaining > 0;/,
    );
  });

  it("starts no interval, and returns undefined from the effect, when nothing is counting down", () => {
    const code = readCountdownHookCode();
    expect(code).toMatch(/if \(!counting\) return undefined;/);
  });

  it("ticks every 1000ms and updates state via setNowMs, not a private counter increment", () => {
    expect(readCountdownHookCode()).toMatch(
      /setInterval\(\(\) => setNowMs\(Date\.now\(\)\), 1000\)/,
    );
  });

  it("clears the interval it started, on cleanup", () => {
    expect(readCountdownHookCode()).toMatch(
      /const intervalId = setInterval\([\s\S]*?\);\s*\n\s*return \(\) => clearInterval\(intervalId\);/,
    );
  });

  it("re-runs the effect only when `counting` itself changes, not on every tick", () => {
    expect(readCountdownHookCode()).toMatch(/\}, \[counting\]\);/);
  });

  // W7 merge gate. `nowMs` is seeded once by `useState` and advanced only
  // by the interval above, which does not run while there is nothing to
  // count down. A banner mounted before the first `pi_retry` therefore
  // measured that retry against a mount-time clock and inflated the
  // countdown by the whole idle gap. The fix is a second effect that
  // re-seeds `nowMs` whenever `receivedAtMs` changes; these two pin it.
  //
  // Both are source-shape assertions rather than behavioural ones, and
  // that is the honest limit of this file's method, not a choice: this
  // workspace's plain vitest cannot mount `react-native`, so no test
  // here could have caught the stale seed by observing a render. The
  // defect was found by reading the hook at the gate. Recorded in
  // docs/issues-from-plan.md's P10-23 rather than papered over.
  it("derives receivedAtMs from the retry, so the re-seed has something to key on", () => {
    expect(readCountdownHookCode()).toMatch(
      /const receivedAtMs = retry\?\.receivedAtMs \?\? null;/,
    );
  });

  it("re-seeds nowMs on each new retry, keyed on receivedAtMs rather than on `counting`", () => {
    const code = readCountdownHookCode();
    expect(code).toMatch(
      /if \(receivedAtMs === null\) return;[\s\S]*?setNowMs\(Date\.now\(\)\);[\s\S]*?\}, \[receivedAtMs\]\);/,
    );
    // The re-seed must be its OWN effect, not folded into the interval
    // one: that effect is gated on `counting`, which is false at exactly
    // the moment a fresh retry needs its clock re-seeded. Two distinct
    // `useEffect(` calls in this hook is what makes that structural.
    expect(code.match(/useEffect\(/g)).toHaveLength(2);
    expect(code.indexOf("[receivedAtMs]")).toBeLessThan(code.indexOf("[counting]"));
  });
});

describe("TurnStatusBanner: PixelLoader appears beside a live countdown (W7-COUNTDOWN)", () => {
  it("imports PixelLoader from ../../ui/recipes", () => {
    expect(readCode()).toMatch(/import \{ PixelLoader \} from "\.\.\/\.\.\/ui\/recipes";/);
  });

  it("renders PixelLoader only when remainingSeconds is not null", () => {
    expect(readComponentCode()).toMatch(
      /\{remainingSeconds !== null \? <PixelLoader testId=\{`\$\{testId\}-retry-loader`\}\s*\/> : null\}/,
    );
  });

  it("places the PixelLoader inside the same row as the retry banner, not the compaction one", () => {
    const code = readComponentCode();
    const retryBlockStart = code.indexOf("{retryText ? (");
    const compactionBlockStart = code.indexOf("{compactionText ? (");
    const loaderIndex = code.indexOf("<PixelLoader");
    expect(retryBlockStart).toBeGreaterThanOrEqual(0);
    expect(compactionBlockStart).toBeGreaterThan(retryBlockStart);
    expect(loaderIndex).toBeGreaterThan(retryBlockStart);
    expect(loaderIndex).toBeLessThan(compactionBlockStart);
  });
});

describe("TurnStatusBanner: retry and compaction rows appear independently", () => {
  it("renders the retry Banner only when retryText is truthy", () => {
    const code = readComponentCode();
    expect(code).toMatch(/\{retryText \? \(/);
    expect(code).toMatch(/testId=\{`\$\{testId\}-retry`\}/);
  });

  it("renders the compaction Banner only when compactionText is truthy", () => {
    const code = readComponentCode();
    expect(code).toMatch(/\{compactionText \? \(/);
    expect(code).toMatch(/testId=\{`\$\{testId\}-compaction`\}/);
  });

  it("gives the retry banner a warning tone exactly when the retry carries an error", () => {
    expect(readComponentCode()).toMatch(/tone=\{state\.retry\?\.error \? "warning" : "info"\}/);
  });

  it("gives the compaction banner an info tone exactly while it is loading", () => {
    expect(readComponentCode()).toMatch(
      /tone=\{state\.compaction\?\.status === "loading" \? "info" : "neutral"\}/,
    );
  });
});
