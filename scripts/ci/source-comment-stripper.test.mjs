import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { classifySource, stripComments } from "./source-comment-stripper.mjs";

// --- basic comment stripping, both kinds, without collisions --------------

test("stripComments removes a line comment, keeping the trailing newline", () => {
  const source = "// a whole line comment\nconst y = 1;\n";
  const stripped = stripComments(source);
  assert.equal(stripped, "\nconst y = 1;\n");
});

test("stripComments removes a block comment entirely, including its own internal newlines", () => {
  const source = ["/**", " * header", " * more header", " */", "const y = 1;"].join("\n");
  const stripped = stripComments(source);
  // The block comment itself (`/**\n * header\n * more header\n */`) is
  // removed as one span; the newline BETWEEN that span and `const y = 1;`
  // was never part of the comment, so it survives — matching the old
  // regex-pair behaviour on well-formed input exactly.
  assert.equal(stripped, "\nconst y = 1;");
});

test("stripComments removes a trailing same-line comment without touching the code before it", () => {
  const source = 'import { x } from "./x.js"; // trailing comment\n';
  const stripped = stripComments(source);
  assert.equal(stripped, 'import { x } from "./x.js"; \n');
});

// --- string/template literal content is preserved verbatim ----------------

test("stripComments preserves a double-quoted string containing comment-shaped text", () => {
  const source = 'const url = "http://example.com/* not a comment */ // also not";\n';
  assert.equal(stripComments(source), source);
});

test("stripComments preserves a single-quoted string with an escaped quote", () => {
  const source = "const s = 'it\\'s // not a comment either';\n";
  assert.equal(stripComments(source), source);
});

test("stripComments preserves a template literal, including a nested interpolation with braces", () => {
  const source = "const t = `a ${ { x: 1 } } b // not a comment`;\n";
  assert.equal(stripComments(source), source);
});

test("stripComments preserves a template literal containing a nested template literal", () => {
  const source = "const t = `outer ${`inner ${1 + 1}`} done`;\nconst y = 1;\n";
  assert.equal(stripComments(source), source);
});

test("a real comment INSIDE a template literal's interpolation is left untouched (documented limitation)", () => {
  // The whole template literal, interpolation included, is treated as one
  // opaque string span (see source-comment-stripper.mjs's own comment on
  // scanTemplateLiteral) — this is a deliberate scope decision, not
  // something any of the four guards this module serves ever needs, since
  // none of them look for an import/declaration/literal-union shape inside
  // a `${ … }` interpolation.
  const source = "const t = `a ${ /* comment */ 1 } b`;\n";
  assert.equal(stripComments(source), source);
});

// --- collision 1: a real block comment containing literal `//`-shaped text
// must not have its own closing `*/` destroyed by a naive line-first pass —
// this is the exact shape `guard-no-duplicate-permission-state.mjs`'s own
// real header carries (`/** Strips ... `// …` comments ... */`) -----------

test("collision 1: a `//`-shaped sequence inside a real block comment does not swallow the code that follows", () => {
  const source = [
    "/** Strips block comments and `// …` line comments. */",
    "function real() { return 1; }",
  ].join("\n");

  const stripped = stripComments(source);

  assert.match(stripped, /function real\(\) \{ return 1; \}/);
});

test("collision 1, reproduced against the real guard-no-duplicate-permission-state.mjs header", () => {
  const content = readFileSync(
    fileURLToPath(new URL("./guard-no-duplicate-permission-state.mjs", import.meta.url)),
    "utf8",
  );
  const stripped = stripComments(content);

  // This file's real header still carries the exact hazard shape (a
  // zero-width-joined `` /** Strips `/* … *‍/` and `// …` comments … */ ``
  // doc comment, left in place on purpose — see that file's own T244
  // comment). Before T244, feeding this same content through
  // `guard-declared-root-dependencies.mjs`'s then-shipped line-first
  // `stripComments` deleted this file's own (then locally-declared)
  // `stripComments` function entirely, along with everything from the
  // header's `// …` text through the next unrelated block comment's real
  // closing delimiter — reproduced directly in this task's report. The real
  // declarations that used to sit in the swallowed span must all survive
  // the shared stripper.
  assert.match(stripped, /export\s*\{\s*stripComments\s*\}/);
  assert.match(stripped, /function\s+extractStringLiterals/);
  assert.match(stripped, /export\s+function\s+findDuplicatePermissionStateUnions/);

  // Before/after, on the same real content: the exact line-first-then-block
  // regex pair this guard's own sibling (`guard-declared-root-
  // dependencies.mjs`) shipped before T244 loses this file's real
  // `export { stripComments };` statement entirely; the shared stripper
  // does not.
  const lineFirst = (s) => s.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.equal(/export\s*\{\s*stripComments\s*\}/.test(lineFirst(content)), false);
  assert.equal(/export\s*\{\s*stripComments\s*\}/.test(stripped), true);
});

// --- collision 2: a `/*`-shaped sequence inside a real LINE comment must
// not be misread as a block-comment opener that then swallows real code up
// to some unrelated later `*/` — the mirror hazard, reproduced against the
// real guard-declared-root-dependencies.mjs header, which writes a literal
// `@picompanion/*` glob inside a `//` comment right before a real
// `const WORKSPACE_SCOPE = "@picompanion/";` declaration -------------------

test("collision 2: a `/*`-shaped sequence inside a real line comment does not swallow the code that follows", () => {
  const source = [
    "// A `@picompanion/*` specifier is this repository's own workspace scope.",
    'const WORKSPACE_SCOPE = "@picompanion/";',
    "/**",
    " * @returns {boolean}",
    " */",
    "function isWorkspaceSpecifier() { return true; }",
  ].join("\n");

  const stripped = stripComments(source);

  assert.match(stripped, /const WORKSPACE_SCOPE = "@picompanion\/";/);
  assert.match(stripped, /function isWorkspaceSpecifier\(\) \{ return true; \}/);
});

test("collision 2, reproduced against the real guard-declared-root-dependencies.mjs header", () => {
  const content = readFileSync(
    fileURLToPath(new URL("./guard-declared-root-dependencies.mjs", import.meta.url)),
    "utf8",
  );
  const stripped = stripComments(content);

  // Before T244 (block-first order applied to this same file, reproduced in
  // this task's report): this declaration was deleted, along with
  // everything from the header's `@picompanion/*` glob text through the
  // next unrelated JSDoc block's real closing delimiter.
  assert.match(stripped, /const WORKSPACE_SCOPE = "@picompanion\/";/);
  assert.match(stripped, /export\s+function\s+findUndeclaredRootDependencies/);

  // Before/after, on the same real content: the exact block-first-then-line
  // regex pair `guard-capability-prose.mjs`, `guard-no-node-builtin-in-web-
  // bundle.mjs` and `guard-no-duplicate-permission-state.mjs` all shipped
  // before T244 loses the declaration; the shared stripper does not.
  const blockFirst = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.equal(/const WORKSPACE_SCOPE/.test(blockFirst(content)), false);
  assert.equal(/const WORKSPACE_SCOPE/.test(stripped), true);
});

// --- classifySource: the segments stripComments is built from -------------

test("classifySource labels code, comment and string spans in order", () => {
  const source = 'const a = 1; // c\nconst b = "s";\n';
  const segments = classifySource(source);
  const kinds = segments.map((s) => s.kind);
  const rejoined = segments.map((s) => s.text).join("");
  assert.equal(rejoined, source);
  assert.deepEqual(kinds, ["code", "comment", "code", "string", "code"]);
});

// --- T256: the JSX-tag-slash class, found by the whole-tree re-verification,
// currently inert but not hypothetical ---------------------------------

test("documented limitation: a JSX closing tag's `/` can make canPrecedeRegex fire, and a real trailing comment survives unstripped", () => {
  // `<` is one of the real punctuation tokens a genuine regex literal can
  // follow in plain JS/TS expression grammar (canPrecedeRegex has no way to
  // know this `<` opened a JSX closing tag rather than a comparison), so the
  // `/` of `</Foo>` is misread as opening a regex literal. scanRegexLiteral
  // then hunts forward for the next un-classed `/` — the first `/` of the
  // real trailing `//` comment — and treats THAT as the regex's closing
  // slash, so the main loop never re-examines the comment's own `//` as a
  // comment start. This is the T256 whole-tree re-verification's one
  // disclosed gap (see this module's own header paragraph near
  // `canPrecedeRegex`/`scanRegexLiteral`): none of the 2,247 tracked module
  // files scanned at the time hit it, but the trigger itself is real.
  const source = "const a = (\n  </Foo> // real comment, should vanish\n);\n";
  const stripped = stripComments(source);
  assert.equal(stripped.includes("real comment, should vanish"), true);
});

test("documented limitation does not require JSX: any `<` immediately before a single `/`, with a real `//` comment shortly after, reproduces it", () => {
  // Confirms the trigger is exactly canPrecedeRegex's treatment of `<`
  // (real JS grammar: a regex literal legally follows `<`), not something
  // specific to a JSX parser context this module never runs in — this
  // module only ever sees raw text, never a parsed JSX tree, so it cannot
  // tell "less-than, divide" from "start of a JSX closing tag" apart. An
  // adjacent `//` (no character in between) is NOT ambiguous — the
  // unambiguous comment-start check runs before the regex heuristic ever
  // sees it, so a bare `x < // comment` strips correctly. The defect needs
  // exactly one non-`/` character between the opening `/` and the real
  // `//`, matching `</Foo>`'s shape (`/`, then `Foo>`, then the comment).
  const adjacent = "x < // real comment, should vanish\n  1;\n";
  assert.equal(stripComments(adjacent).includes("real comment, should vanish"), false);

  const oneCharBetween = "x < /b // real comment, should vanish\n  1;\n";
  assert.equal(stripComments(oneCharBetween).includes("real comment, should vanish"), true);
});
