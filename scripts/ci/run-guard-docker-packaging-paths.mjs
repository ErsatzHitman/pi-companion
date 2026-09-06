#!/usr/bin/env node
// CLI entry point for the Docker/Nix packaging-paths guard (T43A3). Run
// from anywhere (it resolves the repository root via `git rev-parse
// --show-toplevel`, matching every other guard's run-*.mjs in this
// directory): `node scripts/ci/run-guard-docker-packaging-paths.mjs`.
//
// This does NOT run `docker build` or `nix build` — neither toolchain is
// assumed to be installed. It reads the two packaging files as plain text
// and statically checks them; see
// scripts/ci/guard-docker-packaging-paths.mjs for exactly what that does
// and does not prove, and packaging/docker/README.md +
// packaging/nix/README.md for the disclosed gap between this and a real
// build.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { checkDockerPackaging, checkNixPackaging } from "./guard-docker-packaging-paths.mjs";

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" });
}

function report(name, result) {
  if (result.ok) {
    console.log(`guard-docker-packaging-paths: OK (${name})`);
    return true;
  }
  console.error(`guard-docker-packaging-paths: FAILED (${name})`);
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
    console.error(`guard-docker-packaging-paths: FAILED — missing ${dockerfilePath}`);
    process.exitCode = 1;
    return;
  }
  if (!existsSync(flakePath)) {
    console.error(`guard-docker-packaging-paths: FAILED — missing ${flakePath}`);
    process.exitCode = 1;
    return;
  }

  const dockerfileContent = readFileSync(dockerfilePath, "utf8");
  const flakeContent = readFileSync(flakePath, "utf8");

  const dockerResult = checkDockerPackaging({
    dockerfileContent,
    // Dockerfile COPY sources resolve against the build context, which
    // packaging/docker/README.md documents (and this file's own header
    // comment states) must be the repository root.
    repoPathExists: (candidate) => existsSync(path.join(root, candidate)),
  });

  const nixResult = checkNixPackaging({
    flakeContent,
    // Nix relative paths resolve against the flake file's own directory
    // (packaging/nix/), not the repository root.
    repoPathExists: (candidate) => existsSync(path.join(root, "packaging", "nix", candidate)),
  });

  const dockerOk = report("packaging/docker/Dockerfile", dockerResult);
  const nixOk = report("packaging/nix/flake.nix", nixResult);

  if (!dockerOk || !nixOk) {
    process.exitCode = 1;
  }
}

main();
