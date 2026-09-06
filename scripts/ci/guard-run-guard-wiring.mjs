// T209: CI guard — every `scripts/ci/run-guard-*.mjs` CLI entry point is
// either actually invoked by a `run:` step in some `.github/workflows/*.yml`
// workflow, or carries an explicit, reasoned allowlist entry below.
//
// ## The defect this closes
//
// T207 shipped `run-guard-app-id-package-pairing.mjs` and no workflow
// referenced it. That runner's own module header said "CI runs it via
// `node scripts/ci/run-guard-app-id-package-pairing.mjs`" — false on the
// commit that shipped it. The check still reached CI, but only through
// `guard-app-id-package-pairing.test.mjs`'s own real-tree assertion inside
// the `changes` job's unconditional `node --test scripts/ci/*.test.mjs`
// step — real protection, but a materially weaker contract than a
// dedicated guard job (it depends on that one test file's author having
// written a real-tree assertion, not on every runner having one), and not
// the contract the file's own header claimed. This is the THIRD unwired
// runner shipped in this directory (see the allowlist below for the other
// two, which are unwired on purpose) and nothing before this guard noticed
// any of them.
//
// ## The trap: a comment mentioning a runner is not wiring it
//
// The P8-W11 gate found exactly two `.github/` hits for
// `run-guard-app-id-package-pairing.mjs` before that gate's own fix, and
// both were prose IN COMMENTS — a job-header comment explaining the guard's
// history, not a `run:` line invoking it. A check that merely `grep`s the
// whole workflow file for the runner's filename would have passed on the
// exact tree that motivated this task, because comments mentioning a
// runner (to explain it, to cross-reference it, to record its history) are
// exactly as common in this repository's workflow files as real `run:`
// invocations of it — see e.g. the comment block directly above the real
// `guard-app-id-package-pairing:` job in `.github/workflows/ci.yml` today,
// which names the runner filename twice in prose.
//
// So this guard does not scan a workflow file's raw text. `extractRunStepContents`
// below extracts ONLY the actual value of each YAML `run:` step — inline
// (`run: node scripts/ci/foo.mjs`) or block-scalar (`run: |` followed by its
// indented body) — and `stripHashComments` blanks any `#`-introduced comment
// *inside* that extracted run content too, so a shell comment that merely
// quotes a runner's filename inside a real `run: |` script (without actually
// invoking it) cannot count as wiring either. Only text that would actually
// execute counts.
//
// ## What this deliberately does NOT catch
//
// - A runner invoked only indirectly — through an npm script another `run:`
//   step calls (e.g. `npm run typecheck --workspaces --if-present`), rather
//   than by its own filename appearing literally in any workflow's `run:`
//   content — is NOT detected as wired by this guard. `run-guard-server-test-
//   typecheck-ceiling.mjs` is exactly this shape (see the allowlist below)
//   and is allowlisted rather than falsely reported as wired.
// - A workflow file this guard cannot parse into `run:` steps at all (some
//   future shape this text-based extraction was not written for) silently
//   yields no run content for that file, which reads the same as "this file
//   never mentions any runner" — narrower coverage, never a false report of
//   wiring. See `guard-app-id-package-pairing.mjs`'s own header for the same
//   "narrow beats a generic YAML interpreter" reasoning applied here.
//
// Pure, dependency-free check functions only. `run-guard-run-guard-wiring.mjs`
// is this module's CLI entry point, wired into CI as the
// `guard-run-guard-wiring` job in `.github/workflows/ci.yml` — the neatest
// available proof this guard works: its own job is exactly the kind of
// `run:` line it looks for, in the exact workflow file it scans.
//
// ## T211: a stale allowlist entry, and why it is a SEPARATE violation class
//
// The loop that built `findUnwiredRunGuardViolations`'s original result
// iterated `runnerFilenames` — the real `run-guard-*.mjs` files found on
// disk — and consulted `ALLOWLISTED_UNWIRED_RUN_GUARDS` only *inside* that
// loop, for whichever runner it happened to be looking at. That means an
// allowlist key is only ever read when a matching runner exists AND that
// runner is unwired. Two kinds of entry were therefore unreachable and
// silently ignored, forever:
//
//   1. A key naming a runner that no longer exists (renamed or deleted) —
//      the loop never iterates a filename that isn't on disk, so a stale
//      key just sits there.
//   2. A key naming a runner some workflow now genuinely wires — the
//      `if (wired) continue;` above skips straight past the allowlist for
//      that runner, so an entry can outlive the reason it was written for
//      and nothing will ever say so.
//
// This is the "check that cannot fail" shape from CLAUDE.md's catalogue,
// inside the guard that exists to close exactly that shape. There was no
// live defect when T211 was filed (the P8-W12 gate verified both real
// entries name files that exist and are genuinely unwired) — the point is
// that the check could not have told us if there were one.
//
// **A stale allowlist entry is a SEPARATE violation class from an unwired
// runner, not the same one wearing a different runner name.** The two are
// caused by different mistakes and fixed by different edits:
//   - `kind: "unwired"` means a real, on-disk `run-guard-*.mjs` has no
//     workflow invoking it and no valid allowlist entry rescuing it. The fix
//     is to WIRE THE RUNNER (add a `run:` step) or add a new allowlist entry.
//   - `kind: "stale-missing-runner"` means an allowlist entry names a
//     runner that is not one of today's on-disk `run-guard-*.mjs` files. The
//     fix is to DELETE OR CORRECT THE ALLOWLIST ENTRY — there is no runner
//     left to wire.
//   - `kind: "stale-wired"` means an allowlist entry names a real runner
//     that some workflow's `run:` content now genuinely invokes. The entry
//     has outlived its reason; the fix is to DELETE THE NOW-UNNECESSARY
//     ALLOWLIST ENTRY, never to unwire the runner to make the old reason
//     true again.
// `run-guard-run-guard-wiring.mjs` prints a distinct message per `kind` so a
// reader can tell which mistake happened without reading this source.
//
// The stale check below reuses the exact `runnerFilenames` and `workflows`
// this module already reads for the main loop — it does not re-read the
// filesystem with a second, possibly-different notion of "which runners
// exist". It walks `Object.entries(allowlist)` directly, independently of
// whether the main loop below ever reaches that key, which is the only way
// to make a key that the main loop would never visit still reachable.

/**
 * Two runners are unwired on purpose. An allowlist entry REQUIRES a
 * recorded reason (`isValidAllowlistReason` below) precisely so that
 * adding one is a visible, reviewable decision rather than a silent way to
 * make this guard stop looking at a file.
 *
 * - `run-guard-clean-working-tree.mjs`: local-only by design.
 *   `actions/checkout` hands every CI job a pristine tree, so a workflow
 *   job running this guard would exit 0 by construction — CLAUDE.md's T93
 *   section and T96 record wiring it into CI as will-not-wire.
 * - `run-guard-server-test-typecheck-ceiling.mjs`: already runs, but only
 *   indirectly. `packages/server/package.json`'s own `"typecheck"` script
 *   invokes it after `tsgo` (`tsgo -p tsconfig.server.typecheck.json
 *   --noEmit && node ../../scripts/ci/run-guard-server-test-typecheck-
 *   ceiling.mjs`), and CI's `typecheck` job runs `npm run typecheck
 *   --workspaces --if-present` unconditionally — so the guard executes on
 *   every CI run, just never via its own filename appearing in a workflow
 *   `run:` line, which is the only wiring shape this guard can detect. The
 *   check it enforces is also, by its own module header's own words,
 *   documented as red at the layer it measures: `packages/server`'s test
 *   files carry 1051 known, pre-existing typecheck errors today (measured
 *   2026-09-05), enforced as a ceiling that can only fall, not a
 *   must-be-zero gate — a standalone pass/fail job would need to say
 *   "guard passed" over code its own header calls red, which is exactly
 *   why it stays folded into the workspace typecheck step instead.
 */
export const ALLOWLISTED_UNWIRED_RUN_GUARDS = {
  "run-guard-clean-working-tree.mjs":
    "local-only by design: actions/checkout hands every CI job a pristine tree, so this guard " +
    "would exit 0 by construction on any job that checked it out. CLAUDE.md's T93 section and " +
    "T96 record wiring it into CI as will-not-wire.",
  "run-guard-server-test-typecheck-ceiling.mjs":
    "already runs on every CI run, but only indirectly: packages/server/package.json's own " +
    '"typecheck" script invokes it after tsgo, and CI\'s typecheck job runs `npm run typecheck ' +
    "--workspaces --if-present` unconditionally, so no workflow `run:` line ever names this file " +
    "literally. The ceiling it enforces is itself documented as red at the layer it measures: " +
    "its own module header records 1051 known, pre-existing packages/server test-file typecheck " +
    "errors, enforced as a ceiling that can only fall, never a must-be-zero pass/fail gate.",
};

/** Minimum length a recorded allowlist reason must clear to count as a real
 * reason rather than a placeholder (`""`, `"TODO"`, `"x"`) that would make
 * adding an entry a silent skip instead of a visible decision. */
const MIN_ALLOWLIST_REASON_LENGTH = 20;

/**
 * @param {unknown} reason
 * @returns {boolean} whether `reason` is a real, non-placeholder allowlist
 *   reason string
 */
export function isValidAllowlistReason(reason) {
  return typeof reason === "string" && reason.trim().length >= MIN_ALLOWLIST_REASON_LENGTH;
}

/**
 * Blanks everything from an unquoted `#` to the end of its line. Applied to
 * extracted `run:` step content only (never to a whole workflow file — see
 * this module's header for why that distinction is the entire point of
 * this guard), so a shell comment quoting a runner's filename inside a real
 * `run: |` script cannot be mistaken for that script actually invoking it.
 * Line-based, matching `guard-app-id-package-pairing.mjs`'s own
 * `stripHashComments` — none of the run content this guard needs to read
 * (a `node scripts/ci/run-guard-*.mjs` invocation) ever legitimately
 * contains a literal `#`.
 */
function stripHashComments(content) {
  return content
    .split("\n")
    .map((line) => {
      const hashIndex = line.indexOf("#");
      return hashIndex === -1 ? line : line.slice(0, hashIndex);
    })
    .join("\n");
}

// Matches a YAML `run:` mapping key, with or without a leading `- ` list
// marker, capturing its own indentation and whatever follows it on the same
// line (empty when the value is a block scalar on the following lines).
const RUN_KEY_PATTERN = /^(\s*)(?:-\s*)?run:[ \t]*(.*)$/;

// A bare block-scalar indicator (`|`, `|-`, `|+`, `|2`, `>`, `>-`, ...) and
// nothing else on the line — the signal that the run content lives on the
// following, more-indented lines rather than after the colon.
const BLOCK_SCALAR_INDICATOR_PATTERN = /^[|>][+-]?\d*$/;

/**
 * Extracts the literal content of every `run:` step in a GitHub Actions
 * workflow file — the text that step would actually hand to the shell —
 * whether written inline or as a block scalar. Deliberately does not use a
 * real YAML parser: every `run:` step in this repository's workflows is one
 * of the two shapes handled here, and a narrow, auditable extraction is
 * this repository's established pattern for workflow/YAML text (see
 * `guard-app-id-package-pairing.mjs`'s and `guard-docker-packaging-
 * paths.mjs`'s own headers for the same call).
 *
 * @param {string} workflowContent raw `.github/workflows/*.yml` source
 * @returns {string[]} one entry per `run:` step, in document order
 */
export function extractRunStepContents(workflowContent) {
  const lines = workflowContent.split("\n");
  const contents = [];
  let i = 0;
  while (i < lines.length) {
    const match = lines[i].match(RUN_KEY_PATTERN);
    if (!match) {
      i++;
      continue;
    }
    const keyIndent = match[1].length;
    const inlineValue = match[2].trim();

    if (inlineValue === "" || BLOCK_SCALAR_INDICATOR_PATTERN.test(inlineValue)) {
      // Block scalar: every following line indented strictly more than the
      // `run:` key itself belongs to it; a blank line never ends the block
      // (a block scalar can contain blank lines), only a non-blank line
      // indented at or below the key does.
      const blockLines = [];
      let j = i + 1;
      while (j < lines.length) {
        const line = lines[j];
        if (line.trim() === "") {
          blockLines.push(line);
          j++;
          continue;
        }
        const lineIndent = line.match(/^(\s*)/)[1].length;
        if (lineIndent <= keyIndent) break;
        blockLines.push(line);
        j++;
      }
      contents.push(blockLines.join("\n"));
      i = j;
    } else {
      contents.push(inlineValue);
      i++;
    }
  }
  return contents;
}

/**
 * @param {string} runnerFilename e.g. `"run-guard-app-id-package-pairing.mjs"`
 * @param {string} workflowContent raw `.github/workflows/*.yml` source
 * @returns {boolean} whether some `run:` step in this workflow actually
 *   invokes this runner — its filename appears in a `run:` step's own
 *   content, outside of any `#`-introduced comment inside that content
 */
export function isRunnerWiredInWorkflow(runnerFilename, workflowContent) {
  return extractRunStepContents(workflowContent).some((runContent) =>
    stripHashComments(runContent).includes(runnerFilename),
  );
}

/**
 * @typedef {{
 *   kind: "unwired" | "stale-missing-runner" | "stale-wired",
 *   runner: string,
 *   allowlistReason: string | null,
 * }} RunGuardWiringViolation
 *   `kind: "unwired"` — a real, on-disk `run-guard-*.mjs` that no workflow's
 *   `run:` content invokes and that has no valid allowlist entry rescuing
 *   it. `allowlistReason` is `null` when the runner has no allowlist entry
 *   at all, or the invalid (too-short/non-string) reason string when it has
 *   an entry that fails `isValidAllowlistReason` — either way, a violation.
 *   `kind: "stale-missing-runner"` — an `ALLOWLISTED_UNWIRED_RUN_GUARDS` key
 *   naming a filename that is not one of today's real `run-guard-*.mjs`
 *   files (renamed or deleted). `allowlistReason` is that entry's recorded
 *   reason, whatever it says — the entry is stale regardless of the
 *   reason's own quality.
 *   `kind: "stale-wired"` — an `ALLOWLISTED_UNWIRED_RUN_GUARDS` key naming a
 *   real runner that some workflow's `run:` content now genuinely invokes.
 *   `allowlistReason` is that entry's recorded reason. See this module's
 *   header ("T211") for why these are a separate violation class from
 *   `"unwired"`, not the same one under a different name.
 */

/**
 * @param {{
 *   runnerFilenames: string[],
 *   workflows: { path: string, content: string }[],
 *   allowlist?: Record<string, string>,
 * }} inputs
 * @returns {RunGuardWiringViolation[]} every real `run-guard-*.mjs` runner
 *   that is referenced by no workflow's real `run:` content and has no VALID
 *   allowlist entry (`kind: "unwired"`), PLUS every allowlist entry that has
 *   gone stale — naming a runner that no longer exists (`kind:
 *   "stale-missing-runner"`) or one a workflow now genuinely wires (`kind:
 *   "stale-wired"`)
 */
export function findUnwiredRunGuardViolations({
  runnerFilenames,
  workflows,
  allowlist = ALLOWLISTED_UNWIRED_RUN_GUARDS,
}) {
  const violations = [];
  const runnerFilenameSet = new Set(runnerFilenames);
  const isWired = (runner) =>
    workflows.some((workflow) => isRunnerWiredInWorkflow(runner, workflow.content));

  // Stale allowlist entries: walked over the allowlist's OWN keys,
  // independently of the main loop below, so an entry the main loop would
  // never reach (because its runner doesn't exist, or because the main loop
  // `continue`s past a now-wired runner before ever consulting the
  // allowlist) is still checked. See this module's header ("T211") for why
  // this must not be folded into the loop below.
  for (const [runner, allowlistReason] of Object.entries(allowlist)) {
    if (!runnerFilenameSet.has(runner)) {
      violations.push({ kind: "stale-missing-runner", runner, allowlistReason });
      continue;
    }
    if (isWired(runner)) {
      violations.push({ kind: "stale-wired", runner, allowlistReason });
    }
  }

  for (const runner of runnerFilenames) {
    if (isWired(runner)) continue;

    const reason = Object.hasOwn(allowlist, runner) ? allowlist[runner] : null;
    if (reason !== null && isValidAllowlistReason(reason)) continue;

    violations.push({ kind: "unwired", runner, allowlistReason: reason });
  }
  return violations;
}
