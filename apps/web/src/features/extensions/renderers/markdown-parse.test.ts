import { describe, expect, it } from "vitest";

import { isSafeMarkdownHref, parseInline, parseMarkdown } from "./markdown-parse.js";

/**
 * T29A3 — the `markdown` kind's parser. Acceptance criteria exercised here:
 *
 * - "Markdown is sanitised and cannot inject script or raw HTML" — the
 *   parser never treats `<...>` sequences as markup; it only ever produces
 *   `text`/`strong`/`em`/`code`/`link` nodes, so `markdown.tsx` (which turns
 *   this AST into React elements, never `dangerouslySetInnerHTML`) has no
 *   path to render an extension-supplied HTML tag as real markup.
 */

describe("parseMarkdown block structure", () => {
  it("parses a heading", () => {
    expect(parseMarkdown("## Section title")).toEqual([
      { type: "heading", level: 2, children: [{ type: "text", value: "Section title" }] },
    ]);
  });

  it("parses a paragraph, joining wrapped lines with a space", () => {
    expect(parseMarkdown("First line\nsecond line")).toEqual([
      { type: "paragraph", children: [{ type: "text", value: "First line second line" }] },
    ]);
  });

  it("parses a fenced code block with a language tag", () => {
    expect(parseMarkdown("```js\nconst x = 1;\nconsole.log(x);\n```")).toEqual([
      { type: "code-block", value: "const x = 1;\nconsole.log(x);", language: "js" },
    ]);
  });

  it("parses a fenced code block with no language tag", () => {
    expect(parseMarkdown("```\nplain\n```")).toEqual([
      { type: "code-block", value: "plain", language: undefined },
    ]);
  });

  it("parses an unordered list", () => {
    expect(parseMarkdown("- one\n- two\n* three")).toEqual([
      {
        type: "list",
        ordered: false,
        items: [
          [{ type: "text", value: "one" }],
          [{ type: "text", value: "two" }],
          [{ type: "text", value: "three" }],
        ],
      },
    ]);
  });

  it("parses an ordered list", () => {
    expect(parseMarkdown("1. first\n2. second")).toEqual([
      {
        type: "list",
        ordered: true,
        items: [[{ type: "text", value: "first" }], [{ type: "text", value: "second" }]],
      },
    ]);
  });

  it("parses a blockquote, recursing into its own inner blocks", () => {
    expect(parseMarkdown("> a quoted line\n> a second quoted line")).toEqual([
      {
        type: "blockquote",
        children: [
          {
            type: "paragraph",
            children: [{ type: "text", value: "a quoted line a second quoted line" }],
          },
        ],
      },
    ]);
  });

  it("parses a horizontal rule", () => {
    expect(parseMarkdown("above\n\n---\n\nbelow")).toEqual([
      { type: "paragraph", children: [{ type: "text", value: "above" }] },
      { type: "hr" },
      { type: "paragraph", children: [{ type: "text", value: "below" }] },
    ]);
  });

  it("separates blocks on blank lines", () => {
    const blocks = parseMarkdown("# Title\n\nBody paragraph.\n\n- item");
    expect(blocks.map((b) => b.type)).toEqual(["heading", "paragraph", "list"]);
  });

  it("closes an unterminated fenced code block at end of input instead of looping forever", () => {
    expect(parseMarkdown("```\nunterminated")).toEqual([
      { type: "code-block", value: "unterminated", language: undefined },
    ]);
  });

  it("never crashes or hangs on an empty document", () => {
    expect(parseMarkdown("")).toEqual([]);
    expect(parseMarkdown("\n\n\n")).toEqual([]);
  });

  it("treats an HTML-looking line as plain paragraph text, not markup", () => {
    expect(parseMarkdown("<script>alert(1)</script>")).toEqual([
      { type: "paragraph", children: [{ type: "text", value: "<script>alert(1)</script>" }] },
    ]);
  });
});

describe("parseInline spans", () => {
  it("parses bold, italic, and inline code", () => {
    expect(parseInline("plain **bold** and *em* and `code`")).toEqual([
      { type: "text", value: "plain " },
      { type: "strong", children: [{ type: "text", value: "bold" }] },
      { type: "text", value: " and " },
      { type: "em", children: [{ type: "text", value: "em" }] },
      { type: "text", value: " and " },
      { type: "code", value: "code" },
    ]);
  });

  it("parses underscore italics", () => {
    expect(parseInline("_em_")).toEqual([
      { type: "em", children: [{ type: "text", value: "em" }] },
    ]);
  });

  it("parses a safe-scheme link", () => {
    expect(parseInline("[docs](https://example.com/x)")).toEqual([
      {
        type: "link",
        href: "https://example.com/x",
        children: [{ type: "text", value: "docs" }],
      },
    ]);
  });

  it("degrades an unsafe-scheme link to plain text instead of a navigable link", () => {
    expect(
      parseInline("[click me](javascript:alert(document.cookie))").every((n) => n.type !== "link"),
    ).toBe(true);
    expect(parseInline("[click me](javascript:evil)")).toEqual([
      { type: "text", value: "[click me](javascript:evil)" },
    ]);
  });

  it("degrades a data: link to plain text", () => {
    const nodes = parseInline("[x](data:text/html,<script>alert(1)</script>)");
    expect(nodes.every((n) => n.type !== "link")).toBe(true);
  });

  it("returns a single text node for input with no inline spans", () => {
    expect(parseInline("just plain text")).toEqual([{ type: "text", value: "just plain text" }]);
  });

  it("never crashes or hangs on an empty string", () => {
    expect(parseInline("")).toEqual([]);
  });
});

describe("isSafeMarkdownHref", () => {
  it("allows http, https, and mailto", () => {
    expect(isSafeMarkdownHref("http://example.com")).toBe(true);
    expect(isSafeMarkdownHref("https://example.com")).toBe(true);
    expect(isSafeMarkdownHref("mailto:a@example.com")).toBe(true);
  });

  it("allows scheme-less relative hrefs", () => {
    expect(isSafeMarkdownHref("/path")).toBe(true);
    expect(isSafeMarkdownHref("#anchor")).toBe(true);
  });

  it("rejects javascript:, data:, and vbscript: schemes", () => {
    expect(isSafeMarkdownHref("javascript:alert(1)")).toBe(false);
    expect(isSafeMarkdownHref("JAVASCRIPT:alert(1)")).toBe(false);
    expect(isSafeMarkdownHref("data:text/html,<script>alert(1)</script>")).toBe(false);
    expect(isSafeMarkdownHref("vbscript:msgbox(1)")).toBe(false);
  });
});
