import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * `transcript-window.tsx` imports `react-native` directly (`FlatList`),
 * which cannot be rendered under this workspace's plain `vitest` setup —
 * see `./message-row.test.ts`'s identical constraint and the `readCode()`
 * pattern this file copies verbatim. All real logic (the bound, the
 * flood policy, the follow-tail state machine) already has render-free
 * proof in `./transcript-window-model.test.ts`; this file only proves the
 * `.tsx` actually wires that logic into the render tree — the windowed
 * slice into `FlatList`, not the full `entries` prop; the scroll/gesture
 * events into the model's own methods; the two edge affordances into the
 * model's own counts — rather than, say, silently reaching around it.
 */
function readSource(): string {
  return readFileSync(fileURLToPath(new URL("./transcript-window.tsx", import.meta.url)), "utf8");
}

function readCode(): string {
  return readSource()
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

describe("transcript-window.tsx: FlatList renders the bounded window, never the full entries prop", () => {
  it("passes snapshot.windowedEntries (not entries) as FlatList's data", () => {
    expect(readCode()).toMatch(/data=\{snapshot\.windowedEntries/);
  });

  it("never passes the raw entries prop directly as FlatList's data", () => {
    expect(readCode()).not.toMatch(/data=\{entries\}/);
  });
});

describe("transcript-window.tsx: the transcript's own inset (android-spec.html's `.t`)", () => {
  it("pads top 4 and bottom 10, not the other way round", () => {
    // CORRECTED: this file used to pad paddingTop: theme.spacing[3] (12)
    // and paddingBottom: theme.spacing[1] (4) — top and bottom swapped
    // from the confirmed spec's `.t { padding: 4px 10px 10px }`, quoting
    // docs/ui-reference/pi-companion-app.html's stale `.t { padding:
    // 12px 12px 4px }` instead. See ../../ui/theme/block-shape.ts's
    // module doc comment for the full correction.
    const code = readCode();
    expect(code).toMatch(/paddingTop: theme\.spacing\[1\]/);
    expect(code).toMatch(/paddingBottom: TRANSCRIPT_INSET_BOTTOM_DP/);
    expect(code).not.toMatch(/paddingTop: theme\.spacing\[3\]/);
  });

  it("pads 10dp horizontally, the confirmed spec's own figure with no design token", () => {
    const code = readCode();
    expect(code).toMatch(/^const TRANSCRIPT_INSET_HORIZONTAL_DP = 10;$/m);
    expect(code).toMatch(/paddingHorizontal: TRANSCRIPT_INSET_HORIZONTAL_DP/);
  });
});

describe("transcript-window.tsx: rowExtraData (W11-STREAMCARET)", () => {
  it("declares rowExtraData on TranscriptWindowListProps", () => {
    expect(readCode()).toMatch(/rowExtraData\?:\s*unknown;/);
  });

  it("destructures rowExtraData and forwards it to FlatList's own extraData prop", () => {
    const code = readCode();
    expect(code).toMatch(/rowExtraData,\s*\}: TranscriptWindowListProps<T>\)/);
    expect(code).toMatch(/extraData=\{rowExtraData\}/);
  });

  it("still passes snapshot.windowedEntries as FlatList's data alongside extraData -- extraData is additive, not a replacement", () => {
    const code = readCode();
    expect(code).toMatch(
      /data=\{snapshot\.windowedEntries as T\[\]\}\s*extraData=\{rowExtraData\}/,
    );
  });
});

describe("transcript-window.tsx: entries changes flow through the model, not a private list", () => {
  it("calls windowRef.current.applyEntries(entries) when entries changes", () => {
    expect(readCode()).toMatch(/windowRef\.current!\.applyEntries\(entries\)/);
  });

  it("only scrolls to the tail when the model says to (shouldScrollToTail), never unconditionally", () => {
    const code = readCode();
    const applyEffectMatch = code.match(
      /useEffect\(\(\) => \{[\s\S]*?windowRef\.current!\.applyEntries\(entries\);[\s\S]*?\}, \[entries\]\);/,
    );
    expect(applyEffectMatch).not.toBeNull();
    expect(applyEffectMatch?.[0]).toMatch(/if \(next\.shouldScrollToTail\) \{/);
    expect(applyEffectMatch?.[0]).toMatch(
      /listRef\.current\?\.scrollToEnd\(\{ animated: false \}\);/,
    );
  });
});

describe("transcript-window.tsx: scroll/gesture events wire into the model's own methods", () => {
  it("onScroll calls windowRef.current.onScroll with metrics derived from the native event", () => {
    expect(readCode()).toMatch(/windowRef\.current!\.onScroll\(metricsFromScrollEvent\(event\)\)/);
  });

  it("onScrollBeginDrag marks the gesture in-progress via setScrolling(true)", () => {
    expect(readCode()).toMatch(/windowRef\.current!\.setScrolling\(true\)/);
  });

  it("both onScrollEndDrag and onMomentumScrollEnd clear the gesture via setScrolling(false)", () => {
    const matches = readCode().match(/windowRef\.current!\.setScrolling\(false\)/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it("FlatList's own onScrollBeginDrag/onScrollEndDrag/onMomentumScrollEnd props are wired to those handlers", () => {
    const code = readCode();
    expect(code).toMatch(/onScrollBeginDrag=\{handleScrollBeginDrag\}/);
    expect(code).toMatch(/onScrollEndDrag=\{handleScrollEndDrag\}/);
    expect(code).toMatch(/onMomentumScrollEnd=\{handleMomentumScrollEnd\}/);
  });
});

describe("transcript-window.tsx: the artifact's `.t` inset and block gap", () => {
  it("takes the gap between blocks from the shared block shape, not a second literal", () => {
    const code = readCode();
    expect(code).toMatch(/import \{ BLOCK_GAP \} from "\.\.\/\.\.\/ui\/theme\/block-shape"/);
    expect(code).toMatch(/gap: BLOCK_GAP/);
  });
});

describe("transcript-window.tsx: both windowed-out edges have a real, wired affordance", () => {
  it("the 'show earlier' Button is gated on hiddenOlderCount and wired to expandOlder()", () => {
    const code = readCode();
    expect(code).toMatch(/snapshot\.hiddenOlderCount > 0/);
    expect(code).toMatch(/windowRef\.current!\.expandOlder\(\)/);
    expect(code).toMatch(/onPress=\{handleShowEarlier\}/);
  });

  it("the unread Banner is gated on unreadCount, labelled with the real count, and its action calls returnToTail()", () => {
    const code = readCode();
    expect(code).toMatch(/snapshot\.unreadCount > 0/);
    expect(code).toMatch(/message=\{`\$\{snapshot\.unreadCount\} new message/);
    expect(code).toMatch(/windowRef\.current!\.returnToTail\(\)/);
    expect(code).toMatch(/onAction=\{handleJumpToTail\}/);
  });
});

describe("transcript-window.tsx: turn-entrance fade-up (W12-ENTRANCE)", () => {
  it("destructures renderItem's own index, and computes the absolute index as snapshot.hiddenOlderCount + index -- never the window-local index alone", () => {
    const code = readCode();
    expect(code).toMatch(/renderItem: ListRenderItem<T> = \(\{ item, index \}\) =>/);
    expect(code).toMatch(/const absoluteIndex = snapshot\.hiddenOlderCount \+ index;/);
  });

  it("advances the watermark via the shared frontend-core function, never a local re-implementation", () => {
    const code = readCode();
    expect(code).toMatch(
      /timeline\.advanceTranscriptEntranceWatermark\(\s*entranceWatermarkRef\.current,\s*entries\.length,?\s*\)/,
    );
    // Regression guard: no hand-rolled watermark comparison such as
    // `entries.length !== ...Ref.current` sits anywhere in this file --
    // that logic belongs to `advanceTranscriptEntranceWatermark` alone.
    expect(code).not.toMatch(/entries\.length !== /);
  });

  it("takes the per-row stagger delay from the shared frontend-core function, never a local `* 120`", () => {
    const code = readCode();
    expect(code).toMatch(
      /timeline\.transcriptEntranceDelayMs\(\s*absoluteIndex,\s*entranceWatermarkRef\.current\.enteringFromRow,?\s*\)/,
    );
    expect(code).not.toMatch(/\* 120/);
    expect(code).not.toMatch(/\*\s*TRANSCRIPT_ENTRANCE_STAGGER/);
  });

  it("supplies the entering prop conditionally -- never an unconditional entering={...}", () => {
    const code = readCode();
    expect(code).toMatch(
      /entering=\{delayMs === null \? undefined : createTranscriptEntranceEntering\(delayMs\)\}/,
    );
    // No literal `entering={createTranscriptEntranceEntering(...)}` with no
    // conditional guarding it anywhere in the file.
    expect(code).not.toMatch(/entering=\{createTranscriptEntranceEntering\(delayMs\)\}(?!\s*:)/);
  });

  it("skips the entrance entirely under reduced motion -- delayMs is forced null before the shared function is even asked", () => {
    const code = readCode();
    expect(code).toMatch(/const delayMs = reduceMotion\s*\?\s*null/);
  });

  it("destructures reduceMotion from useTheme()", () => {
    expect(readCode()).toMatch(/const \{ theme, reduceMotion \} = useTheme\(\);/);
  });

  it("drives the fade-up animation from the shared EXPRESSIVE_FADE_UP_* tokens, not local literals", () => {
    const code = readCode();
    expect(code).toMatch(/EXPRESSIVE_FADE_UP_DURATION_MS\.transcriptTurn/);
    expect(code).toMatch(/Easing\.bezier\(\.\.\.EXPRESSIVE_FADE_UP_EASING\)/);
    expect(code).toMatch(/EXPRESSIVE_FADE_UP_FROM_TRANSLATE_Y/);
    expect(code).toMatch(
      /import \{\s*EXPRESSIVE_FADE_UP_DURATION_MS,\s*EXPRESSIVE_FADE_UP_EASING,\s*EXPRESSIVE_FADE_UP_FROM_TRANSLATE_Y,\s*\} from "\.\.\/\.\.\/ui\/theme\/expressive-motion";/,
    );
  });

  it("advances the watermark during render, not from a useEffect", () => {
    const code = readCode();
    const advanceIndex = code.indexOf(
      "timeline.advanceTranscriptEntranceWatermark(\n    entranceWatermarkRef.current",
    );
    expect(advanceIndex).toBeGreaterThan(-1);
    // The nearest preceding `useEffect(` (if any) must close before the
    // advance call -- i.e. the advance is not inside an effect body. The
    // simplest real signal available to a source-text test: the advance
    // call sits directly in the component body, not nested inside any
    // `useEffect(() => {` ... `}, [` block, so no `useEffect` text appears
    // between the ref declaration and the advance call.
    const refIndex = code.indexOf("const entranceWatermarkRef = useRef");
    const between = code.slice(refIndex, advanceIndex);
    expect(between).not.toMatch(/useEffect/);
  });
});

describe("transcript-window.tsx: transcript find bar", () => {
  it("renders the find bar above the list, driven by the search-model snapshot", () => {
    const code = readCode();
    expect(code).toMatch(/<TranscriptSearchBar/);
    expect(code).toMatch(/snapshot=\{searchSnapshot\}/);
    expect(code).toMatch(/onQueryChange=\{handleSearchQueryChange\}/);
    expect(code).toMatch(/onNext=\{handleSearchNext\}/);
    expect(code).toMatch(/onPrevious=\{handleSearchPrevious\}/);
  });

  it("derives the snapshot from core entries only, never crashing on a non-core row", () => {
    const code = readCode();
    expect(code).toMatch(/transcriptSearchSnapshot\(searchState, searchableEntries\)/);
    expect(code).toMatch(/typeof entry\.kind === "string"/);
  });

  it("reveals an off-window match before scrolling to it, keyed on the stable active key", () => {
    const code = readCode();
    expect(code).toMatch(/windowRef\.current!\.revealIndex\(fullIndex\)/);
    expect(code).toMatch(/scrollToIndex\(\{ index: windowIndex, viewPosition: 0\.5/);
    expect(code).toMatch(/}, \[searchSnapshot\.activeKey\]\);/);
  });

  it("highlights only the active match's row, from theme tokens", () => {
    const code = readCode();
    expect(code).toMatch(/item\.id !== activeSearchEntryId/);
    expect(code).toMatch(/style=\{styles\.searchActive\}/);
    expect(code).toMatch(/borderColor: theme\.colors\.accent/);
    expect(code).toMatch(/backgroundColor: theme\.colors\["accent-tint"\]/);
  });

  it("retries a scroll that raced a window reveal on the next tick", () => {
    const code = readCode();
    expect(code).toMatch(/onScrollToIndexFailed=\{handleScrollToIndexFailed\}/);
    expect(code).toMatch(/listRef\.current\?\.scrollToIndex\(\{ index: info\.index/);
  });
});
