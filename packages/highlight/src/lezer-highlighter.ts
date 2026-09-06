/**
 * `@codemirror/language`-free variants of `highlightCode`/`highlightLine`
 * (`highlighter.ts`), built on `lezer-parsers.ts`'s raw `@lezer/*`
 * parsers instead of `parsers.ts`'s CodeMirror `Language` wrappers.
 *
 * Consumers that must not pull `@codemirror/language` (and transitively
 * `@codemirror/view`) into an eagerly-loaded bundle — the web app's
 * always-rendered, read-only file view (T30B2's `file-syntax-highlight.ts`)
 * is the motivating case, see T30B3's "the editor chunk is lazily
 * loaded" acceptance criterion — should tokenize through these instead
 * of `highlightCode`/`highlightLine`.
 *
 * Coverage is everything `lezer-parsers.ts` covers: every language
 * `parsers.ts` supports *except* Swift, Dart, and C#, whose only
 * available grammar is a CodeMirror `Language`/`StreamLanguage`. Those
 * three extensions fall back to plain, unstyled text here — the exact
 * same fallback `highlightCode` itself already uses for any unrecognized
 * extension — and still get full syntax highlighting wherever
 * `highlightCode`/`getLanguageForFile` (`parsers.ts`) is used instead,
 * i.e. the lazily-loaded CodeMirror editor (T30B3's `file-code-editor.tsx`).
 *
 * This package's `package.json` also re-exports this file alone as the
 * `@picompanion/highlight/lezer-only` subpath, distinct from the
 * package's main `.` entry point (`index.ts`, which also re-exports
 * `getLanguageForFile`/`createCodeMirrorHighlightStyle`). A consumer
 * that needs a hard build-time guarantee it never pulls in
 * `@codemirror/language` — not just "only imports the right named
 * export" — should import from that subpath specifically: Rollup/Vite
 * decide dynamic-`import()` chunk splitting per *module* (file), not
 * per named export, so a dynamic `import("@picompanion/highlight")`
 * elsewhere in the same app would otherwise merge back into any static
 * `import ... from "@picompanion/highlight"`, even one that only uses
 * this file's exports.
 */
import type { HighlightToken } from "./types.js";
import { highlightWithParser } from "./highlighter-core.js";
import { lezerParsersByExtension } from "./lezer-parsers.js";

function lezerParserForFile(filename: string) {
  const ext = filename.split(".").pop()?.toLowerCase();
  if (!ext) return null;
  return lezerParsersByExtension[ext] ?? null;
}

export function highlightCodeLezerOnly(code: string, filename: string): HighlightToken[][] {
  return highlightWithParser(code, lezerParserForFile(filename));
}

export function highlightLineLezerOnly(line: string, filename: string): HighlightToken[] {
  const result = highlightCodeLezerOnly(line, filename);
  return result[0] ?? [{ text: line, style: null }];
}

export function isLezerOnlyLanguageSupported(filename: string): boolean {
  return lezerParserForFile(filename) !== null;
}
