import { describe, expect, it } from "vitest";

import {
  decodeUtf8Bytes,
  isLezerOnlyLanguageSupported,
  syntaxColorKey,
  tokenizeFileContent,
} from "./file-syntax-highlight";

describe("syntaxColorKey (T35A2)", () => {
  it("maps a known highlight style to its theme.colors.code.syntax key", () => {
    expect(syntaxColorKey("keyword")).toBe("keyword");
    expect(syntaxColorKey("string")).toBe("string");
    expect(syntaxColorKey("comment")).toBe("comment");
  });

  it("collapses finer-grained styles onto the 9 published SyntaxColors keys, matching web's mapping", () => {
    expect(syntaxColorKey("definition")).toBe("function");
    expect(syntaxColorKey("literal")).toBe("number");
    expect(syntaxColorKey("tag")).toBe("type");
    expect(syntaxColorKey("attribute")).toBe("variable");
    expect(syntaxColorKey("regexp")).toBe("string");
    expect(syntaxColorKey("heading")).toBe("keyword");
  });

  it("returns null for unstyled (plain) text", () => {
    expect(syntaxColorKey(null)).toBeNull();
  });
});

describe("tokenizeFileContent (T35A2)", () => {
  it("tokenizes recognized source by extension, using @picompanion/highlight's real parser (not a hand-rolled stub)", () => {
    const lines = tokenizeFileContent("const x = 1;\n", "example.ts");
    expect(lines.length).toBeGreaterThan(0);
    // A real tokenizer splits `const` (keyword) from the rest — a plain
    // pass-through would emit the whole line as one unstyled token.
    const styledTokens = lines.flat().filter((token) => token.style !== null);
    expect(styledTokens.length).toBeGreaterThan(0);
    expect(styledTokens.some((token) => token.text === "const" && token.style === "keyword")).toBe(
      true,
    );
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

describe("isLezerOnlyLanguageSupported (T35A2)", () => {
  it("is true for a language the Lezer build ships a grammar for", () => {
    expect(isLezerOnlyLanguageSupported("app.ts")).toBe(true);
    expect(isLezerOnlyLanguageSupported("main.py")).toBe(true);
  });

  it("is false for an unrecognized extension — this is what routes FileTextBody to plain CodeBlock rendering", () => {
    expect(isLezerOnlyLanguageSupported("notes.unknownext")).toBe(false);
  });
});

describe("decodeUtf8Bytes (T35A2)", () => {
  it("decodes plain ASCII", () => {
    expect(decodeUtf8Bytes(new TextEncoder().encode("hello world"))).toBe("hello world");
  });

  it("round-trips multi-byte UTF-8 (accented Latin, and a 4-byte emoji surrogate pair)", () => {
    const original = "café 🎉 日本語";
    expect(decodeUtf8Bytes(new TextEncoder().encode(original))).toBe(original);
  });

  it("decodes an empty byte array as an empty string", () => {
    expect(decodeUtf8Bytes(new Uint8Array())).toBe("");
  });

  it("emits the replacement character for an invalid continuation byte, without corrupting the bytes around it", () => {
    // 'A', an invalid lone continuation byte (0x80), 'B'.
    const bytes = new Uint8Array([0x41, 0x80, 0x42]);
    expect(decodeUtf8Bytes(bytes)).toBe("A�B");
  });

  it("emits the replacement character for a truncated multi-byte sequence at the end of the buffer", () => {
    // 'A' followed by the lead byte of a 2-byte sequence with nothing after it.
    const bytes = new Uint8Array([0x41, 0xc3]);
    expect(decodeUtf8Bytes(bytes)).toBe("A�");
  });
});
