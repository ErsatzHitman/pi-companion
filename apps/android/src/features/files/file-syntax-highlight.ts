/**
 * Syntax-highlighting glue for the read-only Android file view (T35A2,
 * plan.md §6/§7/§10.1/§10.2/§12.4).
 *
 * `@picompanion/highlight`'s `highlightCodeLezerOnly` (ported backend
 * package, already the read path's tokenizer on web — see
 * `apps/web/src/features/files/file-syntax-highlight.ts`) does the
 * actual parsing; this module only maps its `HighlightStyle` categories
 * onto `@picompanion/design-tokens`' `NativeTheme["colors"]["code"]
 * ["syntax"]` keys, mirroring web's mapping onto `--syntax-*` CSS custom
 * properties one-for-one (same 20-to-9 collapse) so Android and web
 * paint the same categories with the same palette, just through
 * different token surfaces (there is no stylesheet layer on this
 * platform — see `packages/design-tokens/src/tokens.ts`'s `SyntaxColors`
 * and `native.ts`, vs. `web.ts#colorDeclarations`'s CSS variables).
 *
 * Imports `highlightCodeLezerOnly` from the package's `./lezer-only`
 * subpath export rather than its main `@picompanion/highlight` entry
 * point, for the same reason web's module does (see that file's doc):
 * the lezer-only module subgraph depends only on raw `@lezer/*` parsers,
 * with no `@codemirror/*` package anywhere in it, so it is safe to keep
 * statically imported and always rendered (this view has no editor
 * chunk to lazily defer to). `@picompanion/highlight` is not declared
 * in `apps/android/package.json`'s `dependencies` — npm's workspace
 * hoisting already resolves it from the repo root `node_modules`
 * (`@picompanion/design-tokens`/`frontend-core`/`protocol` are declared
 * there only because those are direct runtime deps of the app shell;
 * this feature is the first Android consumer of `@picompanion/highlight`)
 * and this task's instructions are explicit: "Use it rather than adding
 * a dependency" — adding a `package.json` line here would risk drifting
 * out of sync with `package-lock.json` without an `npm install` this
 * task is not permitted to run.
 *
 * The three extensions the lezer-only build has no grammar for (Swift,
 * Dart, C#) — and any other unrecognized extension — tokenize as a
 * single unstyled token per line, same as web; `FileCodeView` in
 * `files-screen.tsx` still renders that content correctly, just without
 * colour.
 */
import type { HighlightStyle, HighlightToken } from "@picompanion/highlight";
import {
  highlightCodeLezerOnly,
  isLezerOnlyLanguageSupported,
} from "@picompanion/highlight/lezer-only";
import type { SyntaxColors } from "@picompanion/design-tokens";

const STYLE_TO_SYNTAX_KEY: Record<HighlightStyle, keyof SyntaxColors> = {
  keyword: "keyword",
  comment: "comment",
  string: "string",
  number: "number",
  literal: "number",
  function: "function",
  definition: "function",
  class: "type",
  type: "type",
  tag: "type",
  attribute: "variable",
  property: "variable",
  variable: "variable",
  operator: "operator",
  punctuation: "punctuation",
  regexp: "string",
  escape: "string",
  meta: "comment",
  heading: "keyword",
  link: "string",
};

/** The `theme.colors.code.syntax` key painting `style`, or `null` for plain (unstyled) text. */
export function syntaxColorKey(style: HighlightStyle | null): keyof SyntaxColors | null {
  return style ? STYLE_TO_SYNTAX_KEY[style] : null;
}

export type { HighlightStyle, HighlightToken };
export { isLezerOnlyLanguageSupported };

/**
 * Tokenizes `code` for syntax highlighting, keyed off `path`'s
 * extension. Returns one token array per line; a path with no
 * recognized extension yields each line as a single unstyled token
 * (`@picompanion/highlight`'s own fallback), which the view still
 * renders correctly — just without colour.
 */
export function tokenizeFileContent(code: string, path: string): HighlightToken[][] {
  return highlightCodeLezerOnly(code, path);
}

/**
 * Decodes UTF-8 bytes to a string without relying on a global
 * `TextDecoder` — mirrors `../extensions/registry.ts`'s
 * `estimatePiUiPayloadBytes`/`utf8ByteLength` reasoning (see that
 * module's doc): Hermes (React Native's JS engine) does not guarantee a
 * `TextDecoder` global across every supported Expo/RN version, and this
 * module must stay runnable in a plain Node/vitest environment too
 * (`file-syntax-highlight.test.ts`). An invalid or truncated multi-byte
 * sequence decodes as U+FFFD (the replacement character) and advances
 * one byte, matching `TextDecoder`'s non-fatal mode — the same mode web's
 * `file-content-view.tsx` relies on (`new TextDecoder("utf-8", { fatal:
 * false })`) — so a file that is not quite valid UTF-8 still renders
 * instead of throwing.
 */
export function decodeUtf8Bytes(bytes: Uint8Array): string {
  let result = "";
  let i = 0;
  while (i < bytes.length) {
    const byte1 = bytes[i];
    if (byte1 < 0x80) {
      result += String.fromCharCode(byte1);
      i += 1;
      continue;
    }
    if ((byte1 & 0xe0) === 0xc0 && i + 1 < bytes.length) {
      const byte2 = bytes[i + 1];
      if ((byte2 & 0xc0) === 0x80) {
        const codePoint = ((byte1 & 0x1f) << 6) | (byte2 & 0x3f);
        result += String.fromCharCode(codePoint);
        i += 2;
        continue;
      }
    }
    if ((byte1 & 0xf0) === 0xe0 && i + 2 < bytes.length) {
      const byte2 = bytes[i + 1];
      const byte3 = bytes[i + 2];
      if ((byte2 & 0xc0) === 0x80 && (byte3 & 0xc0) === 0x80) {
        const codePoint = ((byte1 & 0x0f) << 12) | ((byte2 & 0x3f) << 6) | (byte3 & 0x3f);
        result += String.fromCharCode(codePoint);
        i += 3;
        continue;
      }
    }
    if ((byte1 & 0xf8) === 0xf0 && i + 3 < bytes.length) {
      const byte2 = bytes[i + 1];
      const byte3 = bytes[i + 2];
      const byte4 = bytes[i + 3];
      if ((byte2 & 0xc0) === 0x80 && (byte3 & 0xc0) === 0x80 && (byte4 & 0xc0) === 0x80) {
        let codePoint =
          ((byte1 & 0x07) << 18) | ((byte2 & 0x3f) << 12) | ((byte3 & 0x3f) << 6) | (byte4 & 0x3f);
        codePoint -= 0x10000;
        result += String.fromCharCode(0xd800 + (codePoint >> 10), 0xdc00 + (codePoint & 0x3ff));
        i += 4;
        continue;
      }
    }
    // Not a valid UTF-8 sequence starting at `i`: emit the replacement
    // character and advance a single byte, so one bad byte never
    // consumes (and thereby corrupts the decode of) its neighbours.
    result += String.fromCharCode(0xfffd);
    i += 1;
  }
  return result;
}
