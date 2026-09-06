import type { HighlightToken } from "./types.js";
import { getParserForFile } from "./parsers.js";
import { highlightWithParser } from "./highlighter-core.js";

export function highlightCode(code: string, filename: string): HighlightToken[][] {
  return highlightWithParser(code, getParserForFile(filename));
}

export function highlightLine(line: string, filename: string): HighlightToken[] {
  const result = highlightCode(line, filename);
  return result[0] ?? [{ text: line, style: null }];
}
