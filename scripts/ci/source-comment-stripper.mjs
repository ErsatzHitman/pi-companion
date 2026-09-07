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
// exactly as written. That is what all four guards need directly —
// `guard-declared-root-dependencies.mjs`, `guard-no-node-builtin-in-web-
// bundle.mjs` and `guard-no-duplicate-permission-state.mjs` each read real
// specifiers or literal members back out of string content after stripping,
// and `guard-capability-prose.mjs` needs comments gone before its OWN
// second, separate pass (`stripStringLiterals`, unchanged by this task) can
// safely erase string literal VALUES on top.
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
// an identifier or a closing `)`/`]`/`}` is correctly left alone, and no
// production file scanned by any of the four guards contains a genuinely
// ambiguous case (checked as part of this task's before/after diff on
// every real file each guard scans, not assumed).
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
 * source, which is all four guards ever scan).
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
 * ordinary code, matching every one of the four guards' prior `//.*$`
 * behaviour, which never consumed the line break either.
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
  "<",
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
 * segment by every caller in this module: none of the four guards this
 * module serves ever needs to look for an import statement, a capability
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
 * block comment spans — matching every one of the four guards' prior
 * (order-dependent) `stripComments` behaviour on well-formed, non-colliding
 * input; the two collisions documented at the top of this module are what
 * changes.
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
