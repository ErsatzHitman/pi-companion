/**
 * Maps `@lezer/highlight` `Tag`s onto this package's `HighlightStyle`
 * roles. Deliberately depends only on `@lezer/highlight` (no
 * `@codemirror/language`, and transitively no `@codemirror/view`) so
 * `highlighter.ts`'s `highlightCode`/`highlightLine` — used by the
 * always-eager read-only file view (T30B2's `file-syntax-highlight.ts`)
 * — never pulls CodeMirror's editor machinery into that bundle.
 * `createCodeMirrorHighlightStyle`, which *does* need
 * `@codemirror/language`, lives in `./codemirror-highlight-style.ts`
 * instead, imported only by T30B3's editor.
 */
import { tagHighlighter, tags, type Tag } from "@lezer/highlight";
import type { HighlightStyle } from "./types.js";

export const syntaxRoleTags: ReadonlyArray<{ tag: Tag; role: HighlightStyle }> = [
  { tag: tags.keyword, role: "keyword" },
  { tag: tags.controlKeyword, role: "keyword" },
  { tag: tags.operatorKeyword, role: "keyword" },
  { tag: tags.definitionKeyword, role: "keyword" },
  { tag: tags.moduleKeyword, role: "keyword" },
  { tag: tags.comment, role: "comment" },
  { tag: tags.lineComment, role: "comment" },
  { tag: tags.blockComment, role: "comment" },
  { tag: tags.docComment, role: "comment" },
  { tag: tags.string, role: "string" },
  { tag: tags.special(tags.string), role: "string" },
  { tag: tags.number, role: "number" },
  { tag: tags.integer, role: "number" },
  { tag: tags.float, role: "number" },
  { tag: tags.bool, role: "literal" },
  { tag: tags.null, role: "literal" },
  { tag: tags.function(tags.variableName), role: "function" },
  { tag: tags.function(tags.propertyName), role: "function" },
  { tag: tags.definition(tags.variableName), role: "definition" },
  { tag: tags.definition(tags.propertyName), role: "definition" },
  { tag: tags.definition(tags.function(tags.variableName)), role: "definition" },
  { tag: tags.className, role: "class" },
  { tag: tags.definition(tags.className), role: "class" },
  { tag: tags.typeName, role: "type" },
  { tag: tags.tagName, role: "tag" },
  { tag: tags.attributeName, role: "attribute" },
  { tag: tags.attributeValue, role: "string" },
  { tag: tags.propertyName, role: "property" },
  { tag: tags.variableName, role: "variable" },
  { tag: tags.local(tags.variableName), role: "variable" },
  { tag: tags.special(tags.variableName), role: "variable" },
  { tag: tags.operator, role: "operator" },
  { tag: tags.punctuation, role: "punctuation" },
  { tag: tags.bracket, role: "punctuation" },
  { tag: tags.separator, role: "punctuation" },
  { tag: tags.regexp, role: "regexp" },
  { tag: tags.escape, role: "escape" },
  { tag: tags.meta, role: "meta" },
  { tag: tags.heading, role: "heading" },
  { tag: tags.link, role: "link" },
  { tag: tags.url, role: "link" },
];

export const staticSyntaxHighlighter = tagHighlighter(
  syntaxRoleTags.map(({ tag, role }) => ({ tag, class: role })),
);
