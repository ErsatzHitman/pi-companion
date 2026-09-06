/**
 * Syntax-highlighting glue for the read-only file view (T30B2).
 *
 * `@picompanion/highlight`'s `highlightCodeLezerOnly` (ported backend
 * package, shared with T30B3's CodeMirror editor) does the actual
 * parsing; this module only maps its `HighlightStyle` categories onto
 * `@picompanion/design-tokens`' `code.syntax` CSS custom properties
 * (`--syntax-keyword`, `--syntax-string`, …; see
 * `packages/design-tokens/src/web.ts#colorDeclarations`) so every colour
 * this view paints still comes from the token system (plan.md §10.2) —
 * `@picompanion/highlight`'s own `darkHighlightColors`/
 * `lightHighlightColors` are for its non-web consumers and are not
 * imported here. The design system publishes 9 syntax categories;
 * `@picompanion/highlight` reports 20 finer-grained ones, so several map
 * onto the same CSS variable.
 *
 * This view is always rendered whenever a file is open (never behind a
 * dynamic import), so it deliberately imports `highlightCodeLezerOnly`
 * from `@picompanion/highlight/lezer-only` — a separate package export
 * whose whole module subgraph (`highlighter-core.ts` + `lezer-parsers.ts`)
 * depends only on raw `@lezer/*` parsers — rather than `highlightCode`
 * or the package's main `@picompanion/highlight` entry point (whose
 * `parsers.ts`/`codemirror-highlight-style.ts` exports statically need
 * `@codemirror/language`, and transitively `@codemirror/view`). Using a
 * distinct subpath (not just distinct named exports off the same
 * entry point) matters: `file-code-editor.tsx` dynamically imports the
 * main `@picompanion/highlight` entry point, and Rollup/Vite only
 * chunk-splits a dynamic `import()` away from a static one when they
 * target different modules — see `@picompanion/highlight`'s
 * `lezer-highlighter.ts` docstring. The three extensions this loses
 * read-only syntax colour for (Swift, Dart, C#) still render as plain,
 * unstyled text, same as any other unrecognized extension, and still
 * get full highlighting in T30B3's lazily-loaded CodeMirror editor
 * once opened for editing.
 */
import type { HighlightStyle, HighlightToken } from "@picompanion/highlight";
import { highlightCodeLezerOnly } from "@picompanion/highlight/lezer-only";

const STYLE_TO_SYNTAX_VAR: Record<HighlightStyle, string> = {
  keyword: "--syntax-keyword",
  comment: "--syntax-comment",
  string: "--syntax-string",
  number: "--syntax-number",
  literal: "--syntax-number",
  function: "--syntax-function",
  definition: "--syntax-function",
  class: "--syntax-type",
  type: "--syntax-type",
  tag: "--syntax-type",
  attribute: "--syntax-variable",
  property: "--syntax-variable",
  variable: "--syntax-variable",
  operator: "--syntax-operator",
  punctuation: "--syntax-punctuation",
  regexp: "--syntax-string",
  escape: "--syntax-string",
  meta: "--syntax-comment",
  heading: "--syntax-keyword",
  link: "--syntax-string",
};

/** The CSS custom property painting `style`, or `null` for plain (unstyled) text. */
export function syntaxCssVar(style: HighlightStyle | null): string | null {
  return style ? STYLE_TO_SYNTAX_VAR[style] : null;
}

/**
 * The `files.css` class painting `style`, or `null` for plain (unstyled)
 * text. `FileContentView` applies this as a token's `className` instead
 * of a raw inline `style={{ color: 'var(...)' }}` object: every other
 * web feature reaches design tokens through a CSS class, and jsdom's
 * inline-style parser silently drops `var()`-valued colours, which would
 * leave highlighting untestable. The class name is derived from
 * `syntaxCssVar` so the two can never drift apart.
 */
export function syntaxClassName(style: HighlightStyle | null): string | null {
  const cssVar = syntaxCssVar(style);
  return cssVar ? `pc-syntax-${cssVar.slice("--syntax-".length)}` : null;
}

/**
 * Full role→CSS-`var()`-value map for `@picompanion/highlight`'s
 * `createCodeMirrorHighlightStyle` (T30B3's CodeMirror editor), so the
 * editor paints syntax with exactly the same `--syntax-*` design tokens
 * as this module's own read-only tokenizing above — one syntax palette,
 * not two (plan.md §10.2, §10.1's "one approved treatment").
 */
export function syntaxHighlightStyleColors(): Record<HighlightStyle, string> {
  const colors = {} as Record<HighlightStyle, string>;
  for (const style of Object.keys(STYLE_TO_SYNTAX_VAR) as HighlightStyle[]) {
    colors[style] = `var(${STYLE_TO_SYNTAX_VAR[style]})`;
  }
  return colors;
}

export type { HighlightToken };

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
