import { describe, expect, it } from "vitest";

import {
  addUndoneTurn,
  buildUndoneTurn,
  MAX_UNDONE_TURNS,
  snippetFor,
  SNIPPET_MAX_CHARS,
} from "./undone-turns";
import type { UndoneTurn } from "./undone-turns";

/**
 * T395, Android half: the local undone-turns record (plan.md §4.2).
 *
 * The daemon exposes no list of past rewinds, so this record is the only
 * thing a "return to that turn" row can be built from. What matters here
 * is that it stays bounded, stays single-line, and records the turn a
 * rewind targeted — the id that still resolves after the rewind removed
 * everything after it.
 */
function turn(messageId: string, mode: UndoneTurn["mode"] = "conversation"): UndoneTurn {
  return buildUndoneTurn({ messageId, snippet: `prompt ${messageId}` }, mode);
}

describe("T395 Android undone-turns record", () => {
  it("keeps the newest first and caps the list, so a long session cannot grow it without bound", () => {
    let record: readonly UndoneTurn[] = [];
    for (let index = 0; index < MAX_UNDONE_TURNS + 5; index += 1) {
      record = addUndoneTurn(record, turn(`m${index}`));
    }
    expect(record).toHaveLength(MAX_UNDONE_TURNS);
    expect(record[0]?.messageId).toBe(`m${MAX_UNDONE_TURNS + 4}`);
    expect(record.some((entry) => entry.messageId === "m0")).toBe(false);
  });

  it("collapses a repeated rewind of the same turn and scope into one row", () => {
    const once = addUndoneTurn([], turn("m1"));
    const twice = addUndoneTurn(once, turn("m1"));
    expect(twice).toHaveLength(1);
    expect(twice).toEqual(once);
  });

  it("keeps the same turn under a different scope, because those are different actions", () => {
    const record = addUndoneTurn(
      addUndoneTurn([], turn("m1", "conversation")),
      turn("m1", "files"),
    );
    expect(record).toHaveLength(2);
    expect(record.map((entry) => entry.mode)).toEqual(["files", "conversation"]);
  });

  it("bounds a snippet to one line, so a list row cannot wrap into a paragraph", () => {
    const collapsed = snippetFor("first line\n\n  second   line ");
    expect(collapsed).toBe("first line second line");
    expect(collapsed).not.toContain("\n");
  });

  it("truncates at the documented width and marks the cut with an ellipsis", () => {
    const long = "x".repeat(200);
    const snippet = snippetFor(long);
    expect(snippet).toHaveLength(SNIPPET_MAX_CHARS);
    expect(snippet.endsWith("…")).toBe(true);
    expect(snippetFor("short")).toBe("short");
  });
});
