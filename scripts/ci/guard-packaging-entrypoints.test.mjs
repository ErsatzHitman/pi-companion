// T175: unit tests for guard-packaging-entrypoints.mjs's pure functions.
// No real Docker/Nix build here (neither toolchain is available) — see
// this task's report for the reproduction of the P6-W20 latent gap against
// the real packaging/docker/Dockerfile and packaging/nix/flake.nix
// content, and the RED-then-GREEN proof this guard's checks give against
// the same bogus-path rewrites.
//
// "Real file" fixtures below read the committed HEAD content via `git
// show`, not the live working tree — this wave has multiple agents editing
// packaging/docker/Dockerfile and packages/ci/guard-docker-packaging-
// paths.mjs concurrently (T178 shares this wave), so reading off disk
// mid-session risks transient, unrelated edits. `git show HEAD:<path>`
// is immune to that and matches this repository's own T93 principle of
// testing committed content.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import {
  artifactPathResolves,
  checkDockerEntrypoint,
  checkNixEntrypoint,
  dockerAbsolutePathToRepoRelative,
  extractDockerEntrypointPaths,
  extractNixLauncherPath,
  mapArtifactPathToSourceCandidates,
  nixLauncherPathToRepoRelative,
  parseDockerInstructionTokens,
  pickExecutablePath,
  resolveDockerPath,
} from "./guard-packaging-entrypoints.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

function gitShowHead(relativePath) {
  return execFileSync("git", ["show", `HEAD:${relativePath.replace(/\\/g, "/")}`], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
}

function realDockerfile() {
  return gitShowHead("packaging/docker/Dockerfile");
}

function realFlake() {
  return gitShowHead("packaging/nix/flake.nix");
}

/** existsSync against the REPO_ROOT (working tree, not committed content —
 * a source file's own presence is not something `git show` needs to
 * substitute for since source files are not what this wave's concurrent
 * edits touch). */
function realRepoPathExists() {
  return (candidate) => existsSync(path.join(REPO_ROOT, candidate));
}

function allPathsExist() {
  return () => true;
}

function noPathsExist() {
  return () => false;
}

// --- parseDockerInstructionTokens / pickExecutablePath ---------------------

test("parseDockerInstructionTokens parses JSON-array form", () => {
  assert.deepEqual(parseDockerInstructionTokens('["node", "dist/scripts/x.js"]'), [
    "node",
    "dist/scripts/x.js",
  ]);
});

test("parseDockerInstructionTokens parses shell form", () => {
  assert.deepEqual(parseDockerInstructionTokens("node dist/scripts/x.js"), [
    "node",
    "dist/scripts/x.js",
  ]);
});

test("pickExecutablePath returns the path after a known interpreter", () => {
  assert.equal(pickExecutablePath(["node", "dist/scripts/x.js"]), "dist/scripts/x.js");
});

test("pickExecutablePath returns the bare token when it looks like a path", () => {
  assert.equal(pickExecutablePath(["./dist/scripts/x.js"]), "./dist/scripts/x.js");
});

test('pickExecutablePath returns null for a command with no discernible path (CMD ["npm", "start"])', () => {
  assert.equal(pickExecutablePath(["npm", "start"]), null);
});

// --- resolveDockerPath ------------------------------------------------------

test("resolveDockerPath joins a relative path against WORKDIR", () => {
  assert.equal(
    resolveDockerPath("dist/scripts/x.js", "/repo/packages/server"),
    "/repo/packages/server/dist/scripts/x.js",
  );
});

test("resolveDockerPath returns an absolute path unchanged (normalized)", () => {
  assert.equal(resolveDockerPath("/abs/x.js", "/repo/packages/server"), "/abs/x.js");
});

test("resolveDockerPath defaults to / when WORKDIR was never set", () => {
  assert.equal(resolveDockerPath("x.js", null), "/x.js");
});

// --- extractDockerEntrypointPaths ------------------------------------------

test("extractDockerEntrypointPaths resolves ENTRYPOINT against the last WORKDIR in its own stage", () => {
  const dockerfile = [
    "FROM node:22 AS builder",
    "WORKDIR /repo",
    "FROM node:22 AS runtime",
    "WORKDIR /repo",
    "WORKDIR /repo/packages/server",
    'ENTRYPOINT ["node", "dist/scripts/supervisor-entrypoint.js"]',
  ].join("\n");
  const entries = extractDockerEntrypointPaths(dockerfile);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].instruction, "ENTRYPOINT");
  assert.equal(
    entries[0].resolvedPath,
    "/repo/packages/server/dist/scripts/supervisor-entrypoint.js",
  );
});

test("extractDockerEntrypointPaths resets WORKDIR for a stage FROM an unrelated base image", () => {
  const dockerfile = [
    "FROM node:22 AS builder",
    "WORKDIR /repo/deep/path",
    "FROM node:22 AS runtime",
    'ENTRYPOINT ["node", "x.js"]',
  ].join("\n");
  const entries = extractDockerEntrypointPaths(dockerfile);
  // No WORKDIR in "runtime" and it does not inherit "builder"'s (different
  // base image) -> resolves against the Docker default of "/".
  assert.equal(entries[0].resolvedPath, "/x.js");
});

test("extractDockerEntrypointPaths INHERITS WORKDIR when a stage is FROM an earlier named stage", () => {
  const dockerfile = [
    "FROM node:22 AS builder",
    "WORKDIR /repo/packages/server",
    "FROM builder AS runtime",
    'ENTRYPOINT ["node", "x.js"]',
  ].join("\n");
  const entries = extractDockerEntrypointPaths(dockerfile);
  assert.equal(entries[0].resolvedPath, "/repo/packages/server/x.js");
});

test("extractDockerEntrypointPaths finds CMD too, and skips a CMD with no path token", () => {
  const dockerfile = ["FROM node:22", 'CMD ["npm", "start"]'].join("\n");
  assert.deepEqual(extractDockerEntrypointPaths(dockerfile), []);
});

// --- dockerAbsolutePathToRepoRelative ---------------------------------------

test("dockerAbsolutePathToRepoRelative strips the /repo container-root convention", () => {
  assert.equal(
    dockerAbsolutePathToRepoRelative("/repo/packages/server/dist/scripts/x.js"),
    "packages/server/dist/scripts/x.js",
  );
});

test("dockerAbsolutePathToRepoRelative returns null for a path outside the known root", () => {
  assert.equal(dockerAbsolutePathToRepoRelative("/usr/local/bin/node"), null);
});

// --- extractNixLauncherPath / nixLauncherPathToRepoRelative -----------------

test("extractNixLauncherPath finds the quoted path after exec .../bin/node", () => {
  const flake = [
    "installPhase = ''",
    '  cat > "$out/bin/picompanion-daemon" <<EOF',
    "  #!${pkgs.runtimeShell}",
    '  exec ${pkgs.nodejs_22}/bin/node "$out/lib/picompanion/packages/server/dist/scripts/supervisor-entrypoint.js" "\\$@"',
    "  EOF",
    "'';",
  ].join("\n");
  assert.equal(
    extractNixLauncherPath(flake),
    "$out/lib/picompanion/packages/server/dist/scripts/supervisor-entrypoint.js",
  );
});

test("extractNixLauncherPath returns null when no exec .../bin/node line is present", () => {
  assert.equal(extractNixLauncherPath("installPhase = '' echo hi '';"), null);
});

test("nixLauncherPathToRepoRelative strips the $out/lib/picompanion convention", () => {
  assert.equal(
    nixLauncherPathToRepoRelative("$out/lib/picompanion/packages/server/dist/x.js"),
    "packages/server/dist/x.js",
  );
});

test("nixLauncherPathToRepoRelative returns null outside the known prefix", () => {
  assert.equal(nixLauncherPathToRepoRelative("/usr/bin/node"), null);
});

// --- mapArtifactPathToSourceCandidates / artifactPathResolves --------------

test("mapArtifactPathToSourceCandidates strips dist/ and swaps .js for .ts", () => {
  assert.deepEqual(
    mapArtifactPathToSourceCandidates("packages/server/dist/scripts/supervisor-entrypoint.js"),
    [
      "packages/server/scripts/supervisor-entrypoint.js",
      "packages/server/scripts/supervisor-entrypoint.ts",
    ],
  );
});

test("mapArtifactPathToSourceCandidates returns [] when there is no dist/ segment", () => {
  assert.deepEqual(mapArtifactPathToSourceCandidates("packages/server/scripts/x.ts"), []);
});

test("artifactPathResolves is true when the literal (built) path exists", () => {
  const exists = (p) => p === "packages/server/dist/scripts/x.js";
  assert.equal(artifactPathResolves("packages/server/dist/scripts/x.js", exists), true);
});

test("artifactPathResolves is true when only the mapped .ts SOURCE exists (clean checkout)", () => {
  const exists = (p) => p === "packages/server/scripts/x.ts";
  assert.equal(artifactPathResolves("packages/server/dist/scripts/x.js", exists), true);
});

test("artifactPathResolves is false when neither the built path nor any source candidate exists", () => {
  assert.equal(artifactPathResolves("packages/server/dist/scripts/x.js", noPathsExist()), false);
});

// --- checkDockerEntrypoint / checkNixEntrypoint (synthetic fixtures) -------

test("checkDockerEntrypoint passes when the resolved path exists", () => {
  const dockerfile = [
    "FROM node:22",
    "WORKDIR /repo",
    'ENTRYPOINT ["node", "dist/scripts/x.js"]',
  ].join("\n");
  const result = checkDockerEntrypoint({
    dockerfileContent: dockerfile,
    repoPathExists: allPathsExist(),
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.violations, []);
});

test("checkDockerEntrypoint fails when neither the built path nor a source candidate exists", () => {
  const dockerfile = [
    "FROM node:22",
    "WORKDIR /repo",
    'ENTRYPOINT ["node", "dist/scripts/x.js"]',
  ].join("\n");
  const result = checkDockerEntrypoint({
    dockerfileContent: dockerfile,
    repoPathExists: noPathsExist(),
  });
  assert.equal(result.ok, false);
  assert.ok(result.violations.some((v) => v.includes("does not exist")));
});

test("checkDockerEntrypoint fails when no ENTRYPOINT/CMD names a path at all", () => {
  const result = checkDockerEntrypoint({
    dockerfileContent: "FROM node:22\nRUN echo hi",
    repoPathExists: allPathsExist(),
  });
  assert.equal(result.ok, false);
  assert.ok(result.violations.some((v) => v.includes("no ENTRYPOINT or CMD")));
});

test("checkNixEntrypoint passes when the resolved path exists", () => {
  const flake = [
    "installPhase = ''",
    '  exec ${pkgs.nodejs_22}/bin/node "$out/lib/picompanion/packages/server/dist/scripts/x.js" "\\$@"',
    "'';",
  ].join("\n");
  const result = checkNixEntrypoint({ flakeContent: flake, repoPathExists: allPathsExist() });
  assert.equal(result.ok, true);
});

test("checkNixEntrypoint fails when neither the built path nor a source candidate exists", () => {
  const flake = [
    "installPhase = ''",
    '  exec ${pkgs.nodejs_22}/bin/node "$out/lib/picompanion/packages/server/dist/scripts/x.js" "\\$@"',
    "'';",
  ].join("\n");
  const result = checkNixEntrypoint({ flakeContent: flake, repoPathExists: noPathsExist() });
  assert.equal(result.ok, false);
});

test("checkNixEntrypoint fails when no launcher line is found", () => {
  const result = checkNixEntrypoint({
    flakeContent: "installPhase = '' echo hi '';",
    repoPathExists: allPathsExist(),
  });
  assert.equal(result.ok, false);
  assert.ok(result.violations.some((v) => v.includes("no `exec")));
});

// --- Mutation proofs against the REAL committed files (P6-W20 reproduction) -

test("REAL FILES: checkDockerEntrypoint passes on the committed Dockerfile", () => {
  const result = checkDockerEntrypoint({
    dockerfileContent: realDockerfile(),
    repoPathExists: realRepoPathExists(),
  });
  assert.equal(result.ok, true, JSON.stringify(result.violations));
});

test("REAL FILES: checkNixEntrypoint passes on the committed flake.nix", () => {
  const result = checkNixEntrypoint({
    flakeContent: realFlake(),
    repoPathExists: realRepoPathExists(),
  });
  assert.equal(result.ok, true, JSON.stringify(result.violations));
});

test("MUTATION (P6-W20 repro): bogus Dockerfile ENTRYPOINT rewrite fails checkDockerEntrypoint", () => {
  const original = realDockerfile();
  const target = 'ENTRYPOINT ["node", "dist/scripts/supervisor-entrypoint.js"]';
  assert.ok(
    original.includes(target),
    "fixture assumption: real Dockerfile's exact ENTRYPOINT line",
  );
  const mutated = original.replace(
    target,
    'ENTRYPOINT ["node", "dist/scripts/THIS-FILE-DOES-NOT-EXIST.js"]',
  );
  const result = checkDockerEntrypoint({
    dockerfileContent: mutated,
    repoPathExists: realRepoPathExists(),
  });
  assert.equal(result.ok, false);
  assert.ok(result.violations.some((v) => v.includes("THIS-FILE-DOES-NOT-EXIST")));
});

test("MUTATION (P6-W20 repro): bogus Nix launcher rewrite fails checkNixEntrypoint", () => {
  const original = realFlake();
  const target = "packages/server/dist/scripts/supervisor-entrypoint.js";
  assert.ok(original.includes(target), "fixture assumption: real flake's exact launcher path");
  const mutated = original.replace(
    target,
    "packages/server/dist/scripts/THIS-FILE-DOES-NOT-EXIST.js",
  );
  const result = checkNixEntrypoint({
    flakeContent: mutated,
    repoPathExists: realRepoPathExists(),
  });
  assert.equal(result.ok, false);
  assert.ok(result.violations.some((v) => v.includes("THIS-FILE-DOES-NOT-EXIST")));
});

test("REGRESSION CONTROL: checkDockerEntrypoint (bogus path) still fails even granting every OTHER path exists", () => {
  // Guards against a check that accidentally treats "some path exists" as
  // sufficient instead of checking the SPECIFIC resolved entrypoint path.
  const dockerfile = [
    "FROM node:22",
    "WORKDIR /repo",
    'ENTRYPOINT ["node", "dist/scripts/THIS-FILE-DOES-NOT-EXIST.js"]',
  ].join("\n");
  const bogusCandidates = new Set([
    "dist/scripts/THIS-FILE-DOES-NOT-EXIST.js",
    "scripts/THIS-FILE-DOES-NOT-EXIST.js",
    "scripts/THIS-FILE-DOES-NOT-EXIST.ts",
  ]);
  const result = checkDockerEntrypoint({
    dockerfileContent: dockerfile,
    repoPathExists: (p) => !bogusCandidates.has(p),
  });
  assert.equal(result.ok, false);
});
