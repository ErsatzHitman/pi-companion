/**
 * The tokenizing algorithm `highlightCode`/`highlightLine` (`highlighter.ts`)
 * and `highlightCodeLezerOnly`/`highlightLineLezerOnly`
 * (`lezer-highlighter.ts`) share, factored out so neither of those two
 * modules has to duplicate it. Deliberately depends on nothing beyond
 * `@lezer/highlight`, `@lezer/common`'s `Parser` type, and this
 * package's own `syntax-roles.ts` — never `./parsers.js` — so importing
 * this file alone never pulls in `@codemirror/language`
 * (`syntax-roles.ts` only needs `@lezer/highlight`; see its own
 * docstring).
 */
import { highlightTree } from "@lezer/highlight";
import type { Parser } from "@lezer/common";
import type { HighlightStyle, HighlightToken } from "./types.js";
import { staticSyntaxHighlighter } from "./syntax-roles.js";

/** Tokenizes `code` with an already-resolved `parser`, or returns it unstyled if `parser` is `null`. */
export function highlightWithParser(code: string, parser: Parser | null): HighlightToken[][] {
  if (!parser) {
    return code.split("\n").map((line) => [{ text: line, style: null }]);
  }

  const tree = parser.parse(code);
  const lines = code.split("\n");
  const result: HighlightToken[][] = [];

  for (let i = 0; i < lines.length; i++) {
    result.push([]);
  }

  // Build a map of character positions to styles
  const styleMap: Array<HighlightStyle | null> = Array.from({ length: code.length }, () => null);

  highlightTree(tree, staticSyntaxHighlighter, (from, to, classes) => {
    for (let i = from; i < to && i < styleMap.length; i++) {
      styleMap[i] = classes as HighlightStyle;
    }
  });

  // Convert style map to tokens per line
  let pos = 0;
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex];

    if (line.length === 0) {
      result[lineIndex].push({ text: "", style: null });
      pos++; // skip newline
      continue;
    }

    let currentToken: HighlightToken = { text: "", style: styleMap[pos] };

    for (let i = 0; i < line.length; i++) {
      const charStyle = styleMap[pos + i];
      if (charStyle === currentToken.style) {
        currentToken.text += line[i];
      } else {
        if (currentToken.text) {
          result[lineIndex].push(currentToken);
        }
        currentToken = { text: line[i], style: charStyle };
      }
    }

    if (currentToken.text) {
      result[lineIndex].push(currentToken);
    }

    pos += line.length + 1; // +1 for newline
  }

  return result;
}
