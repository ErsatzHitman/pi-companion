import { describe, expect, it } from "vitest";

import { syntaxClassName, syntaxCssVar, tokenizeFileContent } from "./file-syntax-highlight.js";

describe("syntaxCssVar (T30B2)", () => {
  it("maps a known highlight style to its design-token CSS variable", () => {
    expect(syntaxCssVar("keyword")).toBe("--syntax-keyword");
    expect(syntaxCssVar("string")).toBe("--syntax-string");
    expect(syntaxCssVar("comment")).toBe("--syntax-comment");
  });

  it("collapses finer-grained styles onto the 9 published syntax variables", () => {
    expect(syntaxCssVar("definition")).toBe("--syntax-function");
    expect(syntaxCssVar("literal")).toBe("--syntax-number");
    expect(syntaxCssVar("tag")).toBe("--syntax-type");
  });

  it("returns null for unstyled (plain) text", () => {
    expect(syntaxCssVar(null)).toBeNull();
  });
});

describe("syntaxClassName (T30B2)", () => {
  it("maps a known highlight style to a files.css class matching its design-token variable", () => {
    expect(syntaxClassName("keyword")).toBe("pc-syntax-keyword");
    expect(syntaxClassName("string")).toBe("pc-syntax-string");
    expect(syntaxClassName("comment")).toBe("pc-syntax-comment");
  });

  it("collapses finer-grained styles onto the same 9 published classes as syntaxCssVar", () => {
    expect(syntaxClassName("definition")).toBe("pc-syntax-function");
    expect(syntaxClassName("literal")).toBe("pc-syntax-number");
    expect(syntaxClassName("tag")).toBe("pc-syntax-type");
  });

  it("returns null for unstyled (plain) text", () => {
    expect(syntaxClassName(null)).toBeNull();
  });

  it("never drifts from syntaxCssVar's mapping", () => {
    const styles: Array<Parameters<typeof syntaxCssVar>[0]> = [
      "keyword",
      "comment",
      "string",
      "number",
      "literal",
      "function",
      "definition",
      "class",
      "type",
      "tag",
      "attribute",
      "property",
      "variable",
      "operator",
      "punctuation",
      "regexp",
      "escape",
      "meta",
      "heading",
      "link",
    ];
    for (const style of styles) {
      const cssVar = syntaxCssVar(style);
      expect(syntaxClassName(style)).toBe(`pc-syntax-${cssVar!.slice("--syntax-".length)}`);
    }
  });
});

describe("tokenizeFileContent (T30B2)", () => {
  it("tokenizes recognized source by extension", () => {
    const lines = tokenizeFileContent("const x = 1;\n", "example.ts");
    expect(lines.length).toBeGreaterThan(0);
    const flattened = lines
      .flat()
      .map((token) => token.text)
      .join("");
    expect(flattened).toContain("const x = 1;");
  });

  it("falls back to one unstyled token per line for an unrecognized extension", () => {
    const lines = tokenizeFileContent("hello\nworld", "notes.unknownext");
    expect(lines).toEqual([[{ text: "hello", style: null }], [{ text: "world", style: null }]]);
  });

  it("produces one entry per line, including a trailing empty line", () => {
    const lines = tokenizeFileContent("a\nb\n", "plain.txt");
    expect(lines).toHaveLength(3);
  });
});
