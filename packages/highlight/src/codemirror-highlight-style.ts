/**
 * `createCodeMirrorHighlightStyle` builds a CodeMirror 6
 * `HighlightStyle` from the same `syntaxRoleTags` role map
 * `staticSyntaxHighlighter` (the plain read-only tokenizer, see
 * `syntax-roles.ts`) uses, so a CodeMirror editor paints syntax with
 * exactly the same roles as the read-only view. This is the only file
 * in this package that imports `@codemirror/language` purely for its
 * `HighlightStyle` — kept separate from `syntax-roles.ts` /
 * `highlighter.ts` (the read-only, always-eager path) so consumers
 * that only need `highlightCode`/`highlightLine` (e.g. the web app's
 * read-only file view) never pull CodeMirror's editor machinery in.
 */
import { HighlightStyle as CodeMirrorHighlightStyle } from "@codemirror/language";
import type { HighlightStyle } from "./types.js";
import { syntaxRoleTags } from "./syntax-roles.js";

export function createCodeMirrorHighlightStyle(colors: Record<HighlightStyle, string>) {
  return CodeMirrorHighlightStyle.define(
    syntaxRoleTags.map(({ tag, role }) => ({ tag, color: colors[role] })),
  );
}
