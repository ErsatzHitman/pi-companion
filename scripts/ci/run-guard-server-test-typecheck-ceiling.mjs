#!/usr/bin/env node
// CLI entry point for the packages/server test-typecheck ceiling guard
// (T102, hardened by T119). Run from anywhere inside the repository:
//
//   node scripts/ci/run-guard-server-test-typecheck-ceiling.mjs
//
// Also invoked as the second half of `@picompanion/server`'s "typecheck"
// script (see packages/server/package.json), so `npm run typecheck` (and
// therefore CI's `npm run typecheck --workspaces --if-present`) runs it on
// every typecheck, not merely as a standalone check someone has to
// remember to run.
//
// Spawns tsgo directly against `packages/server/tsconfig.server.tests.json`
// (which includes src/**/*.test.ts, unlike tsconfig.server.typecheck.json)
// with `--noEmit --listFiles`, in a SINGLE invocation: `--listFiles` prints
// tsgo's own resolved-file list alongside its normal diagnostics (verified
// against `--noEmit` alone: same error count, same exit code), so this one
// run gives both numbers `evaluateTypecheckRun` needs — the error count and
// the resolved-test-file count — without doubling the compiler's runtime or
// letting the two numbers come from two different resolutions of `include`.
//
// T119: the failure this file used to have is that `resolveTsgoBinary`'s
// throw (tsgo entry not found) was caught by the same blanket try/catch as
// a normal "tsgo exited non-zero because it found real diagnostics", and
// both were treated identically — a plain Error carries no `.stdout`, so
// the measured output silently became "", i.e. zero errors, i.e. exit 0.
// `isSpawnFailure` below tells those two cases apart: a genuine tsgo
// run that reports diagnostics always sets a numeric `.status` (its process
// exit code); resolveTsgoBinary's manual Error, or any other failure that
// prevented the process from actually completing a compile, does not. Only
// the latter is treated as "tsgo could not be run" and reported as a loud
// failure rather than a clean zero.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  countResolvedTestFiles,
  countTypecheckErrors,
  evaluateTypecheckRun,
} from "./guard-server-test-typecheck-ceiling.mjs";

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" });
}

function resolveTsgoBinary(repoRoot) {
  // Resolve the real tsgo entry script rather than relying on a shell
  // shebang or PATH — this CLI is invoked with plain `node`, which does not
  // pick up node_modules/.bin the way an `npm run` script does.
  const entry = path.join(
    repoRoot,
    "node_modules",
    "@typescript",
    "native-preview",
    "bin",
    "tsgo.js",
  );
  if (!existsSync(entry)) {
    throw new Error(`run-guard-server-test-typecheck-ceiling: tsgo entry not found at ${entry}`);
  }
  return entry;
}

function runTsgo(repoRoot) {
  const tsgoEntry = resolveTsgoBinary(repoRoot);
  const serverDir = path.join(repoRoot, "packages", "server");
  return execFileSync(
    process.execPath,
    [tsgoEntry, "-p", "tsconfig.server.tests.json", "--noEmit", "--listFiles"],
    {
      cwd: serverDir,
      encoding: "utf8",
      // tsgo exits non-zero when diagnostics are reported; execFileSync
      // would otherwise throw, so capture stdout/stderr ourselves.
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 64 * 1024 * 1024,
    },
  );
}

/**
 * Tells a genuine tsgo run (which always sets a numeric process `.status`,
 * even when it exits non-zero because it found diagnostics) apart from a
 * failure that meant the compiler never actually completed a compile at
 * all — resolveTsgoBinary's own thrown `Error` (no such property), or any
 * other spawn failure with the same shape. Only the latter should ever be
 * reported as "tsgo could not be run"; the former is the guard's normal
 * operating mode.
 *
 * @param {unknown} error
 * @returns {boolean}
 */
export function isSpawnFailure(error) {
  return typeof error?.status !== "number";
}

function describeSpawnError(error) {
  const message = error?.message ?? String(error);
  const code = error?.code ? ` (${error.code})` : "";
  return `${message}${code}`;
}

function main() {
  const root = git(["rev-parse", "--show-toplevel"]).trim();

  let output = "";
  let spawnError = null;
  try {
    output = runTsgo(root);
  } catch (error) {
    if (isSpawnFailure(error)) {
      spawnError = describeSpawnError(error);
    } else {
      // A real tsgo run that exited non-zero because it reported
      // diagnostics — execFileSync throws on non-zero exit, but the
      // diagnostics we need are on the thrown error's stdout/stderr, not
      // lost with the exception.
      output = `${error.stdout ?? ""}${error.stderr ?? ""}`;
    }
  }

  const errorCount = spawnError ? 0 : countTypecheckErrors(output);
  const resolvedTestFileCount = spawnError ? 0 : countResolvedTestFiles(output);
  const result = evaluateTypecheckRun({ errorCount, resolvedTestFileCount, spawnError });

  if (result.ok) {
    console.log(
      `guard-server-test-typecheck-ceiling: OK — ${result.errorCount} error(s) across ` +
        `${result.resolvedTestFileCount} resolved packages/server test file(s) ` +
        `(ceiling ${result.ceiling}, floor ${result.errorFloor}, file-count floor ` +
        `${result.fileCountFloor}). Lower TYPECHECK_ERROR_CEILING in ` +
        "scripts/ci/guard-server-test-typecheck-ceiling.mjs as errors are fixed.",
    );
    return;
  }

  console.error("guard-server-test-typecheck-ceiling: FAILED");
  for (const reason of result.reasons) {
    console.error(`  - ${reason}`);
  }
  console.error(
    "  This guard enforces a ceiling AND a floor on packages/server's test-file typecheck " +
      "error count, plus a floor on how many test files tsgo itself resolves, so an interface " +
      "change only a test file would catch (T97), a revert that quietly re-excludes test files " +
      "(T119's probe), or tsgo failing to run at all can never masquerade as success. Fix the " +
      "new error(s), or if this run genuinely fixed errors and the real count is lower than " +
      "the ceiling, lower TYPECHECK_ERROR_CEILING (and, if you removed test files on purpose, " +
      "TYPECHECK_TEST_FILE_COUNT_FLOOR) to match — never raise or lower either to paper over an " +
      "unexplained drop.",
  );
  if (output) console.error(output);
  process.exitCode = 1;
}

// Guarded so `guard-server-test-typecheck-ceiling.test.mjs` can import the
// pure `isSpawnFailure` helper above without triggering a real tsgo run as
// an import side effect — only run `main` when this file is the actual CLI
// entry point (`node run-guard-server-test-typecheck-ceiling.mjs`), the way
// `package.json`'s "typecheck" script invokes it. `pathToFileURL` (rather
// than hand-building a `file://` string) is what keeps this comparison
// correct on Windows, where `process.argv[1]` is a `D:\...` path.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
