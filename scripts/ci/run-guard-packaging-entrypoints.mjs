#!/usr/bin/env node
// CLI entry point for the packaging runtime-entrypoint-paths guard (T175).
// Run from anywhere (resolves the repository root via `git rev-parse
// --show-toplevel`, matching every other guard's run-*.mjs in this
// directory): `node scripts/ci/run-guard-packaging-entrypoints.mjs`.
//
// This does NOT run `docker build` or `nix build` — neither toolchain is
// assumed to be installed, and none is invoked here. It reads the two
// packaging files as plain text and statically checks their declared
// runtime entrypoint paths; see scripts/ci/guard-packaging-entrypoints.mjs
// for exactly what that does and does not prove (in particular, the
// built-dist-or-matching-source resolution rule and its disclosed gaps).
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { checkDockerEntrypoint, checkNixEntrypoint } from "./guard-packaging-entrypoints.mjs";

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" });
}

function report(name, result) {
  if (result.ok) {
    console.log(`guard-packaging-entrypoints: OK (${name})`);
    return true;
  }
  console.error(`guard-packaging-entrypoints: FAILED (${name})`);
  for (const violation of result.violations) {
    console.error(`  - ${violation}`);
  }
  return false;
}

function main() {
  const root = git(["rev-parse", "--show-toplevel"]).trim();

  const dockerfilePath = path.join(root, "packaging", "docker", "Dockerfile");
  const flakePath = path.join(root, "packaging", "nix", "flake.nix");

  if (!existsSync(dockerfilePath)) {
    console.error(`guard-packaging-entrypoints: FAILED — missing ${dockerfilePath}`);
    process.exitCode = 1;
    return;
  }
  if (!existsSync(flakePath)) {
    console.error(`guard-packaging-entrypoints: FAILED — missing ${flakePath}`);
    process.exitCode = 1;
    return;
  }

  const dockerfileContent = readFileSync(dockerfilePath, "utf8");
  const flakeContent = readFileSync(flakePath, "utf8");

  // Both packaging files' entrypoint/launcher paths get mapped back to a
  // repository-relative path by guard-packaging-entrypoints.mjs itself
  // (stripping the Dockerfile's `/repo` container-root convention and the
  // flake's `$out/lib/picompanion` convention respectively) — so both
  // checks here share the same repo-root-relative `repoPathExists`.
  const repoPathExists = (candidate) => existsSync(path.join(root, candidate));

  const dockerResult = checkDockerEntrypoint({ dockerfileContent, repoPathExists });
  const nixResult = checkNixEntrypoint({ flakeContent, repoPathExists });

  const dockerOk = report("packaging/docker/Dockerfile", dockerResult);
  const nixOk = report("packaging/nix/flake.nix", nixResult);

  if (!dockerOk || !nixOk) {
    process.exitCode = 1;
  }
}

main();
