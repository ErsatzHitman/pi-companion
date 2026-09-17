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
  it("adds the reference's 12dp horizontal/top inset and a 4dp bottom inset to the list content", () => {
    const code = readCode();
    expect(code).toMatch(/paddingHorizontal: theme\.spacing\[3\]/);
    expect(code).toMatch(/paddingTop: theme\.spacing\[3\]/);
    expect(code).toMatch(/paddingBottom: theme\.spacing\[1\]/);
  });

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
