// T43A3: CI guard — static checks on the Docker and Nix packaging paths
// (packaging/docker/Dockerfile, packaging/nix/flake.nix) that do not need a
// real `docker build` or `nix build` (neither toolchain is available in
// this repository's agent environment; see packaging/docker/README.md and
// packaging/nix/README.md "What has and has not been verified" for what
// this guard deliberately does NOT prove).
//
// Three things this guard checks, in the same spirit as T171's
// guard-daemon-web-ui-bundled.mjs — parse the real artifact and assert
// something about its actual content, not just that a file with the right
// name exists:
//
//   1. Every filesystem path each packaging file's build steps reference
//      (a Dockerfile `COPY` source not following `--from=`; the Nix
//      flake's `src = ../..`) resolves to something that actually exists
//      in this repository — a COPY source that does not exist fails at
//      `docker build` time today, but a stale reference left behind after
//      a repo reorganization would otherwise go unnoticed until someone
//      next tries a real build.
//   2. Neither file's build commands silently DROP a workspace
//      `@picompanion/server`'s own dependency chain needs, or the
//      `build:daemon-web-ui` step T43A1 established as the packaging
//      invariant (carrying `apps/web/dist` into
//      `packages/server/dist/server/web-ui`), OR RUN THAT STEP IN THE
//      WRONG ORDER relative to `build:clean --workspace=@picompanion/server`
//      (T174), OR build a workspace before a `@picompanion/*` dependency
//      its own `dependencies` field names (also T174, for the subset of
//      edges captured in `WORKSPACE_BUILD_DEPENDENCIES` below).
//
//      CORRECTED (P6-W20 gate): this used to call that "the exact failure
//      mode T171 guards on the OUTPUT side, checked here on the INPUT
//      (packaging-recipe) side instead". It is a strictly weaker check.
//      T171 inspects the packed tarball and catches a missing bundle for
//      ANY reason; this catches only an omitted step. Both checks below
//      are `includes()`/`test()` presence tests over the concatenated RUN
//      or phase text, and there is no position comparison anywhere in this
//      file. Reproduced at the gate: swap `build:clean` and
//      `build:daemon-web-ui` in both packaging files — the order both
//      files' own comments call fatal, because `build:clean` then wipes
//      the dist the web UI was just bundled into — and this guard still
//      exits 0. Deleting the `@picompanion/highlight` line exits 1, so the
//      omission half is real. T174 adds the ordering assertion.
//
//      UPDATED (T174): the ordering half now exists.
//      `findBuildOrderViolations` asserts, over the same concatenated RUN/
//      phase text the presence checks already use, that (a) `build:clean
//      --workspace=@picompanion/server` appears BEFORE the
//      `build:daemon-web-ui` step, and (b) each of `@picompanion/client`,
//      `@picompanion/frontend-core`, and `@picompanion/web` appears after
//      every `@picompanion/*` workspace its own real `dependencies` field
//      names. Reproduced RED-then-GREEN against the real files: swapping
//      the two build lines in EITHER packaging file now fails with
//      `EXIT=1` (mutate one file at a time — the other stays green); the
//      files intact pass; the `@picompanion/highlight`-omission positive
//      control still fails. Building the full `REQUIRED_WORKSPACE_BUILD_
//      STEPS` list in strict array order is still NOT required — see that
//      array's own doc comment for why extending order-enforcement to
//      every element of it was declined rather than done silently.
//   3. Neither file names a legacy Paseo `packages/app` path or the
//      `@getpaseo/` scope (plan.md §5's exclusion boundary) — Dockerfiles
//      and `.nix` files have no extension `guard-no-legacy-app-tree.mjs`
//      scans (see its `SCANNED_EXTENSIONS`), so that existing guard would
//      not catch a legacy reference introduced here.
//
// Pure, dependency-free check functions only (matching every other guard
// in this directory) — no filesystem or git access, so
// `guard-docker-packaging-paths.test.mjs` can seed fixtures without
// touching the real working tree. `run-guard-docker-packaging-paths.mjs`
// is the CLI entry point that reads the real files and calls these.

/** Workspace names `@picompanion/server`'s own build (packages/server/
 * package.json's `prepack` -> `build:clean`) and the web app it bundles
 * (apps/web/package.json's dependencies, transitively) need built first,
 * derived from each workspace's own `dependencies` field — see this
 * task's report for the `node -e` dependency-graph walk that produced it,
 * re-derived independently at the P6-W20 gate and confirmed correct. A
 * packaging recipe that silently drops one of these still "runs" but
 * produces a daemon missing a real dependency or, for `web`, bundles a
 * stale/empty `apps/web/dist`.
 *
 * The array is written in dependency order for a human reader, but the
 * PRESENCE checks that consume it directly (the per-workspace `includes()`
 * loops in `checkDockerPackaging`/`checkNixPackaging`) are order-
 * INSENSITIVE membership tests. Do not read the array's own element order
 * as something those particular loops enforce — it is not, by itself.
 *
 * CORRECTED (T174): this used to say, unconditionally, "a reordered
 * packaging recipe passes". That is no longer true for every reordering:
 * `findBuildOrderViolations` below separately enforces the real
 * `@picompanion/*` `dependencies`-field edges captured in
 * `WORKSPACE_BUILD_DEPENDENCIES` (client after protocol+relay,
 * frontend-core after client+protocol, web after design-tokens+
 * frontend-core+highlight+protocol) plus the build:clean-before-
 * build:daemon-web-ui edge. What is still true: this array's own
 * left-to-right order is not itself checked element-by-element, and a
 * reordering that does not violate one of the specific edges above
 * (e.g. swapping `@picompanion/relay` and `@picompanion/highlight`,
 * neither of which the other depends on) still passes. Enforcing the
 * array's full order was considered and declined: `@picompanion/protocol`,
 * `@picompanion/relay`, `@picompanion/highlight`, and `@picompanion/
 * design-tokens` have empty `@picompanion/*` `dependencies` fields (see
 * this task's report for the `node -e` walk), so nothing actually
 * requires them to build in this exact relative order — pinning it anyway
 * would fail a packaging recipe that reordered them for no bad reason,
 * which is a false positive this guard should not manufacture. */
export const REQUIRED_WORKSPACE_BUILD_STEPS = [
  "@picompanion/protocol",
  "@picompanion/relay",
  "@picompanion/highlight",
  "@picompanion/client",
  "@picompanion/design-tokens",
  "@picompanion/frontend-core",
  "@picompanion/web",
  "@picompanion/server",
];

/** The T43A1 packaging invariant: the daemon's own build must bundle
 * `apps/web/dist` into `packages/server/dist/server/web-ui`. Matches
 * either the root npm script name or a direct invocation of the script it
 * runs, so a packaging recipe that inlines the script path instead of
 * using the npm script still counts as satisfying this. */
const BUNDLE_STEP_PATTERN = /build:daemon-web-ui|build-daemon-web-ui\.mjs/;

/** Matches the server's own dist-wiping build step (T43A1: this MUST run
 * before `BUNDLE_STEP_PATTERN`'s step, never after — see
 * `findBuildOrderViolations`). */
const CLEAN_STEP_PATTERN = /build:clean\s+--workspace=@picompanion\/server/;

/**
 * (T174) The subset of `REQUIRED_WORKSPACE_BUILD_STEPS` edges that a real
 * `@picompanion/*` `dependencies` field (not `devDependencies` — those
 * are not needed to build a workspace's own output) actually requires,
 * keyed by the dependent workspace, valued by the workspaces it must be
 * built after. Derived by reading each workspace's real `package.json` at
 * the time this task was written (see the task report for the `node -e`
 * walk); re-derive and update this if a workspace's dependencies change.
 * `@picompanion/protocol`, `@picompanion/relay`, `@picompanion/highlight`,
 * and `@picompanion/design-tokens` have no `@picompanion/*` dependencies
 * of their own and so have no entry here — nothing requires them to build
 * in any particular relative order.
 *
 * @type {Record<string, string[]>}
 */
export const WORKSPACE_BUILD_DEPENDENCIES = {
  "@picompanion/client": ["@picompanion/protocol", "@picompanion/relay"],
  "@picompanion/frontend-core": ["@picompanion/client", "@picompanion/protocol"],
  "@picompanion/web": [
    "@picompanion/design-tokens",
    "@picompanion/frontend-core",
    "@picompanion/highlight",
    "@picompanion/protocol",
  ],
};

/**
 * (T174) Checks build ORDER, not just presence, over an already-extracted
 * command-text string (`extractDockerRunCommands`'s or
 * `extractNixPhaseCommands`'s output).
 *
 * CORRECTED (P6-W21 gate): this said that output is "comment-free by
 * construction, since both extractors only ever collect RUN lines /
 * phase-string bodies". Both halves are false, and the hole they deny is
 * live. `extractDockerRunCommands` joins line continuations
 * (`replace(/\\\r?\n/g, " ")`) BEFORE it filters for `^\s*RUN\s`, so a `#`
 * comment line inside a RUN continuation is welded into the RUN text;
 * `extractNixPhaseCommands` collects `''…''` bodies verbatim and never
 * strips the `#` shell comments that legally live inside them.
 *
 * Reproduced at the gate and again at the review, on the real files:
 * commenting out the `build:clean --workspace=@picompanion/server` line —
 * the only step that builds the server package, without which the image's
 * own `ENTRYPOINT` (`packages/server/dist/scripts/supervisor-entrypoint.js`)
 * never exists — leaves this guard at **exit 0** in BOTH packaging files.
 * The presence check finds `@picompanion/server` in the comment text and
 * the ordering check below reads the comment's position as the step's.
 * That is the catalogue's "a prohibition satisfied by a comment".
 *
 * The comment-blindness itself predates T174 (`extractDockerRunCommands`
 * dates to T43A3, `7acb3a2`); only the sentence claiming otherwise was
 * T174's. `stripDockerfileComments` and `stripNixComments` in this same
 * file already did exactly this stripping, deliberately, but only for the
 * legacy-reference check (`checkDockerPackaging`'s/`checkNixPackaging`'s
 * `findLegacyReferences(strip...(...))` calls below) — the build-step
 * checks were never given the same treatment.
 *
 * CLOSED (T178): `extractDockerRunCommands` now runs
 * `stripDockerfileComments` over the raw Dockerfile content BEFORE
 * joining line continuations — removing a whole `#`-prefixed comment line
 * (its trailing `\` included) so the previous real line's `\` joins
 * straight through to the next real line, exactly as if the commented
 * step were never written. Doing the strip AFTER the join was not an
 * option: once continuations are collapsed to one line there is no
 * newline left to anchor a whole-line-comment strip against, so it would
 * either miss the welded comment or risk eating a legitimate `#` inside a
 * real command. `extractNixPhaseCommands` strips whole `#`-prefixed lines
 * from each captured `''…''` block before joining them — no continuation
 * join happens for Nix phases (one shell command per line), so order
 * relative to a join is not a concern there. (CORRECTED at the P6-W22
 * gate: T178 used `stripNixComments`, whose `#.*$` pattern is inline, and
 * that erased the tail of any legal command containing a literal `#` —
 * inside a Nix indented string a `#` is text, not a comment. See the
 * note at the strip itself.) Reproduced RED-then-GREEN on
 * the real files: commenting out `build:clean --workspace=@picompanion/
 * server` (continuation left intact, per the reproduction above) now
 * fails with `EXIT=1` in each packaging file, mutated one at a time; the
 * files intact still pass; all four of T174's ordering/presence mutations
 * (per-file swap, intact tree, `@picompanion/highlight` omission,
 * `client`/`protocol` swap) still discriminate exactly as before. See
 * `guard-docker-packaging-paths.test.mjs`'s comment-aware tests.
 *
 * Two kinds of ordering violation:
 *   1. `build:clean --workspace=@picompanion/server` appearing at or after
 *      the `build:daemon-web-ui` step — T43A1's invariant, fatal because
 *      `build:clean` wipes `packages/server/dist` first.
 *   2. A workspace in `WORKSPACE_BUILD_DEPENDENCIES` appearing at or
 *      before one of its own listed dependencies.
 *
 * A step that is simply ABSENT is not reported here — that is the
 * existing presence checks' job (`checkDockerPackaging`/
 * `checkNixPackaging`'s `includes()` loops and `BUNDLE_STEP_PATTERN`
 * test), so this function silently skips any pair where either side's
 * first occurrence cannot be found, rather than duplicating "missing"
 * violations under a different message.
 *
 * @param {string} commandText
 * @returns {string[]} violation messages (empty when the ordering found is fine)
 */
export function findBuildOrderViolations(commandText) {
  const violations = [];

  const cleanMatch = commandText.match(CLEAN_STEP_PATTERN);
  const bundleMatch = commandText.match(BUNDLE_STEP_PATTERN);
  if (cleanMatch && bundleMatch && cleanMatch.index >= bundleMatch.index) {
    violations.push(
      "`build:clean --workspace=@picompanion/server` runs AFTER `build:daemon-web-ui` — " +
        "this wipes packages/server/dist and erases the already-bundled web UI " +
        "(T43A1's packaging invariant, reordering variant)",
    );
  }

  for (const [workspace, dependencies] of Object.entries(WORKSPACE_BUILD_DEPENDENCIES)) {
    const workspaceIndex = commandText.indexOf(workspace);
    if (workspaceIndex === -1) continue; // absence is the presence checks' job
    for (const dependency of dependencies) {
      const dependencyIndex = commandText.indexOf(dependency);
      if (dependencyIndex === -1) continue; // absence is the presence checks' job
      if (dependencyIndex >= workspaceIndex) {
        violations.push(
          `workspace "${workspace}" is built before its own dependency "${dependency}"`,
        );
      }
    }
  }

  return violations;
}

/** Legacy Paseo references forbidden anywhere under packaging/ (plan.md
 * §5's exclusion boundary). Deliberately looser than
 * `guard-no-legacy-app-tree.mjs`'s import-specifier-anchored pattern —
 * these files have no import syntax to anchor to, so any occurrence of
 * either substring is treated as a violation. Callers pass COMMENT-STRIPPED
 * content (see `stripDockerfileComments`/`stripNixComments`) — both
 * packaging files legitimately explain, in their own header comments, that
 * they are NOT derived from Paseo's `packages/app` tree (plan.md §5), which
 * would otherwise trip this exact check against its own disclaimer (the
 * catalogued "prohibition tripped by the doc comment explaining it" defect
 * class). */
const LEGACY_REFERENCE_PATTERNS = [/packages\/app\b/, /@getpaseo\//];

/**
 * @param {string} content
 * @returns {string[]} legacy substrings found (empty when clean)
 */
export function findLegacyReferences(content) {
  const hits = [];
  for (const pattern of LEGACY_REFERENCE_PATTERNS) {
    const match = content.match(pattern);
    if (match) hits.push(match[0]);
  }
  return hits;
}

/**
 * Strips `#`-prefixed comment lines from a Dockerfile. A crude line-based
 * strip (does not understand quoting), sufficient for this guard's one use
 * (excluding comment prose from the legacy-reference scan) — real
 * Dockerfile parsing is not needed for that.
 *
 * @param {string} content
 * @returns {string}
 */
export function stripDockerfileComments(content) {
  return content
    .split(/\r?\n/)
    .filter((line) => !/^\s*#/.test(line))
    .join("\n");
}

/**
 * Strips `#`-to-end-of-line and `/* ... *\/` comments from a Nix file. A
 * crude strip (does not understand string literals that might contain
 * `#` or `/*`), sufficient for this guard's one use.
 *
 * @param {string} content
 * @returns {string}
 */
export function stripNixComments(content) {
  return content.replace(/\/\*[\s\S]*?\*\//g, "").replace(/#.*$/gm, "");
}

/**
 * Extracts `COPY` instruction source arguments from a Dockerfile, one
 * entry per non-`--from=` COPY (a `--from=<stage>` source is a path inside
 * an earlier build stage's filesystem, not a build-context path, and is
 * excluded — this only checks build-context paths, which is what a real
 * `docker build` resolves against the directory `-f packaging/docker/
 * Dockerfile .` is run from). Handles line continuations (`\` at end of
 * line) since Dockerfile instructions may span multiple lines.
 *
 * @param {string} dockerfileContent
 * @returns {string[]} source path arguments, repo-root-relative (e.g. "."
 *   or "package.json"), destination arguments excluded
 */
export function extractDockerCopySources(dockerfileContent) {
  const joined = dockerfileContent.replace(/\\\r?\n/g, " ");
  const sources = [];
  for (const rawLine of joined.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!/^COPY\s/i.test(line)) continue;
    if (/--from=/.test(line)) continue;
    const withoutInstruction = line.replace(/^COPY\s+/i, "");
    const withoutFlags = withoutInstruction.replace(/--[\w-]+(=\S+)?\s+/g, "");
    const args = withoutFlags.split(/\s+/).filter(Boolean);
    // Last argument is the destination; everything before it is a source.
    sources.push(...args.slice(0, -1));
  }
  return sources;
}

/**
 * Concatenates every `RUN` instruction's command text (line continuations
 * joined), for substring-matching the workspace/bundle-step checks against.
 *
 * (T178) Comment lines are stripped BEFORE the continuation join, not
 * after — order matters here. A `#`-prefixed line commenting out one step
 * of a continued RUN chain still legally ends in `\` (the reproduction in
 * `findBuildOrderViolations`' doc comment below leaves that continuation
 * "intact" on purpose), so joining first would weld the comment's text
 * into the same line as the next real instruction, with no newline left
 * to anchor a strip against. Removing whole comment lines first — via
 * `stripDockerfileComments`, which already existed for the (unrelated)
 * legacy-reference check below — deletes the comment line's own trailing
 * `\` along with it, so the previous real line's `\` now joins directly
 * to the next real line, exactly as if the commented step had never been
 * written. None of this repository's real RUN commands contain a literal
 * `#` (checked at T178: `grep` over every RUN block), so the crude
 * line-based strip (documented on `stripDockerfileComments` as not
 * understanding quoting) cannot eat a legitimate `#` here.
 *
 * @param {string} dockerfileContent
 * @returns {string}
 */
export function extractDockerRunCommands(dockerfileContent) {
  const withoutComments = stripDockerfileComments(dockerfileContent);
  const joined = withoutComments.replace(/\\\r?\n/g, " ");
  return joined
    .split(/\r?\n/)
    .filter((line) => /^\s*RUN\s/i.test(line))
    .join("\n");
}

/**
 * @param {{ dockerfileContent: string, repoPathExists: (path: string) => boolean }} args
 * @returns {{ ok: boolean, violations: string[] }}
 */
export function checkDockerPackaging({ dockerfileContent, repoPathExists }) {
  const violations = [];

  const copySources = extractDockerCopySources(dockerfileContent);
  for (const source of copySources) {
    if (!repoPathExists(source)) {
      violations.push(`COPY source "${source}" does not exist in the repository`);
    }
  }

  const runCommands = extractDockerRunCommands(dockerfileContent);
  for (const workspace of REQUIRED_WORKSPACE_BUILD_STEPS) {
    if (!runCommands.includes(workspace)) {
      violations.push(`no RUN instruction builds workspace "${workspace}"`);
    }
  }
  if (!BUNDLE_STEP_PATTERN.test(runCommands)) {
    violations.push(
      "no RUN instruction runs the build:daemon-web-ui step (T43A1's packaging invariant)",
    );
  }
  violations.push(...findBuildOrderViolations(runCommands));

  for (const legacyHit of findLegacyReferences(stripDockerfileComments(dockerfileContent))) {
    violations.push(`references a legacy Paseo path/scope: "${legacyHit}"`);
  }

  return { ok: violations.length === 0, violations };
}

/**
 * Extracts the `src = <path>;` attribute value from a Nix flake's
 * `buildNpmPackage` call. Returns null when no such attribute is found.
 *
 * @param {string} flakeContent
 * @returns {string | null}
 */
export function extractNixSrcPath(flakeContent) {
  const match = flakeContent.match(/\bsrc\s*=\s*([^;]+);/);
  return match ? match[1].trim() : null;
}

/**
 * Concatenates the Nix flake's `buildPhase`/`installPhase` string literal
 * bodies, for substring-matching the workspace/bundle-step checks against.
 * Nix multi-line strings use `''...''`; this extracts every such block
 * rather than assuming exactly one.
 *
 * (T178) Each block is passed through `stripNixComments` before joining.
 * Unlike the Docker extractor above, order relative to any join is not a
 * concern here: a Nix phase body has one shell command per line with no
 * backslash line-continuation to weld a comment into, so stripping each
 * block right after it is captured (rather than stripping the whole file
 * first) is equivalent and keeps the strip scoped to the text this
 * function actually returns. `stripNixComments`'s `#.*$` strip also
 * blanks the unrelated `#!${pkgs.runtimeShell}` shebang line inside
 * `installPhase`'s heredoc — harmless here since that line never contains
 * a workspace name or either build-step pattern this module matches
 * against.
 *
 * @param {string} flakeContent
 * @returns {string}
 */
export function extractNixPhaseCommands(flakeContent) {
  const blocks = [];
  const pattern = /''([\s\S]*?)''/g;
  let match;
  while ((match = pattern.exec(flakeContent)) !== null) {
    // CORRECTED (P6-W22 gate): this called `stripNixComments(match[1])`,
    // whose pattern is inline (`#.*$`). Inside a Nix `''…''` indented string a
    // `#` is literal text at both the Nix and the shell level, so an inline
    // strip erases the rest of any legal command containing one. Measured on
    // the real flake: rewriting the highlight build step to
    // `echo "step 3 # of 8" && npm run build --workspace=@picompanion/highlight`
    // took this guard to EXIT=1 with `no build phase command builds workspace
    // "@picompanion/highlight"` — a build step the file genuinely runs, erased.
    // The pre-T178 guard passes on that same flake, so the false positive was
    // introduced by T178's own fix. Anchoring the strip to whole comment lines
    // (`^\s*#`) mirrors what `stripDockerfileComments` already does and what
    // a shell actually treats as a comment, and keeps T178's real fix: a
    // commented-out `build:clean` line still fails.
    blocks.push(
      match[1]
        .split(/\r?\n/)
        .filter((line) => !/^\s*#/.test(line))
        .join("\n"),
    );
  }
  return blocks.join("\n");
}

/**
 * A shallow well-formedness check: every brace/paren/bracket in the file
 * is balanced. This is not a Nix parser and cannot catch most syntax
 * errors `nix flake check` would — see packaging/nix/README.md's
 * disclosure of exactly that gap — but it does catch the class of error
 * most likely from hand-editing (an unclosed block).
 *
 * @param {string} content
 * @returns {boolean}
 */
export function hasBalancedDelimiters(content) {
  const pairs = { "{": "}", "(": ")", "[": "]" };
  const closers = new Set(Object.values(pairs));
  const stack = [];
  for (const char of content) {
    if (pairs[char]) {
      stack.push(pairs[char]);
    } else if (closers.has(char)) {
      if (stack.pop() !== char) return false;
    }
  }
  return stack.length === 0;
}

/**
 * @param {{ flakeContent: string, repoPathExists: (path: string) => boolean }} args
 * @returns {{ ok: boolean, violations: string[] }}
 */
export function checkNixPackaging({ flakeContent, repoPathExists }) {
  const violations = [];

  if (!hasBalancedDelimiters(flakeContent)) {
    violations.push("unbalanced braces/parens/brackets — likely a hand-edit syntax error");
  }

  const srcPath = extractNixSrcPath(flakeContent);
  if (!srcPath) {
    violations.push("no `src = ...;` attribute found in the buildNpmPackage derivation");
  } else if (!repoPathExists(srcPath)) {
    violations.push(`\`src\` path "${srcPath}" does not exist in the repository`);
  }

  const phaseCommands = extractNixPhaseCommands(flakeContent);
  for (const workspace of REQUIRED_WORKSPACE_BUILD_STEPS) {
    if (!phaseCommands.includes(workspace)) {
      violations.push(`no build phase command builds workspace "${workspace}"`);
    }
  }
  if (!BUNDLE_STEP_PATTERN.test(phaseCommands)) {
    violations.push(
      "no build phase command runs the build:daemon-web-ui step (T43A1's packaging invariant)",
    );
  }
  violations.push(...findBuildOrderViolations(phaseCommands));

  for (const legacyHit of findLegacyReferences(stripNixComments(flakeContent))) {
    violations.push(`references a legacy Paseo path/scope: "${legacyHit}"`);
  }

  return { ok: violations.length === 0, violations };
}
