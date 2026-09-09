// T310: CI guard — every `npx <name>` this repository actually executes must
// name something npx can really resolve: either a binary a declared,
// locked dependency ships, or a package registered below as deliberately
// fetched from the registry at run time.
//
// ## The defect this closes
//
// `.github/workflows/android-maestro-e2e.yml` ran `npx eas build ...`. `eas`
// reads like the name of the EAS CLI, and `eas` IS the name of its binary —
// but `npx` takes a PACKAGE name, and the package named `eas` on npm is an
// unrelated `0.1.0` squat with no `bin` field at all. So npx downloaded it
// and died with:
//
//   npm error could not determine executable to run
//
// All six jobs of Maestro run 34368430903 failed that way, in seconds,
// before any EAS build started. The binary `eas` is shipped BY the package
// `eas-cli` (`bin = { eas: "bin/run" }`), so `npx eas-cli` is the correct
// invocation and `npx eas` can never work.
//
// The trap generalises past `eas`: `npx tsc`, `npx vitest`, `npx playwright`
// all work here — not because those are package names (only `vitest` and
// `playwright` are) but because a locally installed dependency puts each
// binary on `node_modules/.bin`, which npx checks before the registry. The
// moment the local install is missing, or the tool is not a dependency at
// all, npx silently falls back to downloading a package of that literal
// name. That fallback is what turns a typo — or an honest binary/package
// confusion — into a remote failure minutes or hours later.
//
// ## What makes this checkable statically
//
// `package-lock.json` (lockfileVersion 3) records each installed package's
// own `bin` map, so the set of binaries that will exist on `.bin` after
// `npm ci` is derivable from a committed file, with no `node_modules` on
// disk and no network. `collectLockfileBins` below reads exactly that.
// Anything npx is asked to run that is NOT in that set must be registered
// in `EXTERNAL_NPX_PACKAGES` with a real reason — which is the step that
// would have caught `eas`, because writing the entry forces the author to
// name the package that ships the binary.
//
// ## Scope
//
// Only text that would actually execute: the content of each `run:` step in
// `.github/workflows/*.yml` (extracted by `guard-run-guard-wiring.mjs`'s
// `extractRunStepContents`, reused rather than re-implemented a fourth
// time), with `#` comments blanked, plus every tracked `package.json`'s own
// `scripts` values. Comments are stripped for the same reason that guard
// strips them, and this file is a live demonstration of why: the two real
// `npx eas-cli` steps in this repository each sit under a comment block
// that spells out `npx eas` several times to explain the bug, and so does
// the header you are reading. A guard matching raw file text would report
// its own explanation as the defect.
//
// Pure, dependency-free check functions only; `run-guard-npx-binary-
// package.mjs` is the CLI entry point.

import { extractRunStepContents, stripHashComments } from "./guard-run-guard-wiring.mjs";

/**
 * Packages this repository deliberately asks npx to fetch from the registry
 * rather than install as a dependency. The KEY is the exact token that must
 * follow `npx` — that is, the package name npx will download — and `binary`
 * records the differently-named executable inside it, which is precisely the
 * distinction `npx eas` got wrong.
 *
 * @type {Record<string, { binary: string, reason: string }>}
 */
export const EXTERNAL_NPX_PACKAGES = {
  "eas-cli": {
    binary: "eas",
    reason:
      "installed at job time by expo/expo-github-action, not by this repository's package-lock, " +
      "so no lockfile bin can vouch for it. Written as the PACKAGE name `eas-cli` and never as " +
      "the binary name `eas`: the npm package literally named `eas` is an unrelated 0.1.0 squat " +
      "with no bin, which is how Maestro run 34368430903 failed in seconds.",
  },
  "lockfile-lint": {
    binary: "lockfile-lint",
    reason:
      "run once per CI run as `npx --yes lockfile-lint` against package-lock.json itself, " +
      "deliberately NOT a declared dependency: it audits the lockfile, so installing it through " +
      "that same lockfile would make the auditor a member of what it audits.",
  },
};

/** Minimum length a registered reason must clear to count as a real reason
 * rather than a placeholder (`""`, `"TODO"`) that would turn registering a
 * package into a silent skip instead of a visible decision. Mirrors
 * `guard-run-guard-wiring.mjs`'s own threshold for the same purpose. */
const MIN_EXTERNAL_REASON_LENGTH = 20;

/**
 * @param {unknown} reason
 * @returns {boolean}
 */
export function isValidExternalNpxReason(reason) {
  return typeof reason === "string" && reason.trim().length >= MIN_EXTERNAL_REASON_LENGTH;
}

// `npx`, then any number of npx's own dash-prefixed flags (`--yes`, `-y`,
// `--package=x`, `--no-install`), then the first non-flag token: the name npx
// will resolve. Anchored to a shell word boundary so `foo-npx bar` and
// `"...npx..."` inside a longer word never match.
const NPX_INVOCATION_PATTERN =
  /(?:^|[\s;&|(`$])npx(?:[ \t]+-{1,2}[^\s]+)*[ \t]+([@a-zA-Z0-9._][@a-zA-Z0-9._/-]*)/g;

/**
 * @param {string} shellText text that would actually be handed to a shell
 * @returns {string[]} the token following each `npx` invocation, in order
 */
export function extractNpxTargets(shellText) {
  return [...shellText.matchAll(NPX_INVOCATION_PATTERN)].map((match) => match[1]);
}

/**
 * Every binary name that will exist on `node_modules/.bin` after `npm ci`,
 * read from the lockfile's own per-package `bin` maps.
 *
 * @param {{ packages?: Record<string, { bin?: Record<string, string> }> }} lockfile
 *   parsed `package-lock.json`
 * @returns {Set<string>}
 */
export function collectLockfileBins(lockfile) {
  const bins = new Set();
  for (const entry of Object.values(lockfile?.packages ?? {})) {
    for (const binary of Object.keys(entry?.bin ?? {})) bins.add(binary);
  }
  return bins;
}

/**
 * @typedef {{ target: string, source: string }} NpxInvocation
 */

/**
 * @param {{ path: string, content: string }[]} workflows tracked
 *   `.github/workflows/*.yml` files
 * @returns {NpxInvocation[]}
 */
export function collectWorkflowNpxInvocations(workflows) {
  const invocations = [];
  for (const workflow of workflows) {
    for (const runContent of extractRunStepContents(workflow.content)) {
      for (const target of extractNpxTargets(stripHashComments(runContent))) {
        invocations.push({ target, source: workflow.path });
      }
    }
  }
  return invocations;
}

/**
 * @param {{ path: string, content: string }[]} manifests tracked
 *   `package.json` files
 * @returns {NpxInvocation[]}
 */
export function collectManifestNpxInvocations(manifests) {
  const invocations = [];
  for (const manifest of manifests) {
    /** @type {{ scripts?: Record<string, string> }} */
    const json = JSON.parse(manifest.content);
    for (const [name, script] of Object.entries(json.scripts ?? {})) {
      for (const target of extractNpxTargets(String(script))) {
        invocations.push({ target, source: `${manifest.path} scripts.${name}` });
      }
    }
  }
  return invocations;
}

/**
 * @typedef {{
 *   kind: "binary-not-package" | "unresolvable" | "placeholder-reason"
 *       | "stale-uninvoked" | "stale-locally-installed",
 *   target: string,
 *   source?: string,
 *   suggestion?: string,
 * }} NpxBinaryPackageViolation
 */

/**
 * @param {{
 *   invocations: NpxInvocation[],
 *   lockfileBins: Set<string>,
 *   external?: Record<string, { binary: string, reason: string }>,
 * }} input
 * @returns {NpxBinaryPackageViolation[]}
 */
export function findNpxBinaryPackageViolations({
  invocations,
  lockfileBins,
  external = EXTERNAL_NPX_PACKAGES,
}) {
  const violations = [];
  const invokedTargets = new Set(invocations.map((invocation) => invocation.target));

  // Stale registrations, walked over the registry's OWN keys rather than
  // from inside the invocation loop below — the T211 lesson from
  // `guard-run-guard-wiring.mjs`: an entry the main loop never reaches
  // (because nothing invokes it, or because it now resolves locally) would
  // otherwise sit here forever, unread and unfalsifiable.
  for (const packageName of Object.keys(external)) {
    if (!invokedTargets.has(packageName)) {
      violations.push({ kind: "stale-uninvoked", target: packageName });
      continue;
    }
    if (lockfileBins.has(packageName)) {
      violations.push({ kind: "stale-locally-installed", target: packageName });
    }
  }

  for (const { target, source } of invocations) {
    if (lockfileBins.has(target)) continue;

    if (Object.hasOwn(external, target)) {
      if (!isValidExternalNpxReason(external[target].reason)) {
        violations.push({ kind: "placeholder-reason", target, source });
      }
      continue;
    }

    // The exact T310 shape: the token is the BINARY shipped by a package
    // this repository already registered under its real name. npx would
    // download a package of the binary's name instead.
    const shippedBy = Object.entries(external).find(([, entry]) => entry.binary === target);
    if (shippedBy) {
      violations.push({ kind: "binary-not-package", target, source, suggestion: shippedBy[0] });
      continue;
    }

    violations.push({ kind: "unresolvable", target, source });
  }

  return violations;
}

/**
 * @param {string[]} trackedPaths output of `git ls-files`
 * @returns {string[]} the workflow files this guard reads
 */
export function selectWorkflowFiles(trackedPaths) {
  return trackedPaths.filter((path) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(path));
}

/**
 * @param {string[]} trackedPaths output of `git ls-files`
 * @returns {string[]} the manifests this guard reads `scripts` from
 */
export function selectManifestFiles(trackedPaths) {
  return trackedPaths.filter((path) => /(^|\/)package\.json$/.test(path));
}
