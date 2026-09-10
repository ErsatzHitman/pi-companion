import { describe, expect, it } from "vitest";

import {
  DIFF_LINE_PADDING_HORIZONTAL,
  DIFF_LINE_RADIUS,
  changedSpans,
  diffLineAnnouncement,
  diffLineInk,
  diffLineSurface,
  highlightHits,
  pairChangedLines,
  toneForDiffKind,
  type DiffLineInput,
} from "./diff-lines-model";

describe("the .dl band's tokens and geometry (T358)", () => {
  it("carries the artifact's own radius and horizontal padding", () => {
    expect(DIFF_LINE_RADIUS).toBe(5);
    expect(DIFF_LINE_PADDING_HORIZONTAL).toBe(6);
  });

  it("washes an addition green and a removal red, and leaves context unfilled", () => {
    expect(diffLineSurface("add")).toBe("green-tint");
    expect(diffLineSurface("rem")).toBe("red-tint");
    expect(diffLineSurface("ctx")).toBeNull();
  });

  it("names a colour ROLE, never a colour", () => {
    // The 12% wash the artifact writes is `green-tint`/`red-tint` here,
    // which the token package already contrast-checked; see this
    // module's doc comment.
    for (const tone of ["add", "rem", "ctx"] as const) {
      expect(diffLineSurface(tone) ?? "ctx").not.toMatch(/^#|^rgb/);
      expect(diffLineInk(tone)).not.toMatch(/^#|^rgb/);
    }
  });

  it("gives each tone its own text colour", () => {
    expect(diffLineInk("add")).toBe("green");
    expect(diffLineInk("rem")).toBe("red");
    expect(diffLineInk("ctx")).toBe("ink-2");
  });

  it("says add and remove in words, so the wash is never the only signal", () => {
    expect(diffLineAnnouncement("add")).toBe("Added");
    expect(diffLineAnnouncement("rem")).toBe("Removed");
    expect(diffLineAnnouncement("ctx")).toBe("Context");
  });
});

describe("toneForDiffKind: only real diff content gets a tone (T358)", () => {
  it("maps the three content kinds", () => {
    expect(toneForDiffKind("add")).toBe("add");
    expect(toneForDiffKind("remove")).toBe("rem");
    expect(toneForDiffKind("context")).toBe("ctx");
  });

  it("refuses the hunk and file headers", () => {
    // `@@ -1,4 +1,6 @@` and `--- a/x.ts` both start with a marker
    // character. Toning them would colour a file path as a deletion.
    expect(toneForDiffKind("hunk")).toBeNull();
    expect(toneForDiffKind("meta")).toBeNull();
  });
});

describe("changedSpans: the .inv middle (T358)", () => {
  it("inverts only the words that differ", () => {
    expect(
      changedSpans("  primary: tokens.color.blue,", "  primary: tokens.color.accent,"),
    ).toEqual([
      { text: "  primary: tokens.color.", inverted: false },
      { text: "blue", inverted: true },
      { text: ",", inverted: false },
    ]);
  });

  it("inverts nothing when there is no counterpart to compare against", () => {
    expect(changedSpans("  const x = 1;", null)).toEqual([
      { text: "  const x = 1;", inverted: false },
    ]);
  });

  it("inverts nothing when the two lines are identical", () => {
    expect(changedSpans("same", "same")).toEqual([{ text: "same", inverted: false }]);
  });

  it("inverts nothing when the whole line differs", () => {
    // A solid colour bar says less than the fill already does.
    expect(changedSpans("alpha", "bravo")).toEqual([{ text: "alpha", inverted: false }]);
  });

  it("handles a pure insertion at the end and at the start", () => {
    expect(changedSpans("ab", "a")).toEqual([
      { text: "a", inverted: false },
      { text: "b", inverted: true },
    ]);
    expect(changedSpans("ba", "a")).toEqual([
      { text: "b", inverted: true },
      { text: "a", inverted: false },
    ]);
  });

  it("never double-counts a character as both prefix and suffix", () => {
    // "aa" against "a": the prefix consumes the first character, so the
    // suffix scan must not claim it again and report a negative middle.
    const spans = changedSpans("aa", "a");
    expect(spans.map((span) => span.text).join("")).toBe("aa");
  });

  it("always reproduces the original line exactly", () => {
    const pairs: readonly (readonly [string, string])[] = [
      ["  return foo(bar);", "  return foo(baz);"],
      ["", "anything"],
      ["x", ""],
      ["prefix MIDDLE suffix", "prefix OTHER suffix"],
      ["\tindented\t", "\tindented too\t"],
    ];
    for (const [text, counterpart] of pairs) {
      expect(
        changedSpans(text, counterpart)
          .map((span) => span.text)
          .join(""),
      ).toBe(text);
    }
  });
});

function input(
  key: string,
  tone: DiffLineInput["tone"],
  marker: string,
  content: string,
): DiffLineInput {
  return { key, tone, marker, content };
}

describe("pairChangedLines: which lines are read as a replacement (T358)", () => {
  it("pairs one removal with the single addition that follows it", () => {
    const items = pairChangedLines([
      input("0", "ctx", " ", "  const styles = {"),
      input("1", "rem", "-", "    primary: blue,"),
      input("2", "add", "+", "    primary: accent,"),
      input("3", "ctx", " ", "  };"),
    ]);
    expect(items[1]?.spans.some((span) => span.inverted)).toBe(true);
    expect(items[2]?.spans.some((span) => span.inverted)).toBe(true);
    expect(items[0]?.spans).toEqual([{ text: "  const styles = {", inverted: false }]);
  });

  it("refuses to pair across a longer run, where no one-to-one reading is honest", () => {
    const items = pairChangedLines([
      input("0", "rem", "-", "one"),
      input("1", "rem", "-", "two"),
      input("2", "add", "+", "uno"),
      input("3", "add", "+", "dos"),
    ]);
    for (const item of items) {
      expect(item.spans.some((span) => span.inverted)).toBe(false);
    }
  });

  it("leaves a removal with no addition after it, and an addition with no removal before it, un-inverted", () => {
    const items = pairChangedLines([
      input("0", "rem", "-", "gone"),
      input("1", "ctx", " ", "kept"),
      input("2", "add", "+", "new"),
    ]);
    for (const item of items) {
      expect(item.spans.some((span) => span.inverted)).toBe(false);
    }
  });

  it("carries every key, tone and marker through untouched", () => {
    const items = pairChangedLines([
      input("a", "rem", "-", "x"),
      input("b", "add", "+", "y"),
      input("c", "ctx", " ", "z"),
    ]);
    expect(items.map((item) => [item.key, item.tone, item.marker])).toEqual([
      ["a", "rem", "-"],
      ["b", "add", "+"],
      ["c", "ctx", " "],
    ]);
  });

  it("returns an empty list for an empty diff rather than throwing", () => {
    expect(pairChangedLines([])).toEqual([]);
  });
});

describe("highlightHits: mark.hit (T358)", () => {
  it("splits around every occurrence", () => {
    expect(highlightHits("variant?: BadgeVariant;", "variant")).toEqual([
      { text: "variant", hit: true },
      { text: "?: Badge", hit: false },
      { text: "Variant", hit: true },
      { text: ";", hit: false },
    ]);
  });

  it("matches case-insensitively but shows the text's own casing", () => {
    const spans = highlightHits("Foo and FOO", "foo");
    expect(spans.filter((span) => span.hit).map((span) => span.text)).toEqual(["Foo", "FOO"]);
  });

  it("returns the line whole when the query is empty or whitespace", () => {
    expect(highlightHits("anything", "")).toEqual([{ text: "anything", hit: false }]);
    expect(highlightHits("anything", "   ")).toEqual([{ text: "anything", hit: false }]);
  });

  it("returns the line whole when nothing matches", () => {
    expect(highlightHits("abc", "zzz")).toEqual([{ text: "abc", hit: false }]);
  });

  it("terminates on a repeated adjacent match", () => {
    expect(highlightHits("aaaa", "aa")).toEqual([
      { text: "aa", hit: true },
      { text: "aa", hit: true },
    ]);
  });

  it("always reproduces the original line exactly", () => {
    for (const [text, query] of [
      ["variant?: BadgeVariant;", "variant"],
      ["no match here", "xyz"],
      ["", "q"],
      ["edge", "edge"],
      ["  padded  ", " padded "],
    ] as const) {
      expect(
        highlightHits(text, query)
          .map((span) => span.text)
          .join(""),
      ).toBe(text);
    }
  });
});
