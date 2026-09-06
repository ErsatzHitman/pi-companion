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
  it("uses describeRetryStatus for retryText", () => {
    expect(readComponentCode()).toMatch(
      /const retryText = useMemo\(\(\) => describeRetryStatus\(state\.retry\), \[state\.retry\]\);/,
    );
  });

  it("uses describeCompactionStatus for compactionText", () => {
    expect(readComponentCode()).toMatch(
      /const compactionText = useMemo\(\s*\n\s*\(\) => describeCompactionStatus\(state\.compaction\),\s*\n\s*\[state\.compaction\],\s*\n\s*\);/,
    );
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
