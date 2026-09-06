/**
 * T84 (`docs/issues-from-plan.md`) — checks every citation
 * `./maestro-yaml.ts`'s comment-block extractors (T84's own addition to
 * T72's parser) find inside a flow's comments against real, on-disk
 * source, so a header or a paragraph that asserts a premise another task
 * has since falsified fails a gate BY NAME, instead of surviving until a
 * human reads the yaml by hand at a merge gate (which is the only thing
 * that caught it, four consecutive waves running — see this task's own
 * `docs/issues-from-plan.md` entry).
 *
 * Three independent checks, one per `maestro-yaml.ts` extractor:
 *
 * - `checkCitedFiles` — every backtick-quoted `../maestro/*.yaml`,
 *   `*.ts`/`*.tsx`, or doc path a comment names must resolve to a real
 *   file. Tried in order: relative to the citing flow's own directory
 *   (`../maestro/`, how every sibling-flow and `../e2e/flows/*` citation
 *   in this directory is actually written), then relative to the repo
 *   root (how `apps/android/package.json`-shaped and cross-package
 *   `src`-shaped citations are written), then — for a bare filename
 *   with no directory component at all (`Composer.tsx`, `composer-
 *   model.ts`) — anywhere under `SOURCE_ROOTS` by basename, since this
 *   directory's own prose routinely cites a file by name alone once its
 *   full path was already given earlier in the same comment.
 *
 * - `checkCitedSymbols` — every bare PascalCase backtick citation
 *   (`` `SessionRoute` ``, `` `VoiceCaptureController` ``) must appear,
 *   as a whole word, somewhere in `SOURCE_ROOTS`'s real text. This is
 *   deliberately a plain substring/word-boundary search, not an
 *   export-graph resolution: cheap, dependency-free, and exactly what
 *   catches the failure this task exists to catch — a symbol renamed or
 *   deleted out from under a comment that still names its old spelling.
 *
 * - `checkFileContentClaims` — every "`<file>` [now] says \"<quote>\""
 *   claim (`extractFileContentClaims`) must have its quoted text still
 *   present, verbatim, in the cited file's real current contents. This
 *   is the check built specifically for "a flow comment that states a
 *   gap another task has since closed": if the cited file's own prose
 *   has moved on, the quote the flow is resting its premise on is gone,
 *   and this fails BY NAME (the file and the stale quote both appear in
 *   the failure).
 *
 * - `checkNoPropClaims` (T91, `docs/issues-from-plan.md`) — every
 *   "`<route>.tsx` passes `Component` no `<prop>`" UNQUOTED premise
 *   (`extractNoPropClaims`) must still be true of the cited route's
 *   real JSX. T84's three checks above all pass on a sentence like this
 *   even after it goes false, because every individual citation inside
 *   it (the file, the component, the prop name) still resolves —
 *   `checkFileContentClaims` only catches a QUOTED claim about a file's
 *   literal text, never an unquoted claim relating a file, a component,
 *   and a prop. `84a9738` (P5-W22) is the real, reproduced proof: it
 *   carried `files-and-terminal.yaml`'s "passes `FilesScreen` no
 *   `filePicker` and no `sharing`" sentence a whole wave after `T78`
 *   had wired both props into the cited route, and every test at that
 *   commit — including all three of T84's checks — passed. See this
 *   task's own report for the reproduced run.
 *
 * All four are read-only string/filesystem checks — no yaml is ever
 * parsed as a grammar beyond what `maestro-yaml.ts` already does, and
 * nothing here executes a flow or needs a device/emulator/Maestro
 * binary, matching every other module in `../harness/`.
 *
 * COVERAGE, STATED PLAINLY (T91's own checkbox): this file's checks run
 * over every `apps/android/maestro/*.yaml` flow's COMMENTS (twelve
 * flows today, via `maestro-comment-citations.contract.test.ts`'s own
 * `createFlowRegistry()` loop — every flow, not a subset), for the four
 * shapes above only. What is NOT covered, honestly:
 *   - Any unquoted premise that is not the "`<file>.tsx` passes
 *     `Component` no `<prop>`" shape `checkNoPropClaims` recognises —
 *     e.g. "nothing calls `saveHostProfile` and nothing navigates to
 *     `/h/:serverId/sessions`" (`notification-approval.yaml`'s own Gap
 *     B item 1, itself now stale — filed, not fixed, by T91's own
 *     report, since it needs a materially different extractor this
 *     task did not build).
 *   - A citation whose file path itself wraps across a comment line
 *     break inside a bracketed dynamic-route segment (e.g.
 *     `accessibility-audit.yaml`'s own "`.../files/` then `[...path].tsx`
 *     on the next line" — the line break lands inside the `[...]`
 *     segment) — this is a PRE-EXISTING gap in `checkCitedFiles`/
 *     `checkCitedSymbols` too (proven: neither extracts that citation
 *     either), not one T91 introduces.
 *   - Any prose OUTSIDE `apps/android/maestro/*.yaml` — a doc comment or
 *     runtime error string inside `.ts`/`.tsx` source (P6-W1's `turn-
 *     service.ts`/`core.ts`/`messages.ts` instance — three falsified
 *     premises in ordinary source files, none of them a Maestro flow)
 *     is a real instance of the same broader class and is NOT run
 *     through this checker at all — this file's `SOURCE_ROOTS`/
 *     `sourceFiles()` are the CORPUS these checks verify claims
 *     AGAINST, never a set of files these checks read claims FROM.
 *     Extending coverage to arbitrary source-file prose is a
 *     materially larger, differently-scoped task than this one.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type {
  CitedFile,
  CitedSymbol,
  FileContentClaim,
  MaestroCommentBlock,
  NoPropClaim,
} from "./maestro-yaml.js";
import {
  extractCitedFiles,
  extractCitedSymbols,
  extractFileContentClaims,
  extractNoPropClaims,
} from "./maestro-yaml.js";

export const MAESTRO_DIR = fileURLToPath(new URL("../../maestro/", import.meta.url));
export const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

/**
 * Every directory this repository's own real source/docs could plausibly
 * be cited from — one entry per workspace `src/`, plus `apps/android/e2e`
 * (contract tests and harness modules cite each other) and `docs/` (task
 * specs and provenance notes). Deliberately excludes `node_modules`,
 * `dist`, `build`, and `.git` — `walkFiles` below never descends into a
 * directory whose name matches `EXCLUDED_DIR_NAMES`.
 */
const SOURCE_ROOTS = [
  "apps/android",
  "apps/web/src",
  "packages/frontend-core/src",
  "packages/server/src",
  "packages/client/src",
  "packages/protocol/src",
  "packages/cli/src",
  "packages/pi-bridge/src",
  "packages/relay/src",
  "packages/highlight/src",
  "packages/expo-two-way-audio/src",
  "docs",
];

const EXCLUDED_DIR_NAMES = new Set(["node_modules", ".git", "dist", "build", "coverage", ".expo"]);

function walkFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  const out: string[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop() as string;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (EXCLUDED_DIR_NAMES.has(entry)) continue;
      const full = path.join(dir, entry);
      let st: ReturnType<typeof statSync>;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) stack.push(full);
      else out.push(full);
    }
  }
  return out;
}

// This checker's own test file writes deliberately-fictional symbol and
// file names into its TRUE POSITIVE fixtures, quoted in full so it can
// assert on the exact failure message — and this module's own doc
// comments describe those fixtures, which repeats the same fictional
// names a second time. Left in the corpus, either source text would make
// the negative case pass by finding the fictional name sitting right
// there in a checked file — the "SIBLING occurrence of the same code
// satisfying a whole-file check" trap (this repo's own catalogued defect
// class). Both files are excluded here, by path, for that reason alone —
// neither is a flow-citation target any real yaml comment would ever
// point at.
const SELF_FILES = new Set([
  path.join(REPO_ROOT, "apps/android/e2e/flows/maestro-comment-citations.contract.test.ts"),
  path.join(REPO_ROOT, "apps/android/e2e/flows/maestro-comment-citations.ts"),
]);

let sourceFilesCache: string[] | null = null;
function sourceFiles(): string[] {
  if (!sourceFilesCache) {
    sourceFilesCache = SOURCE_ROOTS.flatMap((root) => walkFiles(path.join(REPO_ROOT, root))).filter(
      (f) => !SELF_FILES.has(f),
    );
  }
  return sourceFilesCache;
}

let symbolCorpusCache: string | null = null;
function symbolCorpus(): string {
  if (symbolCorpusCache === null) {
    symbolCorpusCache = sourceFiles()
      .filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"))
      .map((f) => {
        try {
          return readFileSync(f, "utf8");
        } catch {
          return "";
        }
      })
      .join("\n");
  }
  return symbolCorpusCache;
}

/** Test-only: forces the next call to rebuild its caches from disk, so a mutation-then-restore test observes the real, current file contents rather than a stale in-memory read. */
export function resetCitationCaches(): void {
  sourceFilesCache = null;
  symbolCorpusCache = null;
}

export interface CitationFailure {
  readonly line: number;
  readonly message: string;
}

/**
 * Resolves a cited file path against real disk, in the three orders
 * documented on this module's own header. Returns the resolved absolute
 * path, or `undefined` if none of the three resolutions found anything.
 */
const ANDROID_SRC_DIR = path.join(REPO_ROOT, "apps/android/src");

export function resolveCitedFile(citedPath: string): string | undefined {
  const fromMaestro = path.normalize(path.join(MAESTRO_DIR, citedPath));
  if (existsSync(fromMaestro) && statSync(fromMaestro).isFile()) return fromMaestro;

  const fromRoot = path.normalize(path.join(REPO_ROOT, citedPath));
  if (existsSync(fromRoot) && statSync(fromRoot).isFile()) return fromRoot;

  // `ui/primitives/touch-targets.test.ts`, `features/share/index.ts` —
  // several flows cite a path relative to `apps/android/src/` (this
  // app's own source root) without the `apps/android/src/` prefix, since
  // that is implicit from context inside a flow that already talks about
  // nothing but this app.
  const fromAndroidSrc = path.normalize(path.join(ANDROID_SRC_DIR, citedPath));
  if (existsSync(fromAndroidSrc) && statSync(fromAndroidSrc).isFile()) return fromAndroidSrc;

  // `Composer.tsx`, `./sqlite-driver.ts`, `renderers/index.ts` — plenty
  // of citations name only the file's last one or two path segments,
  // relying on a fuller path having already been given earlier in the
  // same prose paragraph rather than repeating it on every mention.
  // Last resort: strip a leading `./`/`../`, then match any real file
  // under SOURCE_ROOTS whose own path ends with that same suffix.
  const suffix = "/" + citedPath.replace(/^(\.\.?\/)+/, "");
  const match = sourceFiles().find((f) => f.split(path.sep).join("/").endsWith(suffix));
  if (match) return match;
  return undefined;
}

export function checkCitedFiles(citations: readonly CitedFile[]): CitationFailure[] {
  const failures: CitationFailure[] = [];
  for (const citation of citations) {
    if (!resolveCitedFile(citation.path)) {
      failures.push({
        line: citation.line,
        message: `cites \`${citation.path}\`, which does not resolve to any real file (checked relative to the flow's own directory, the repo root, and every SOURCE_ROOTS basename)`,
      });
    }
  }
  return failures;
}

export function checkCitedSymbols(citations: readonly CitedSymbol[]): CitationFailure[] {
  const corpus = symbolCorpus();
  const failures: CitationFailure[] = [];
  for (const citation of citations) {
    const re = new RegExp(`\\b${citation.name}\\b`);
    if (!re.test(corpus)) {
      failures.push({
        line: citation.line,
        message: `cites \`${citation.name}\`, which does not appear as a symbol anywhere under SOURCE_ROOTS — it was renamed, deleted, or never existed`,
      });
    }
  }
  return failures;
}

export function checkFileContentClaims(claims: readonly FileContentClaim[]): CitationFailure[] {
  const failures: CitationFailure[] = [];
  for (const claim of claims) {
    const resolved = resolveCitedFile(claim.file);
    if (!resolved) {
      failures.push({
        line: claim.line,
        message: `claims \`${claim.file}\` says "${claim.quote}", but \`${claim.file}\` does not resolve to any real file`,
      });
      continue;
    }
    let contents: string;
    try {
      contents = readFileSync(resolved, "utf8");
    } catch {
      contents = "";
    }
    if (!contents.includes(claim.quote)) {
      failures.push({
        line: claim.line,
        message: `claims \`${claim.file}\` says "${claim.quote}", but that text no longer appears in ${resolved} — the premise this comment rests on may have been closed or changed by another task`,
      });
    }
  }
  return failures;
}

/**
 * T91 — `checkFileContentClaims` above only catches a QUOTED "`<file>`
 * says \"<quote>\"" claim; it is blind to an UNQUOTED premise like
 * "`<route>.tsx` passes `Component` no `prop`" where every individual
 * citation inside the sentence (the file, the component, the prop) is
 * real, and only the CLAIM relating them has gone false. `84a9738`
 * (P5-W22) carried exactly that sentence a whole wave after `T78` wired
 * both props it named, and T84's three checks all passed on it — see
 * this module's own report for the real, reproduced run against that
 * commit's tree.
 *
 * Verifies the claim the cheap way this whole checker family uses:
 * finds the cited component's own JSX invocation in the cited file's
 * real text (`<Component ... />`, the shape every route in this
 * directory uses — self-closing, one prop per line) and checks whether
 * `<prop>={` appears inside that span. If it does, the "no `<prop>`"
 * premise is false — the route DOES wire that prop now.
 */
export function checkNoPropClaims(claims: readonly NoPropClaim[]): CitationFailure[] {
  const failures: CitationFailure[] = [];
  for (const claim of claims) {
    const resolved = resolveCitedFile(claim.file);
    if (!resolved) {
      failures.push({
        line: claim.line,
        message: `claims \`${claim.file}\` passes \`${claim.component}\` no \`${claim.prop}\`, but \`${claim.file}\` does not resolve to any real file`,
      });
      continue;
    }
    let contents: string;
    try {
      contents = readFileSync(resolved, "utf8");
    } catch {
      contents = "";
    }
    const jsxMatch = new RegExp(`<${claim.component}\\b[\\s\\S]*?\\/>`).exec(contents);
    const propIsWired = jsxMatch !== null && new RegExp(`\\b${claim.prop}=\\{`).test(jsxMatch[0]);
    if (propIsWired) {
      failures.push({
        line: claim.line,
        message: `claims \`${claim.file}\` passes \`${claim.component}\` no \`${claim.prop}\`, but ${resolved} DOES pass \`${claim.prop}={...}\` to <${claim.component}> — the premise this comment rests on may have been closed by another task`,
      });
    }
  }
  return failures;
}

/** Runs all four checks over one comment block, in extractor order. */
export function checkCommentBlock(block: MaestroCommentBlock): CitationFailure[] {
  return [
    ...checkCitedFiles(extractCitedFiles(block)),
    ...checkCitedSymbols(extractCitedSymbols(block)),
    ...checkFileContentClaims(extractFileContentClaims(block)),
    ...checkNoPropClaims(extractNoPropClaims(block)),
  ];
}
