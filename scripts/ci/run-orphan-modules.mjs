#!/usr/bin/env node
// CLI entry point for the import-graph orphan walker. Run from the
// repository root:
//
//   node scripts/ci/run-orphan-modules.mjs
//
// See scripts/ci/orphan-modules.mjs for the graph logic and the six
// catalogued over-reporting (and one under-reporting) modes it handles.
//
// T125: this enforces a ceiling, not an exact-equality target — see that
// script's own comment for why an exact-count gate is a trap for the next
// task that legitimately adds a file. Lower ORPHAN_COUNT_CEILING by hand
// whenever a real fix (wiring or deleting an orphan) drops the count;
// never raise it to make a red build green without also filing why.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { findOrphanModules, isTrackedModuleFile } from "./orphan-modules.mjs";

// Real count at last measurement (2026-09-05, HEAD 40d23f6): 27 — the same
// stable, base-vs-HEAD-identical figure the P6-W4 ad hoc walk reported
// (T125's brief). Every one of the 27 was read by hand and falls into one
// of these audited buckets, none of which are among the six required
// modes this walker implements (T125's brief names exactly six; these are
// real, disclosed limitations beyond that scope, not walker bugs):
//   - a package.json "bin" entry point whose script imports the package's
//     *built* dist output (packages/cli/bin/paseo -> ../dist/index.js),
//     so the src file that dist was compiled from
//     (packages/cli/src/index.ts) has no traceable src-level edge;
//   - a package that publishes via "main"/"types" instead of an "exports"
//     map (packages/expo-two-way-audio — an Expo native module resolved
//     by Expo autolinking, not Node's exports resolution), so its whole
//     src/ (plus its own examples/) has no entry seed;
//   - a test runner's setupFiles path built as a resolved expression
//     (`path.resolve(__dirname, "./src/test-utils/vitest-setup.ts")` in
//     packages/server/vitest.config.ts; the equivalent string literal in
//     apps/web/vitest.config.ts) rather than a static import;
//   - a file spawned as a child process by a dynamically-built path string
//     inside a test (packages/server's hub-cli-entry.ts,
//     paused-ipc-worker.cjs, outdated-daemon-process.ts,
//     terminal-ts-loader.mjs) under a name outside the three explicitly
//     named worker files this walker does recognize;
//   - packages/client/examples/*.ts and packages/expo-two-way-audio's own
//     examples/** — standalone demo scripts, never imported by design;
//   - packages/pi-bridge/pi-companion-bridge.mjs — its own header comment
//     documents it as "the daemon's --extension fallback", loaded by a
//     runtime config path, not a static import;
//   - packages/cli/tests/{run-all.ts,setup.ts,tmp/*.ts} — a `tsx`-invoked
//     test harness (package.json's "test:local" script) and its scratch
//     fixtures, not caught by any of the six modes (a "tests/" directory
//     is not one of the CLI/child-process convention segments);
// CORRECTED (P7-W7 merge gate, 2026-09-06): the list above used to close
// with a 27th bucket — "apps/web/src/features/settings/index.ts — a real,
// currently-unwired barrel (T131, a later wave task, mounts
// AgentSettingsPanel)". That barrel is wired now and is no longer in the
// walker's output, so the real count is 26 and the ceiling drops with it.
// Lower this number as an orphan above is wired, deleted, or the walker
// gains a seventh mode that resolves it; raise it only for a single
// deliberate commit that legitimately adds a not-yet-wired module, and say
// so in that commit's message.
//
// This ratchet is the whole point of the guard, and P7-W7 is what proved
// it: T42A3 shipped four modules under
// apps/android/src/features/diagnostics/ that no route imported, the count
// went 26 -> 30, and CI run 34029733785 went red. The fix was to mount the
// screen (app/h/[serverId]/diagnostics.tsx), not to raise this number.
export const ORPHAN_COUNT_CEILING = 26;

const WORKSPACE_GLOB_DIRS = ["packages", "apps"];

function listTrackedFiles() {
  const output = execFileSync("git", ["ls-files"], { encoding: "utf8" });
  return output.split("\n").filter(Boolean);
}

/**
 * Reads every packages/*\/package.json and apps/*\/package.json this repo
 * tracks and turns each into the { name, dir, exports } shape
 * orphan-modules.mjs's resolver expects. Deliberately narrow to two
 * directories deep — this repo's own workspace globs
 * (`"workspaces": ["packages/*", "apps/*"]` in the root package.json) —
 * rather than a general node_modules-style package scan.
 */
function loadWorkspacePackages(trackedFiles) {
  const manifestPaths = trackedFiles.filter(
    (path) =>
      path.endsWith("/package.json") &&
      WORKSPACE_GLOB_DIRS.some((dir) => {
        const rest = path.slice(dir.length + 1);
        return path.startsWith(`${dir}/`) && rest.split("/").length === 2;
      }),
  );

  return manifestPaths.map((manifestPath) => {
    const dir = manifestPath.slice(0, -"/package.json".length);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    return { name: manifest.name, dir, exports: manifest.exports };
  });
}

function main() {
  const trackedFiles = listTrackedFiles();
  const files = trackedFiles.filter(isTrackedModuleFile);
  const packages = loadWorkspacePackages(trackedFiles);

  const contents = new Map();
  for (const file of files) {
    contents.set(file, readFileSync(file, "utf8"));
  }

  const { orphans } = findOrphanModules({ files, contents, packages });

  console.log(
    `orphan-modules: ${orphans.length} orphan module(s) (ceiling ${ORPHAN_COUNT_CEILING})`,
  );
  for (const orphan of orphans) {
    console.log(`  ${orphan}`);
  }

  if (orphans.length > ORPHAN_COUNT_CEILING) {
    console.error(
      `orphan-modules: FAILED — ${orphans.length} exceeds the committed ceiling of ` +
        `${ORPHAN_COUNT_CEILING}. Either wire/delete the new orphan(s) above, or raise ` +
        `ORPHAN_COUNT_CEILING in this file in the same commit and say why.`,
    );
    process.exitCode = 1;
    return;
  }

  console.log("orphan-modules: OK — orphan count is within the committed ceiling.");
}

main();
