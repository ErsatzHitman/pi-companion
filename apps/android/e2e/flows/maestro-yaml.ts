/**
 * T72 — a minimal, RN-free parser over Maestro's flow yaml dialect, so
 * every `*.contract.test.ts` in this directory can read its own
 * `../maestro/*.yaml` file and check its literal `assertVisible` steps
 * against real, source-derived values, instead of only checking a
 * hand-typed `*-contract.ts` constants file against itself.
 *
 * Why this exists: before this file, no contract test in this directory
 * ever called `readFileSync` on its own `.yaml` flow for anything but a
 * whole-file `toMatch` (a handful of files did that for one literal
 * sentence — see `accessibility-audit.contract.test.ts`'s
 * `extensionSheetsFlow` check — but none parsed the flow's actual step
 * sequence). Every `*-contract.ts` file already carries a comment saying
 * "`<flow>.yaml` restates each value inline ... `<flow>.contract.test.ts`
 * is what actually keeps that restatement honest, not this file by
 * itself" — but nothing made that true: the contract tests compared
 * `entryStatusLabel("failed")` (real source) against
 * `COMPOSER_INPUTS_FLOW.entryFailedLabel` (a hand-typed string in a
 * TypeScript file `composer-inputs.yaml` cannot import), never against
 * the yaml file's own bytes. `composer-inputs.yaml` drifted into
 * asserting `text: "Sent"` on a premise T32S13 had already destroyed
 * (an unpaired send settles `{ status: "failed" }`, not `"Sent"`) and
 * every one of those existing checks stayed green throughout, because
 * none of them ever looked at the yaml. The P5-W19 merge gate fixed that
 * one file by hand; this module is what makes the class of drift
 * impossible to reintroduce silently.
 *
 * Deliberately not a real yaml parser: every flow in `../maestro/` uses
 * one line per step (`- <command>:`) and one line per selector key
 * (`    id: "..."` / `    text: "..."`), or an inline scalar
 * (`- inputText: "..."`) — a narrow enough dialect that a full grammar
 * is unwarranted. `parseMaestroSteps` walks line by line instead, and
 * throws nothing: a caller that finds no matching step gets `undefined`
 * or an empty array back and is expected to `expect()` on that itself,
 * so vitest's own failure message (with this module's line numbers
 * folded in by the caller) names what went missing.
 */

export interface MaestroStep {
  /** 1-indexed line number of the step's own `- <kind>:` line, folded into callers' failure messages so they name *where* in the yaml, not just *that* something drifted. */
  readonly line: number;
  /** The step's command name, e.g. `"assertVisible"`, `"assertNotVisible"`, `"tapOn"`, `"inputText"`, `"openLink"`. */
  readonly kind: string;
  /** The step's `id:` selector, when present (block form, e.g. `assertVisible`/`tapOn`). */
  readonly id?: string;
  /** The step's `text:` selector, when present (block form). */
  readonly text?: string;
  /** The step's inline scalar value, when the step is written as `- kind: "value"` rather than a block (e.g. `inputText`, `openLink`, `stopApp`). */
  readonly value?: string;
}

// `- assertVisible:` / `-   tapOn:` — a block step with selectors on
// following indented lines.
const BLOCK_STEP = /^\s*-\s*([A-Za-z][A-Za-z0-9]*):\s*$/;
// `- inputText: "Testing composer keyboard entry"` — an inline scalar
// step. Requires the quoted form every flow in this directory uses.
const INLINE_STEP = /^\s*-\s*([A-Za-z][A-Za-z0-9]*):\s*"([^"]*)"\s*$/;
// `    id: "composer-send"` / `    text: "Failed"` — a selector line
// nested under a block step.
const SELECTOR_LINE = /^\s+(id|text):\s*"([^"]*)"\s*$/;
// `# prose...` / `#` (a bare, content-free comment line, used as a
// paragraph separator within a header — see `parseMaestroCommentBlocks`
// below) — any line whose first non-whitespace character is `#`.
const COMMENT_LINE = /^\s*#(.*)$/;

/**
 * Parses every step out of a Maestro flow's raw yaml text, in document
 * order. Only recognises the two step shapes every flow in
 * `../maestro/` actually uses (see the regexes above) — a step written
 * some other way (there are none today) is silently skipped rather than
 * mis-parsed, since a caller only ever searches for specific
 * kinds/ids/texts it already knows this directory's flows use.
 */
export function parseMaestroSteps(yamlText: string): MaestroStep[] {
  const lines = yamlText.split(/\r?\n/);
  const steps: MaestroStep[] = [];
  for (let i = 0; i < lines.length; i++) {
    const inline = INLINE_STEP.exec(lines[i]);
    if (inline) {
      steps.push({ line: i + 1, kind: inline[1], value: inline[2] });
      continue;
    }
    const block = BLOCK_STEP.exec(lines[i]);
    if (!block) continue;
    let id: string | undefined;
    let text: string | undefined;
    for (let j = i + 1; j < lines.length; j++) {
      const selector = SELECTOR_LINE.exec(lines[j]);
      if (!selector) break;
      if (selector[1] === "id") id = selector[2];
      else text = selector[2];
    }
    steps.push({ line: i + 1, kind: block[1], id, text });
  }
  return steps;
}

/**
 * Every `assertVisible` step's `text:` value that appears anywhere
 * after the LAST `tapOn` step targeting `id: sendButtonId`, up to (but
 * not including) the next `tapOn`/`inputText` step or the end of the
 * flow — i.e. everything the flow asserts is visible immediately after
 * pressing Send, before it does anything else. Used to check that a
 * flow never asserts a status label the wired app cannot actually
 * reconcile a send to (e.g. `"Sent"`, when nothing in this wave pairs
 * with a daemon).
 *
 * Returns one array per matching `tapOn`, in document order, so a flow
 * that sends more than once (`offline-cache-outbox.yaml`) gets checked
 * at each send, not just the first.
 */
export function assertVisibleTextsAfterEachTap(
  steps: readonly MaestroStep[],
  sendButtonId: string,
): string[][] {
  const results: string[][] = [];
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (step.kind !== "tapOn" || step.id !== sendButtonId) continue;
    const texts: string[] = [];
    for (let j = i + 1; j < steps.length; j++) {
      const next = steps[j];
      if (next.kind === "tapOn" || next.kind === "inputText") break;
      if (next.kind === "assertVisible" && next.text !== undefined) texts.push(next.text);
    }
    results.push(texts);
  }
  return results;
}

/* -------------------------------------------------------------------- */
/* T84 — reading flow COMMENTS, not only their steps.                    */
/* -------------------------------------------------------------------- */

/**
 * A contiguous run of `#`-prefixed lines, joined into one
 * whitespace-normalized string so a citation that wraps across the
 * ~80-column prose every flow in this directory uses (see
 * `composer-inputs.yaml`'s header: "`features/share/index.ts` now" ends
 * one line, `says "Mounted as of T69"` starts the next) can still be
 * matched with a single, non-multiline regex. `startLine` plus
 * `lineOffsets` (each source line's start index into `text`) let a
 * caller map any match's `.index` back to the physical line it came
 * from — `lineForOffset` below does exactly that — so a failure can name
 * *where* in the yaml a citation lives, the same way `MaestroStep.line`
 * already does for steps.
 *
 * A blank `#` line (bare, no trailing text) does NOT end a block: every
 * flow in this directory uses one to separate paragraphs within a single
 * prose comment (see `composer-inputs.yaml`'s numbered "1. KEYBOARD
 * ENTRY" / "2. SHARE INTENT" split), and a citation legitimately
 * straddles those too.
 */
export interface MaestroCommentBlock {
  readonly startLine: number;
  readonly text: string;
  readonly lineOffsets: readonly { readonly line: number; readonly offset: number }[];
}

export function parseMaestroCommentBlocks(yamlText: string): MaestroCommentBlock[] {
  const lines = yamlText.split(/\r?\n/);
  const blocks: MaestroCommentBlock[] = [];
  let startLine = -1;
  let parts: string[] = [];
  let offsets: { line: number; offset: number }[] = [];
  const flush = () => {
    if (startLine !== -1) {
      blocks.push({ startLine, text: parts.join(" "), lineOffsets: offsets });
    }
    startLine = -1;
    parts = [];
    offsets = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const m = COMMENT_LINE.exec(lines[i]);
    if (!m) {
      flush();
      continue;
    }
    if (startLine === -1) startLine = i + 1;
    const offset = parts.reduce((n, p) => n + p.length + 1, 0);
    offsets.push({ line: i + 1, offset });
    parts.push(m[1]);
  }
  flush();
  return blocks;
}

function lineForOffset(block: MaestroCommentBlock, matchIndex: number): number {
  let line = block.startLine;
  for (const entry of block.lineOffsets) {
    if (entry.offset <= matchIndex) line = entry.line;
    else break;
  }
  return line;
}

// `` `features/share/index.ts` ``, `` `../e2e/flows/pairing.contract.test.ts` ``
// — a backtick span ending in one of this repo's real source/doc
// extensions. Deliberately excludes bare identifiers, quoted UI strings,
// and testIds (none of those end `.ts`/`.tsx`/`.md`/`.json`/`.yaml`), so
// this never fires on prose that merely happens to use backticks for
// emphasis — see `extractCitedSymbols` below for the identifier half of
// the same split, and this file's own report for the true-negative proof
// (every non-file, non-symbol backtick span in every real flow today,
// left untouched).
const CITED_FILE = /`([.\w/-]+\.(?:ts|tsx|md|json|yaml))`/g;

export interface CitedFile {
  readonly line: number;
  readonly path: string;
}

/** Every file a comment block cites in backticks, in document order. */
export function extractCitedFiles(block: MaestroCommentBlock): CitedFile[] {
  const out: CitedFile[] = [];
  const re = new RegExp(CITED_FILE.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(block.text))) {
    out.push({ line: lineForOffset(block, m.index), path: m[1] });
  }
  return out;
}

// A task id (`T69`, `T32S14`, ...) is this repo's own cross-reference
// convention, never a source identifier — excluded so this check never
// asks whether `git blame`-shaped prose "exists in source".
const TASK_ID = /^T\d/;
// `Owns` is `docs/issues-from-plan.md`'s task-ownership label, reused
// verbatim (and backtick-quoted) inside flow comments that restate a
// task's `Owns:` grant (e.g. composer-inputs.yaml's "this task's `Owns`
// grant") — a repo-wide documentation convention, never a source symbol.
const NON_SYMBOL_WORDS = new Set(["Owns"]);

export interface CitedSymbol {
  readonly line: number;
  readonly name: string;
}

// `` `SessionRoute` ``, `` `VoiceCaptureController` `` — a bare
// PascalCase backtick span, the shape every real component/class/type
// citation in this directory already uses (verified against all 12 real
// flows: every PascalCase backtick citation that is not a task id or
// `Owns` names a real exported symbol today — see this task's report).
// Deliberately requires 3+ characters and an initial capital so it never
// matches a lowercase descriptive word (`stale`, `pinned`, `webview`) or
// a single-letter placeholder, which is exactly how this check avoids
// firing on prose that is merely explanatory.
const CITED_SYMBOL = /`([A-Z][A-Za-z0-9]{2,})`/g;

/** Every PascalCase symbol a comment block cites in backticks, minus this repo's own task-id/`Owns` conventions, in document order. */
export function extractCitedSymbols(block: MaestroCommentBlock): CitedSymbol[] {
  const out: CitedSymbol[] = [];
  const re = new RegExp(CITED_SYMBOL.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(block.text))) {
    const name = m[1];
    if (TASK_ID.test(name) || NON_SYMBOL_WORDS.has(name)) continue;
    out.push({ line: lineForOffset(block, m.index), name });
  }
  return out;
}

export interface FileContentClaim {
  readonly line: number;
  readonly file: string;
  readonly quote: string;
}

// `` `features/share/index.ts` now says "Mounted as of T69" `` — this
// directory's one existing "a comment states what another file's own
// prose now says" shape (composer-inputs.yaml's header, recording that
// T69 changed that file). Requires the literal word "says" immediately
// after the cited file (an optional "now" allowed in between) so this
// never fires on the unrelated, far more common "the comment says so
// plainly" phrasing (background-kill-restore.yaml, pairing.yaml) that
// names no file at all.
const FILE_CONTENT_CLAIM = /`([.\w/-]+\.(?:ts|tsx|md|json))`\s+(?:now\s+)?says\s+"([^"]+)"/g;

/**
 * Every "`<file>` [now] says \"<quote>\"" claim a comment block makes —
 * this is what catches a comment that states a gap another task has
 * since closed: if the cited file's prose has moved on (the quote no
 * longer appears there), the claim the flow is resting on is stale, the
 * same way `composer-inputs.yaml`'s header caught `features/share/
 * index.ts` going from "Nothing imports this yet" to "Mounted as of
 * T69" out from under an earlier version of this same flow.
 */
export function extractFileContentClaims(block: MaestroCommentBlock): FileContentClaim[] {
  const out: FileContentClaim[] = [];
  const re = new RegExp(FILE_CONTENT_CLAIM.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(block.text))) {
    out.push({ line: lineForOffset(block, m.index), file: m[1], quote: m[2] });
  }
  return out;
}

/* -------------------------------------------------------------------- */
/* T91 — an UNQUOTED premise, the class T84's checkFileContentClaims      */
/* cannot see.                                                            */
/* -------------------------------------------------------------------- */

export interface NoPropClaim {
  readonly line: number;
  readonly file: string;
  readonly component: string;
  readonly prop: string;
}

// `` `app/h/[serverId]/session/[agentId]/files/[...path].tsx` passes
// `FilesScreen` no `filePicker` and no `sharing` `` — this directory's
// own recurring shape for "this route does not wire this prop yet",
// carrying a real file citation, a real PascalCase component citation,
// and one or more real prop names, none of them quoted. T84's three
// checks (`checkCitedFiles`/`checkCitedSymbols`/`checkFileContentClaims`)
// all pass on a sentence exactly like this even after every citation
// inside it goes stale, because every individual citation still
// resolves — `app/.../[...path].tsx` is still a real file, `FilesScreen`
// and `filePicker` are still real symbols, and nothing in the sentence
// is a quoted claim about another file's literal text. Only the
// UNQUOTED CLAIM — that the cited file does not wire the cited prop to
// the cited component — can go false, and that is exactly what happened
// to this sentence's own history: `84a9738` (P5-W22) carried it a whole
// wave after `T78` wired both `filePicker` and `sharing` into the cited
// route, and every test in this repository at that commit passed,
// including every one of T84's three checks.
//
// Requires the literal word "passes" (not "passing"): every LIVE
// instance of this shape in this directory today is written as a plain
// declarative "<file> passes <Component> ..." sentence, while this
// directory's own established retrospective convention
// ("`files-and-terminal.yaml`'s "PARTIALLY CLOSED BY T80" paragraph)
// re-quotes a dead claim as part of a larger "reasons: ..., AND <file>
// passing <Component> ..." gerund construction when it re-cites the
// exact same file — which the RETROSPECTIVE_MARKER check below also
// independently excludes.
const NO_PROP_ANCHOR = /`([-\w./()[\]]+\.tsx?)`[^`]{0,60}?\bpasses\b\s+`([A-Z][A-Za-z0-9]*)`/g;

// `` no `filePicker` `` / `` no `sharing` `` / `` no `webview` `` — every
// backtick-quoted prop name negated by a preceding bare "no" within the
// clause a NO_PROP_ANCHOR match opens. Deliberately requires the prop
// name start lowercase (`filePicker`, `webview`) so this is never
// confused with NO_PROP_ANCHOR's own PascalCase component capture.
const NO_PROP_NEGATION = /\bno\s+`([a-zA-Z][\w]*)`/g;

// How far past a NO_PROP_ANCHOR match this module keeps looking for
// `no `<prop>`` negations — cut at the first clause boundary this
// directory's real prose actually uses after this shape (", so", " —",
// "when", or a ". " sentence break), capped at 200 characters so an
// unrelated later "no `X`" elsewhere in a long paragraph is never
// swept in by accident.
const CLAUSE_BOUNDARY = /,\s*so\b|\bwhen\b| — |\. [A-Z]|\.$/;
const CLAUSE_WINDOW_MAX = 200;

// This directory's own established "the gap below is CLOSED, here is
// what the sentence used to say" convention
// (`files-and-terminal.yaml`'s "CLOSED AT THE P5-W22 MERGE GATE"/
// "CORRECTED AT THE P5-W20 MERGE GATE"/"PARTIALLY CLOSED BY T80",
// `composer-inputs.yaml`'s "NO LONGER") — every real instance of it
// re-quotes a now-dead claim FOR AUDITABILITY, immediately before or
// around the exact citations that claim once used live. A checker that
// did not exclude this would fire on the very prose written to explain
// that the gap it names is closed, which is the "must not fire on
// merely explanatory prose" failure mode this task exists to avoid.
// Looked up in the text immediately BEFORE a NO_PROP_ANCHOR match
// (RETROSPECTIVE_LOOKBACK characters), never after, since every real
// instance of the convention states "used to say"/"CLOSED"/"CORRECTED"
// first and only then re-quotes the dead sentence.
const RETROSPECTIVE_MARKER =
  /\b(?:used to (?:say|assert|claim|describe)|no longer|NO LONGER|CORRECTED AT|CLOSED AT|PARTIALLY CLOSED)\b/;
const RETROSPECTIVE_LOOKBACK = 250;

/**
 * Every "`<file>` passes `<Component>` ... no `<prop>`" premise a
 * comment block states, live (not retrospective) ones only. See
 * NO_PROP_ANCHOR/NO_PROP_NEGATION/RETROSPECTIVE_MARKER above for the
 * exact shape and the exact exclusion, and `checkNoPropClaims`
 * (`./maestro-comment-citations.ts`) for what "live" means: this
 * function only recognises the shape and excludes prose written in
 * this directory's own retrospective convention — verifying the CLAIM
 * against real source is that function's job, not this one's.
 */
export function extractNoPropClaims(block: MaestroCommentBlock): NoPropClaim[] {
  const out: NoPropClaim[] = [];
  const anchorRe = new RegExp(NO_PROP_ANCHOR.source, "g");
  let m: RegExpExecArray | null;
  while ((m = anchorRe.exec(block.text))) {
    const before = block.text.slice(Math.max(0, m.index - RETROSPECTIVE_LOOKBACK), m.index);
    if (RETROSPECTIVE_MARKER.test(before)) continue;

    const file = m[1];
    const component = m[2];
    const afterIndex = m.index + m[0].length;
    const rest = block.text.slice(afterIndex);
    const cut = rest.search(CLAUSE_BOUNDARY);
    const window = rest.slice(
      0,
      cut === -1 ? Math.min(rest.length, CLAUSE_WINDOW_MAX) : Math.min(cut, CLAUSE_WINDOW_MAX),
    );

    const negationRe = new RegExp(NO_PROP_NEGATION.source, "g");
    let nm: RegExpExecArray | null;
    while ((nm = negationRe.exec(window))) {
      out.push({
        line: lineForOffset(block, afterIndex + nm.index),
        file,
        component,
        prop: nm[1],
      });
    }
  }
  return out;
}
