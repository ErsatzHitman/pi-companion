// T244: one shared, order-independent comment stripper for the four guards
// that used to hand-roll their own `stripComments` as a pair of regexes
// applied one after the other — a real, currently-shipped defect, not a
// theoretical one:
//
//   source.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, ""); // line-first
//   source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, ""); // block-first
//
// Whichever pass runs first is blind to the comment kind the OTHER pass is
// meant to protect against, and each order silently corrupts source under
// the opposite collision:
//
//   - line-first (`guard-declared-root-dependencies.mjs`, before this task)
//     blanks a `//` that appears INSIDE a real block comment, destroying
//     that block's own `*/` — so the block-comment pass, run second, keeps
//     scanning past where the real comment ended and consumes everything up
//     to the NEXT `*/` anywhere later in the file, real code included.
//     Reproduced directly against a real, in-tree file: this repository's
//     own `guard-no-duplicate-permission-state.mjs` carries the single-line
//     JSDoc `` /** Strips `/* … *‍/` and `// …` comments … */ `` (the
//     `*‍/` is written with a zero-width joiner so it cannot be mistaken for
//     a real terminator) — the literal `// …` inside it is real comment
//     TEXT, not a live line comment, but line-first stripping cannot tell
//     the difference: it blanks from that `//` to end of line, eating the
//     JSDoc's own real closing `*/`, and the pre-T244 line-first
//     `guard-declared-root-dependencies.mjs#stripComments` then deleted that
//     whole file's own `stripComments` FUNCTION DECLARATION along with it —
//     real code, not merely a comment — while scanning for the next `*/`
//     further down the file. It happened not to change that guard's
//     reported violations only because the swallowed span contained no
//     import statement; the corruption itself is real today, not
//     hypothetical.
//   - block-first (`guard-capability-prose.mjs`, `guard-no-node-builtin-in-
//     web-bundle.mjs` and `guard-no-duplicate-permission-state.mjs`, before
//     this task) has the mirror failure on a `/*` inside a real LINE
//     comment. Reproduced directly, also against a real in-tree file:
//     `guard-declared-root-dependencies.mjs`'s own header prose writes
//     `` A `@picompanion/*` specifier `` inside a `//` line comment — the
//     literal two characters `/` `*` are glob syntax, not a block-comment
//     opener, but a block-first pass cannot tell, and starts consuming
//     everything from there up to the FIRST real `*/` later in the file
//     (an unrelated JSDoc block's own terminator), deleting the real
//     `const WORKSPACE_SCOPE = "@picompanion/";` declaration that sits in
//     between. Measured at T244 with the pre-fix `guard-capability-prose.mjs`
//     itself: `isCapabilityMemberDeclared(content, "WORKSPACE_SCOPE")`
//     against this file's real content returns `false` — the guard's own
//     declaration-detection is blind to a real declaration purely because
//     of comment-stripping order, exactly the "check that cannot fail"
//     shape this repository keeps re-finding.
//
// The fix is a single left-to-right character scan that classifies the
// source into CODE / COMMENT / STRING spans as it goes, rather than two
// blind global passes. Once the scanner has committed to "this `//` starts
// a line comment" (because it reached those two characters before it ever
// saw a `/*` earlier), it consumes to end-of-line without ever re-examining
// the characters in between for a `/*` it might contain — so a real line
// comment can never be short-circuited by a glob-shaped `/*` inside it. The
// mirror holds for a real block comment: once inside one, the scanner looks
// only for the terminating `*/` and never re-interprets a `//` it passes
// over along the way. Order stops mattering because there is only one pass,
// and priority is decided by which delimiter's opening characters the
// scanner actually reaches first in the real text — which is also, not
// coincidentally, how a real JS/TS lexer decides it.
//
// String and template literals are tracked too, so a `//` or `/*`-shaped
// sequence inside a string (a URL in a log message, a glob in a string
// constant) can never be misread as starting a comment — a real hazard the
// old regex-pair approach shared with this one if left unhandled, not a new
// one this module introduces.
//
// This module ships exactly ONE stripping mode: `stripComments`, which
// removes comment text and leaves every string/template literal's content
// exactly as written. That is what every caller besides `guard-capability-
// prose.mjs` needs directly — each reads real specifiers or literal
// members back out of string content after stripping — and `guard-
// capability-prose.mjs` additionally needs comments gone before its OWN
// second, separate pass (`stripStringLiterals`, unchanged by this task) can
// safely erase string literal VALUES on top. (T256: this module has grown
// more callers than the four T244 named here; grep this directory for
// `from "./source-comment-stripper.mjs"` for the current, authoritative
// list rather than trusting a count written in a comment.)
//
// That second pass is deliberately NOT reproduced in this module, and the
// two must stay separate rather than becoming "one tokenizer that also
// erases strings": `guard-capability-prose.mjs`'s `stripStringLiterals`
// erases only SINGLE-LINE string/template literals on purpose (its own
// comment explains why — it exists to erase a literal's contents before a
// declaration check ever sees them, not to double as the multi-line-safe
// prose-flattening `joinAdjacentStringLiterals` lives beside it), and
// several of that file's own comments depend on exactly that scope. A
// generic `stripCommentsAndStrings` added here, built on this module's
// multi-line-safe template-literal scanning, would erase MORE than the
// original (multi-line template literals too) and silently change what
// `isCapabilityMemberDeclared`/`findShippedCapabilities` treat as
// "shipped" — the exact kind of silent behaviour change this task exists to
// avoid. `guard-capability-prose.mjs` therefore keeps its own
// `stripStringLiterals` and its own `stripCommentsAndStrings` composition
// completely unchanged, and only swaps its half of the composition that
// WAS this module's job — `stripComments` — for the shared, correctly-
// ordered one below. That is the "two thin wrappers over one tokenizer"
// shape: this module's `stripComments` is the one tokenizer; `guard-
// capability-prose.mjs`'s local `stripCommentsAndStrings` is the second,
// thin wrapper, unmodified except for which `stripComments` it now calls.
//
// Regex literals ARE handled, and had to be: this module's first draft
// deliberately skipped them (reasoning "none of the four guards' own prior
// regex-pair strippers understood them either, so this cannot regress
// anything"), and that reasoning was wrong in a way the per-file real-import
// pin (this task's own second acceptance criterion) caught immediately.
// `guard-declared-root-dependencies.mjs` — one of THIS module's own real
// production callers — declares its import-matching patterns as regex
// LITERALS containing a character class with a literal backtick,
// `["'`]`. A tokenizer that does not recognize a regex literal as one atomic
// span walks into that character class in plain CODE state and misreads
// the backtick as the START OF A TEMPLATE LITERAL, then runs forward
// looking for the next backtick to close it — which lands on the opening
// backtick of the very next line's own doc comment
// (`` // `import("specifier")` — dynamic import... ``), falls out of that
// bogus "template literal" state mid-comment, and reinterprets the
// remaining comment text `import("specifier")` as bare, live CODE — a
// double-quoted string included. That fake `"specifier"` string then
// satisfies `DYNAMIC_IMPORT_PATTERN` for real, and
// `findUndeclaredRootDependencies` reported a phantom undeclared dependency
// named `specifier` against this guard's own real, unmodified file — caught
// by exactly the "every file with a real import still yields a specifier,
// asserted per file" pin this task's brief requires, run against this
// module's own change before it was trusted.
//
// `canPrecedeRegex`/`scanRegexLiteral` below resolve this the same way a
// real JS lexer does: at a bare `/` (not `//`, not `/*`) in CODE state,
// look at the CODE text since the last comment/string/template boundary —
// trimmed of trailing whitespace — and treat `/` as a regex literal's
// opener when the preceding token is empty (start of an expression) or one
// of a fixed set of punctuation/keywords a value cannot legally follow
// (`(`, `[`, `{`, `,`, `;`, `=`, `return`, `typeof`, …). A regex literal is
// then scanned as ONE atomic span — including its bracketed character
// class, where an unescaped `/` does not close it — and folded into the
// surrounding CODE segment untouched, so nothing inside it (a quote, a
// backtick, an escaped slash) is ever re-examined as a comment or string
// delimiter. This is a heuristic, the same one real formatters and
// minifiers use for the same ambiguity, not a full parser — division after
// an identifier or a closing `)`/`]`/`}` is correctly left alone.
//
// T244 originally verified this against the scan scope of the four guards
// this module then had: no file any of them read contained a genuinely
// ambiguous case, checked via that task's own before/after diff. Three
// more callers landed since (T247's `guard-android-release-tag-version.mjs`;
// T252's `guard-no-legacy-schema-reader.mjs` and `orphan-modules.mjs`; a
// later gate's `guard-declared-workspace-deps.mjs`) without that
// verification being re-run — a stale headcount sitting on a claim nobody
// had re-checked (T256).
//
// T256 re-ran it, widened to cover every one of this module's current
// callers by construction: `orphan-modules.mjs`'s own scan scope is every
// tracked module file (`git ls-files` filtered to
// `.ts`/`.tsx`/`.js`/`.jsx`/`.mjs`/`.cjs`, excluding `.d.ts` — 2,247 files
// at `0b46ed6`), which a read of every other caller's own file-selection
// code confirms is a strict superset of each of theirs (all narrower:
// one file, or `.ts`/`.tsx` under specific prefixes). Method: for every
// one of those 2,247 files, a full TypeScript parse (`ts.createSourceFile`,
// the real parser, which resolves regex-vs-division exactly the way a real
// lexer does) supplied ground-truth `RegularExpressionLiteral` spans; a
// reference stripper built on those spans instead of this module's own
// heuristic was diffed BYTE FOR BYTE against this module's real
// `stripComments` output on the same file. Zero of the 2,247 files
// differed — today, this heuristic never actually corrupts output for any
// file any current caller scans.
//
// That whole-tree diff is not the same claim as "the heuristic is always
// right", and the gap was found, not assumed away: comparing the
// heuristic's own regex-start decisions (not just final output) against
// the same ground truth found 334 of the 2,247 files where a JSX CLOSING
// tag's `/` (`</Foo>`) makes `canPrecedeRegex` return true — the character
// immediately before it (`<`) is one of the real preceding tokens a genuine
// regex literal can follow, and this heuristic has no notion of JSX at all.
//
// (CORRECTED at the P9-H merge gate. This said "a JSX closing OR
// SELF-CLOSING tag's `/` (`</Foo>`, `<Bar />`)" triggers it. The
// self-closing half is false, twice over, and both halves were disproved by
// calling the real exported function rather than by reasoning about it:
//
//   "</Foo> // real comment"   -> comment LEAKED
//   "<Bar /> // real comment"  -> comment stripped correctly
//   "<Bar/> // real comment"   -> comment stripped correctly
//
// `canPrecedeRegex` returns FALSE at a self-closing tag's slash, and the
// character immediately before that slash is a space (or the tag name's
// last letter), never `<`. Only the closing-tag shape triggers. This matters
// because this paragraph is the standing instruction for the next caller: a
// reader auditing a `.tsx` file would look for self-closing tags, which are
// safe, and could reasonably stop there. The count above is left as measured
// — what was wrong was its stated composition, not the measurement.) None of those 334 happened to
// swallow a real comment or string today (hence the byte-for-byte diff
// staying at zero), but the underlying trigger is real, not merely
// theoretical: a source line reading `</Foo> // real comment`, run through
// this module's actual `stripComments`, leaves the comment text
// UNSTRIPPED in the output (the false "regex" scan consumes past the
// comment's own `//`, so the main loop never re-examines it as a comment
// start) — reproduced directly, not assumed, against this module's real
// exported function. `source-comment-stripper.test.mjs` pins this as a
// known, currently-inert limitation with a regression test, so a future
// caller whose scan scope includes a `.tsx`/`.jsx` file carrying a real
// comment or string shortly after a JSX tag's `/` is the case that would
// turn this from "checked, currently clean" into a live corruption — not a
// hypothetical this module has already ruled out.
//
// (CORRECTED at T263: the gap this paragraph and the one above it describe
// is now closed, not merely documented as inert. `canPrecedeRegex` no
// longer treats `<` as a token a regex literal can follow at all — see
// `REGEX_PRECEDING_PUNCTUATION`'s own comment for the fix and why `<` was
// removed outright rather than special-cased on JSX shape. Re-running
// T256's whole-tree oracle comparison after the fix, at the same method
// (a real TypeScript parse supplying ground-truth `RegularExpressionLiteral`
// spans, diffed byte-for-byte against this module's real `stripComments`
// output): 0 of 2,248 tracked module files differ, both before and after
// this fix — the fix changes zero currently-scanned files' output, exactly
// as T256 predicted since none of the 334 files hit the trigger. Separately
// measured, not assumed: of the tree's 2,691 real `RegularExpressionLiteral`
// spans, ZERO have `<` as their immediately preceding code token, so
// removing `<` swallows no real regex anywhere in the tree today.
// `source-comment-stripper.test.mjs`'s two regression tests for this shape
// were updated in the same commit — both now assert the comment strips
// correctly, not left pinned to the old leaking behaviour. The 334-file
// count and the "currently-inert" framing in the two paragraphs above are
// historical, describing what was true at the P9-H gate; they are not
// current claims.)
//
// Whichever of this module's callers exist when you read this, this
// safety claim describes only what was measured, against the scope that
// was measured, as of the commit that measured it. A ninth caller (or a
// tenth) inherits the tokenizer, not this verification — re-run it, the
// same way T256 did, before trusting this paragraph again.
//
// Pure, dependency-free. `source-comment-stripper.test.mjs` covers this
// directly; each guard's own test file additionally re-proves its own real
// collision case (see each guard's own header/test for the specific real
// file and real capability/import affected).

/**
 * Scans a block comment starting at `i` (pointing at the opening `/*`) and
 * returns the index just past where it closes — or `source.length` if the
 * comment is unterminated, in which case the rest of the file is treated as
 * comment text (this never happens on real, syntactically valid committed
 * source, which is the only kind any caller of this module ever scans).
 * @param {string} source @param {number} i @returns {number}
 */
function scanBlockComment(source, i) {
  const n = source.length;
  i += 2; // past the opening "/*"
  while (i < n && !(source[i] === "*" && source[i + 1] === "/")) i += 1;
  return Math.min(i + 2, n);
}

/**
 * Scans a line comment starting at `i` (pointing at the first `/` of `//`)
 * and returns the index of the terminating newline (or `source.length`),
 * never past it — the newline itself is left for the caller to treat as
 * ordinary code, matching the prior hand-rolled `//.*$` behaviour every
 * migrated caller had, none of which ever consumed the line break either.
 * @param {string} source @param {number} i @returns {number}
 */
function scanLineComment(source, i) {
  const n = source.length;
  i += 2; // past the opening "//"
  while (i < n && source[i] !== "\n") i += 1;
  return i;
}

// Punctuation a value expression cannot legally follow — so a `/` right
// after one of these is a regex literal's opener, never division.
//
// `<` is deliberately NOT a member (T263). In real JS/TS grammar it is a
// legal preceding token for a genuine regex literal (`a < /x/.test(b)`,
// a less-than comparison against a regex-derived boolean), which is why it
// was here originally — but this module never parses JSX, so it has no way
// to tell that shape apart from a JSX CLOSING tag's `/` (`</Foo>`), where
// the character immediately before the slash is also `<` and `<` is not an
// expression position at all. With `<` included, `canPrecedeRegex` treated
// `</Foo>`'s `/` as a regex opener, `scanRegexLiteral` then hunted forward
// for the next un-classed `/` and found the first slash of a following real
// `//` comment, folding it into the fake "regex" span — so the comment's
// own `//` was never re-examined as a comment start and survived into
// `stripComments`' output unstripped. Filed as T256's known-inert
// limitation, closed here: removing `<` fixes both the JSX shape and the
// equivalent non-JSX one (`x < /b // real comment`, pinned in this file's
// own test), since a character scan cannot distinguish "comparison operator"
// from "JSX closing tag" by any means available to it — the only options
// were "never allow a regex after `<`" or "understand JSX", and this module
// stays JSX-unaware on purpose (see the module header). Measured, not
// assumed, that this costs nothing today: T263 re-ran T256's whole-tree
// oracle (a real TypeScript parse supplying ground-truth
// `RegularExpressionLiteral` spans) over every one of the 2,248 tracked
// module files at the pre-fix commit and found ZERO whose real regex
// literal's immediately preceding code token is `<` — so no regex literal in
// this tree is affected. See this module's header comment for the full
// T256/T263 history and the byte-diff counts before and after.
//
// (CORRECTED at the P9-J merge gate. This said removing `<` "does not start
// misreading any regex literal that exists in this tree today as division".
// The measurement is right; the framing understates what a misread COSTS, and
// a future reader weighing whether to re-add `<` needs the real figure. A
// regex after `<` is not read as harmless division — the scan then treats a
// `//` inside the regex body as a line comment and swallows the rest of the
// line. Executed against the real exported `stripComments`, with both regexes
// confirmed as genuine `RegularExpressionLiteral` spans by a TypeScript parse:
//
//   if (n < /[//]/.test(s)) { keepMe(); }    ->  "if (n < /["
//   if (n < /a[//]b/.test(s)) { keepMe(); }  ->  "if (n < /a["
//
// `keepMe()` is deleted from the stripped output in both. So T263 traded one
// silent failure mode for another; the trade is sound only because BOTH are
// inert on this tree — zero JSX-closing-tag leaks and zero regexes after `<`
// — and the JSX shape is the one that recurs in `.tsx`, which
// `orphan-modules.mjs` now walks in full. If a regex after `<` ever appears,
// the answer is to understand JSX, not to re-add `<`.)
const REGEX_PRECEDING_PUNCTUATION = new Set([
  "(",
  "[",
  "{",
  ",",
  ";",
  ":",
  "!",
  "&",
  "|",
  "?",
  "=",
  "+",
  "-",
  "*",
  "%",
  "^",
  "~",
  ">",
  "/",
]);

// Keywords a regex literal can directly follow (`return /x/`, `typeof /x/`,
// …) even though the keyword itself is a trailing identifier, which the
// punctuation set above cannot express.
const REGEX_PRECEDING_KEYWORDS = new Set([
  "return",
  "typeof",
  "instanceof",
  "in",
  "of",
  "new",
  "do",
  "else",
  "yield",
  "throw",
  "case",
  "void",
  "delete",
  "await",
  "default",
]);

/**
 * Whether a `/` immediately following `codeSinceLastBoundary` (the CODE
 * text since the last comment/string/template span, i.e. never itself
 * containing one) opens a regex literal rather than a division operator.
 * @param {string} codeSinceLastBoundary
 * @returns {boolean}
 */
function canPrecedeRegex(codeSinceLastBoundary) {
  const trimmed = codeSinceLastBoundary.replace(/\s+$/, "");
  if (trimmed === "") return true; // start of file, or right after a comment/string/template
  const lastChar = trimmed[trimmed.length - 1];
  if (REGEX_PRECEDING_PUNCTUATION.has(lastChar)) return true;
  const trailingWord = trimmed.match(/[A-Za-z_$][A-Za-z0-9_$]*$/);
  return Boolean(trailingWord && REGEX_PRECEDING_KEYWORDS.has(trailingWord[0]));
}

/**
 * Scans a regex literal starting at `i` (pointing at the opening `/`,
 * already confirmed by `canPrecedeRegex`) and returns the index just past
 * its trailing flags. An unescaped `/` inside a bracketed character class
 * (`[...]`) does not close the literal, matching real regex syntax — this
 * is what protects `["'`]`-shaped character classes (this module's own
 * motivating case; see this file's header) from being misread.
 * @param {string} source @param {number} i @returns {number}
 */
function scanRegexLiteral(source, i) {
  const n = source.length;
  i += 1; // past the opening "/"
  let inClass = false;
  while (i < n) {
    const c = source[i];
    if (c === "\\") {
      i += 2;
      continue;
    }
    if (c === "\n") return i; // unterminated; never consume the newline
    if (c === "[") {
      inClass = true;
      i += 1;
      continue;
    }
    if (c === "]") {
      inClass = false;
      i += 1;
      continue;
    }
    if (c === "/" && !inClass) {
      i += 1;
      break;
    }
    i += 1;
  }
  while (i < n && /[A-Za-z]/.test(source[i])) i += 1; // trailing flags
  return i;
}

/**
 * Scans a single- or double-quoted string starting at `i` (pointing at the
 * opening quote) and returns the index just past its closing quote. Stops
 * at an unescaped newline without consuming it (an unterminated string is a
 * syntax error in real JS/TS; this just avoids running the "string" state
 * on into the rest of the file when it happens).
 * @param {string} source @param {number} i @param {string} quote @returns {number}
 */
function scanQuotedString(source, i, quote) {
  const n = source.length;
  i += 1; // past the opening quote
  while (i < n) {
    const c = source[i];
    if (c === "\\") {
      i += 2;
      continue;
    }
    if (c === quote) return i + 1;
    if (c === "\n") return i;
    i += 1;
  }
  return i;
}

/**
 * Scans the CODE living inside a template literal's `${ … }` interpolation,
 * starting just after the `${`, tracking nested `{`/`}` pairs (an object
 * literal or block inside the interpolation) and recursing into any
 * comment, string, or nested template literal it contains, so the correct
 * matching `}` is found even when the interpolation's own code is not
 * trivial. Returns the index just past that matching `}` — or
 * `source.length` if the interpolation never closes.
 * @param {string} source @param {number} i @returns {number}
 */
function scanInterpolation(source, i) {
  const n = source.length;
  let depth = 0;
  let runStart = i; // CODE text since the last comment/string/template/regex boundary
  while (i < n) {
    const c = source[i];
    const c2 = i + 1 < n ? source[i + 1] : "";
    if (c === "/" && c2 === "/") {
      i = scanLineComment(source, i);
      runStart = i;
      continue;
    }
    if (c === "/" && c2 === "*") {
      i = scanBlockComment(source, i);
      runStart = i;
      continue;
    }
    if (c === "/" && canPrecedeRegex(source.slice(runStart, i))) {
      i = scanRegexLiteral(source, i);
      continue; // part of the same CODE run — do not reset runStart
    }
    if (c === '"' || c === "'") {
      i = scanQuotedString(source, i, c);
      runStart = i;
      continue;
    }
    if (c === "`") {
      i = scanTemplateLiteral(source, i);
      runStart = i;
      continue;
    }
    if (c === "{") {
      depth += 1;
      i += 1;
      continue;
    }
    if (c === "}") {
      if (depth === 0) return i + 1;
      depth -= 1;
      i += 1;
      continue;
    }
    i += 1;
  }
  return i;
}

/**
 * Scans a template literal starting at `i` (pointing at the opening
 * backtick), including any nested `${ … }` interpolations — which may
 * themselves contain further nested template literals, strings, and
 * comments — and returns the index just past the closing backtick.
 *
 * The whole span, interpolations included, is treated as one opaque STRING
 * segment by every caller in this module: none of them ever needs to
 * look for an import statement, a capability
 * declaration, or a permission-state union INSIDE a `${ … }` interpolation
 * (none of those shapes are legal there), so sub-classifying the
 * interpolation's own code/comment/string spans would add real complexity
 * for zero behavioural difference. `scanInterpolation` only ever exists to
 * find the correct matching `}` — it does not change what gets returned
 * here.
 * @param {string} source @param {number} i @returns {number}
 */
function scanTemplateLiteral(source, i) {
  const n = source.length;
  i += 1; // past the opening `
  while (i < n) {
    const c = source[i];
    if (c === "\\") {
      i += 2;
      continue;
    }
    if (c === "`") return i + 1;
    if (c === "$" && source[i + 1] === "{") {
      i = scanInterpolation(source, i + 2);
      continue;
    }
    i += 1;
  }
  return i;
}

/**
 * @typedef {{ kind: "code" | "comment" | "string", text: string }} SourceSegment
 */

/**
 * Classifies `source` into an ordered list of CODE / COMMENT / STRING
 * segments via one left-to-right scan — the core `stripComments` below is
 * built on. Exported so a caller needing a different mode (e.g. `guard-
 * capability-prose.mjs`'s own further string-erasure pass) is not forced to
 * add a second copy of the scan itself; none exists today because that
 * file's own `stripStringLiterals` stays regex-based on purpose (see this
 * module's header).
 * @param {string} source
 * @returns {SourceSegment[]}
 */
export function classifySource(source) {
  const n = source.length;
  /** @type {SourceSegment[]} */
  const segments = [];
  let i = 0;
  let codeStart = 0;

  const flushCode = (end) => {
    if (end > codeStart) segments.push({ kind: "code", text: source.slice(codeStart, end) });
  };

  while (i < n) {
    const c = source[i];
    const c2 = i + 1 < n ? source[i + 1] : "";

    if (c === "/" && c2 === "/") {
      flushCode(i);
      const start = i;
      i = scanLineComment(source, i);
      segments.push({ kind: "comment", text: source.slice(start, i) });
      codeStart = i;
      continue;
    }
    if (c === "/" && c2 === "*") {
      flushCode(i);
      const start = i;
      i = scanBlockComment(source, i);
      segments.push({ kind: "comment", text: source.slice(start, i) });
      codeStart = i;
      continue;
    }
    if (c === "/" && canPrecedeRegex(source.slice(codeStart, i))) {
      i = scanRegexLiteral(source, i); // stays part of the current CODE run
      continue;
    }
    if (c === '"' || c === "'") {
      flushCode(i);
      const start = i;
      i = scanQuotedString(source, i, c);
      segments.push({ kind: "string", text: source.slice(start, i) });
      codeStart = i;
      continue;
    }
    if (c === "`") {
      flushCode(i);
      const start = i;
      i = scanTemplateLiteral(source, i);
      segments.push({ kind: "string", text: source.slice(start, i) });
      codeStart = i;
      continue;
    }
    i += 1;
  }
  flushCode(n);
  return segments;
}

/**
 * Strips block and line comments, order-independent, preserving every
 * string and template literal's content exactly as written (this is the
 * mode `guard-declared-root-dependencies.mjs`, `guard-no-node-builtin-in-
 * web-bundle.mjs` and `guard-no-duplicate-permission-state.mjs` need: each
 * reads real specifiers or literal members back out of string content after
 * stripping). Comment text is dropped entirely, including any newlines a
 * block comment spans — matching the prior (order-dependent), hand-rolled
 * `stripComments` behaviour every migrated caller had on well-formed,
 * non-colliding input; the two collisions documented at the top of this
 * module are what changes.
 * @param {string} source
 * @returns {string}
 */
export function stripComments(source) {
  let out = "";
  for (const segment of classifySource(source)) {
    if (segment.kind !== "comment") out += segment.text;
  }
  return out;
}
