// T44A4 (plan.md §13 phase 9, "Run the complete CI matrix rather than the
// full suite locally"; docs/issues-from-plan.md T44A4's second and third
// acceptance criteria — "The matrix covers protocol, core, web, Android and
// backend" is a claim that rots the moment a workspace is added with no CI
// job running its tests). Pure, dependency-free check functions;
// `run-guard-workspace-test-coverage.mjs` is this module's CLI entry point.
//
// ## What this closes
//
// The root `package.json`'s `workspaces` field (`packages/*`, `apps/*`)
// enumerates every workspace this repository ships. Before this guard,
// nothing checked that every one of those workspaces has SOME job in
// `.github/workflows/*.yml` that actually runs its tests — "the matrix
// covers backend" was a claim resting entirely on a human remembering to
// wire a new package's test job at the same time they added the package.
// Measured directly against this repository's real tree while this guard
// was written: `@picompanion/relay` has a real `"test": "vitest run"` script
// and 7 test files, and `@picompanion/cli` has a real `"test:unit": "vitest
// run src"` script and 21 test files — both workspaces are listed under the
// `backend` path filter in `.github/ci-paths.yml`, and neither had a CI job
// running its tests. That gap is closed in the same commit that adds this
// guard (see the `relay-tests`/`cli-tests` jobs in `.github/workflows/ci.yml`)
// so that this guard's own first run finds nothing to allowlist for either.
//
// ## Deliberately narrow parsing, not a generic YAML/npm-workspaces engine
//
// `extractRunStepContents` is reused as-is from `guard-run-guard-wiring.mjs`
// — the same narrow, auditable `run:` step extraction (inline and
// block-scalar shapes; a real YAML parser was never this repository's
// convention for workflow text, see that module's own header) applies
// unchanged here: what counts as "wired" is a real `run:` step invoking
// `npm run <script> --workspace=<packageName>` where `<script>` starts with
// `test`, never a comment merely mentioning the package name. This module
// adds its own `stripHashComments` (matching `guard-run-guard-wiring.mjs`'s
// and `guard-app-id-package-pairing.mjs`'s own private helpers of the same
// name — duplicated by this repository's established convention for small,
// guard-local text helpers rather than exported and shared) so a shell
// comment inside a real `run: |` block quoting a workspace name cannot be
// mistaken for that step testing it.
//
// Workspace resolution reads the root `package.json`'s own `workspaces`
// array and expands each `<dir>/*` entry against the real directory
// listing, keeping only entries that carry their own `package.json` with a
// `name` field — the same "derive it from the real tree, never a hand-typed
// copy" discipline `guard-axe-route-coverage.mjs` uses for routes.
//
// ## What this deliberately does NOT catch
//
// - A workspace tested only INDIRECTLY — e.g. through a script another
//   `run:` step calls that internally shells out to more `npm run`
//   invocations — is not detected as wired unless the workspace's own name
//   appears, in a `--workspace=<name>` (or `-w <name>`/`-w=<name>`) form,
//   inside some workflow's literal `run:` content. `run-guard-run-guard-
//   wiring.mjs`'s own header documents the identical limit for its
//   filename-based check, for the identical reason: a narrow, auditable
//   text match beats a generic build-graph interpreter for this repository's
//   `.mjs` guards.
// - A workspace whose ONLY test coverage is a real browser/device suite
//   invoked through a differently-shaped command (e.g. `npx playwright
//   test`, `npx maestro test`, an EAS build script) rather than `npm run
//   test... --workspace=...` is not detected as wired by this guard. Every
//   workspace in this repository that has such coverage today (`@picompanion/
//   web`'s Playwright E2E, `@picompanion/android`'s Maestro flows) ALSO has a
//   `npm run test --workspace=...`/`npm run typecheck --workspace=...`-shaped
//   unit/component job this guard's pattern matches, so this narrowness has
//   not needed exercising yet — a workspace relying SOLELY on such a suite
//   would need its own allowlist entry recording that fact, same as any
//   other case this guard's text match cannot see.
//
// ## T211/T213-shaped stale-allowlist detection
//
// Same two-violation-class split `guard-run-guard-wiring.mjs` (T211) and
// `guard-no-legacy-app-tree.mjs` (T213) both established: an allowlist entry
// is checked for staleness by walking the allowlist's OWN keys directly,
// independently of whether the main loop below would ever reach that key —
// see this module's own tests for the two ways an entry can go stale
// (`stale-missing-workspace`: the workspace no longer exists on disk;
// `stale-tested`: the workspace is real and some workflow now genuinely
// tests it) and why folding either check into the main loop would make it
// unreachable exactly the way T211's header describes.

const MIN_ALLOWLIST_REASON_LENGTH = 20;

/**
 * Two workspaces are allowlisted as legitimately having no CI test job.
 * Both were checked directly against the real tree while this guard was
 * written (2026-09-07), not assumed from their names:
 *
 * - `@picompanion/bridge` (`packages/pi-bridge`): its `package.json`
 *   declares no `"test"` script at all (only `clean`/`build`/`build:clean`/
 *   `prepack`/`typecheck`), and no `*.test.ts`/`*.spec.ts` file exists
 *   anywhere under `packages/pi-bridge/`. There is no test command this
 *   guard, or any CI job, could invoke.
 * - `@picompanion/expo-two-way-audio` (`packages/expo-two-way-audio`): a
 *   ported native audio module scaffolded by `expo-module create` (plan.md
 *   §6's "ported native audio infrastructure"). Its `package.json` DOES
 *   declare a `"test": "expo-module test"` script, but zero test files
 *   exist under `packages/expo-two-way-audio/src`, `examples/`, `android/`,
 *   or `ios/` — `find packages/expo-two-way-audio -iname "*.test.*"`
 *   returns nothing. Running `expo-module test` would also need the
 *   react-native/jest-expo toolchain CLAUDE.md's "Known-uninstallable"
 *   list already names as unavailable in this environment, so wiring the
 *   script today would either fail outright or pass over zero tests either
 *   way.
 */
export const ALLOWLISTED_UNTESTED_WORKSPACES = {
  "@picompanion/bridge":
    "no `test` script exists in packages/pi-bridge/package.json (only clean/build/typecheck), " +
    "and no *.test.ts or *.spec.ts file exists anywhere under packages/pi-bridge/ — there is no " +
    "test command a CI job could invoke.",
  "@picompanion/expo-two-way-audio":
    "packages/expo-two-way-audio/package.json declares a `test` script (`expo-module test`) but " +
    "zero test files exist under its src/examples/android/ios directories, and running that " +
    "script would need the react-native/jest-expo toolchain CLAUDE.md's known-uninstallable list " +
    "already records as unavailable here.",
};

/**
 * Blanks everything from an unquoted `#` to the end of its line. Applied to
 * extracted `run:` step content only — see this module's header for why a
 * shell comment merely quoting a workspace name inside a real `run: |`
 * script must not be mistaken for that script actually testing it.
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

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * @param {string} packageName e.g. `"@picompanion/relay"`
 * @returns {RegExp} matches `npm run <script> --workspace=<packageName>` (or
 *   `--workspace <packageName>` / `-w <packageName>` / `-w=<packageName>`)
 *   where `<script>` is `test`, or starts with `test:` (e.g. `test:unit`) —
 *   collapsing whitespace first (see `isWorkspaceTestedInWorkflow` below) so
 *   this matches whether the whole invocation sits on one line or is spread
 *   across a multi-line `run: |` block.
 */
function buildWorkspaceTestPattern(packageName) {
  const escaped = escapeRegExp(packageName);
  return new RegExp(String.raw`npm run test(?::\S+)? (?:--workspace[= ]|-w[= ])${escaped}(?:\s|$)`);
}

/**
 * @param {string} packageName
 * @param {string} workflowContent raw `.github/workflows/*.yml` source
 * @returns {boolean} whether some real `run:` step in this workflow invokes
 *   a `test`/`test:*` npm script scoped to this exact workspace, outside of
 *   any `#`-introduced comment inside that step's own content
 */
export function isWorkspaceTestedInWorkflow(packageName, workflowContent, extractRunStepContents) {
  const pattern = buildWorkspaceTestPattern(packageName);
  return extractRunStepContents(workflowContent).some((runContent) => {
    // Collapse all whitespace (including newlines) to single spaces so an
    // invocation spread across a multi-line `run: |` block still matches —
    // this repository's real jobs always keep one npm invocation on one
    // line, but nothing about the YAML shape guarantees that, and collapsing
    // is safe here because each array entry is already one single step's
    // own content (never merged across steps).
    const normalized = stripHashComments(runContent).replace(/\s+/g, " ");
    return pattern.test(normalized);
  });
}

/**
 * @typedef {{ name: string, dir: string }} WorkspacePackage
 */

/**
 * Expands the root `package.json`'s `workspaces` glob array (each entry of
 * the form `"<dir>/*"`) against a real directory listing, keeping only
 * entries that carry their own `package.json` with a `name` field — the
 * same "derive it from the real tree" discipline
 * `guard-axe-route-coverage.mjs` applies to routes.
 *
 * @param {{
 *   workspaceGlobs: string[],
 *   listDir: (dir: string) => string[],
 *   readPackageName: (packageJsonPath: string) => string | null,
 * }} inputs
 * @returns {WorkspacePackage[]} sorted by `dir`
 */
export function resolveWorkspacePackages({ workspaceGlobs, listDir, readPackageName }) {
  const packages = [];
  for (const glob of workspaceGlobs) {
    if (!glob.endsWith("/*")) continue; // Only shape this repository uses.
    const parentDir = glob.slice(0, -2);
    let entries;
    try {
      entries = listDir(parentDir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const dir = `${parentDir}/${entry}`;
      const name = readPackageName(`${dir}/package.json`);
      if (name) packages.push({ name, dir });
    }
  }
  return packages.sort((a, b) => a.dir.localeCompare(b.dir));
}

/**
 * @typedef {{
 *   kind: "untested" | "stale-missing-workspace" | "stale-tested",
 *   workspace: string,
 *   allowlistReason: string | null,
 * }} WorkspaceTestCoverageViolation
 *   `kind: "untested"` — a real workspace package that no workflow's `run:`
 *   content tests and that has no valid allowlist entry rescuing it.
 *   `kind: "stale-missing-workspace"` — an allowlist key naming a package
 *   name that is not one of today's real workspace packages (renamed,
 *   removed, or never matched a workspace glob).
 *   `kind: "stale-tested"` — an allowlist key naming a real workspace that
 *   some workflow's `run:` content now genuinely tests.
 *
 * @param {{
 *   workspaces: WorkspacePackage[],
 *   workflows: { path: string, content: string }[],
 *   extractRunStepContents: (workflowContent: string) => string[],
 *   allowlist?: Record<string, string>,
 * }} inputs
 * @returns {WorkspaceTestCoverageViolation[]}
 */
export function findWorkspaceTestCoverageViolations({
  workspaces,
  workflows,
  extractRunStepContents,
  allowlist = ALLOWLISTED_UNTESTED_WORKSPACES,
}) {
  const violations = [];
  const workspaceNameSet = new Set(workspaces.map((w) => w.name));
  const isTested = (name) =>
    workflows.some((workflow) =>
      isWorkspaceTestedInWorkflow(name, workflow.content, extractRunStepContents),
    );

  // Stale allowlist entries: walked over the allowlist's own keys,
  // independently of the main loop below — see this module's header
  // ("T211/T213-shaped") for why folding this into the main loop would make
  // either kind of stale entry unreachable.
  for (const [workspace, allowlistReason] of Object.entries(allowlist)) {
    if (!workspaceNameSet.has(workspace)) {
      violations.push({ kind: "stale-missing-workspace", workspace, allowlistReason });
      continue;
    }
    if (isTested(workspace)) {
      violations.push({ kind: "stale-tested", workspace, allowlistReason });
    }
  }

  for (const { name } of workspaces) {
    if (isTested(name)) continue;

    const reason = Object.hasOwn(allowlist, name) ? allowlist[name] : null;
    if (
      reason !== null &&
      typeof reason === "string" &&
      reason.trim().length >= MIN_ALLOWLIST_REASON_LENGTH
    ) {
      continue;
    }

    violations.push({ kind: "untested", workspace: name, allowlistReason: reason });
  }

  return violations;
}
