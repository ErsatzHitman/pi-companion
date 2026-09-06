// T43A3: unit tests for guard-docker-packaging-paths.mjs's pure functions.
// No real Docker/Nix build here (neither toolchain is available) — see
// this task's report for the RED/GREEN proof run against the real
// packaging/docker/Dockerfile and packaging/nix/flake.nix content.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import {
  checkDockerPackaging,
  checkNixPackaging,
  extractDockerCopySources,
  extractDockerRunCommands,
  extractNixPhaseCommands,
  extractNixSrcPath,
  findBuildOrderViolations,
  findLegacyReferences,
  hasBalancedDelimiters,
  REQUIRED_WORKSPACE_BUILD_STEPS,
  stripDockerfileComments,
  stripNixComments,
  WORKSPACE_BUILD_DEPENDENCIES,
} from "./guard-docker-packaging-paths.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

function realDockerfile() {
  return readFileSync(path.join(REPO_ROOT, "packaging", "docker", "Dockerfile"), "utf8");
}

function realFlake() {
  return readFileSync(path.join(REPO_ROOT, "packaging", "nix", "flake.nix"), "utf8");
}

function allPathsExist() {
  return () => true;
}

function noPathsExist() {
  return () => false;
}

// --- extractDockerCopySources ---------------------------------------------

test("extractDockerCopySources returns the single-arg COPY source, excluding the destination", () => {
  const dockerfile = ["FROM node:22", "COPY . .", "RUN echo hi"].join("\n");
  assert.deepEqual(extractDockerCopySources(dockerfile), ["."]);
});

test("extractDockerCopySources excludes COPY --from=<stage> lines (container paths, not build-context paths)", () => {
  const dockerfile = [
    "FROM node:22 AS builder",
    "COPY . .",
    "FROM node:22 AS runtime",
    "COPY --from=builder /repo /repo",
  ].join("\n");
  assert.deepEqual(extractDockerCopySources(dockerfile), ["."]);
});

test("extractDockerCopySources handles multiple source args (last is the destination)", () => {
  const dockerfile = "COPY package.json package-lock.json /app/";
  assert.deepEqual(extractDockerCopySources(dockerfile), ["package.json", "package-lock.json"]);
});

// --- extractDockerRunCommands ----------------------------------------------

test("extractDockerRunCommands joins line-continued RUN instructions", () => {
  const dockerfile = [
    "RUN npm run build --workspace=@picompanion/protocol \\",
    "    && echo done",
  ].join("\n");
  const commands = extractDockerRunCommands(dockerfile);
  assert.match(commands, /@picompanion\/protocol/);
  assert.match(commands, /echo done/);
});

test("extractDockerRunCommands ignores non-RUN instructions", () => {
  const dockerfile = ["COPY . .", "RUN echo only-this"].join("\n");
  assert.doesNotMatch(extractDockerRunCommands(dockerfile), /COPY/);
});

// --- findLegacyReferences ----------------------------------------------

test("findLegacyReferences flags a legacy packages/app path", () => {
  assert.deepEqual(findLegacyReferences("COPY packages/app/dist /web-ui"), ["packages/app"]);
});

test("findLegacyReferences flags the legacy @getpaseo/ scope", () => {
  assert.deepEqual(findLegacyReferences("RUN npm run build --workspace=@getpaseo/server"), [
    "@getpaseo/",
  ]);
});

test("findLegacyReferences returns empty for clean content", () => {
  assert.deepEqual(findLegacyReferences("RUN npm run build --workspace=@picompanion/server"), []);
});

// --- stripDockerfileComments / stripNixComments ----------------------------

test("stripDockerfileComments removes # comment lines but keeps real instructions", () => {
  const dockerfile = ["# not derived from packages/app", "COPY . .", "  # another comment"].join(
    "\n",
  );
  const stripped = stripDockerfileComments(dockerfile);
  assert.doesNotMatch(stripped, /packages\/app/);
  assert.match(stripped, /COPY \. \./);
});

test("checkDockerPackaging does NOT flag a legacy path mentioned only in a comment (exemption is real, not hollow)", () => {
  const dockerfile = [
    "# This file is not a port of any Paseo packages/app file.",
    "FROM node:22",
    "COPY . .",
    ...REQUIRED_WORKSPACE_BUILD_STEPS.map((w) => `RUN npm run build --workspace=${w}`),
    "RUN npm run build:daemon-web-ui",
  ].join("\n");
  const result = checkDockerPackaging({
    dockerfileContent: dockerfile,
    repoPathExists: allPathsExist(),
  });
  assert.deepEqual(result.violations, []);
});

test("checkDockerPackaging STILL flags a legacy path outside a comment, proving the strip is not a blanket allow", () => {
  const dockerfile = [
    "# This file is not a port of any Paseo packages/app file.",
    "FROM node:22",
    "COPY packages/app/dist /legacy",
    ...REQUIRED_WORKSPACE_BUILD_STEPS.map((w) => `RUN npm run build --workspace=${w}`),
    "RUN npm run build:daemon-web-ui",
  ].join("\n");
  const result = checkDockerPackaging({
    dockerfileContent: dockerfile,
    repoPathExists: allPathsExist(),
  });
  assert.equal(result.ok, false);
  assert.ok(result.violations.some((v) => v.includes("legacy")));
});

test("stripNixComments removes # line comments and /* */ block comments but keeps real code", () => {
  const flake = [
    "# not derived from packages/app",
    "{ src = ../..; /* also not packages/app here */ buildPhase = ''echo hi''; }",
  ].join("\n");
  const stripped = stripNixComments(flake);
  assert.doesNotMatch(stripped, /packages\/app/);
  assert.match(stripped, /src = \.\.\/\.\.;/);
  assert.match(stripped, /echo hi/);
});

test("checkNixPackaging does NOT flag a legacy path mentioned only in a comment (exemption is real, not hollow)", () => {
  const flake = `# Not a port of Paseo's packages/app tree.
{ src = ../..; buildPhase = ''${realNixWorkspaceCommands()}
npm run build:daemon-web-ui''; }`;
  const result = checkNixPackaging({ flakeContent: flake, repoPathExists: allPathsExist() });
  assert.deepEqual(result.violations, []);
});

// --- checkDockerPackaging ----------------------------------------------

test("checkDockerPackaging passes a Dockerfile with every required workspace, the bundle step, and no legacy reference", () => {
  const dockerfile = [
    "FROM node:22 AS builder",
    "COPY . .",
    "RUN npm run build --workspace=@picompanion/protocol \\",
    "    && npm run build --workspace=@picompanion/relay \\",
    "    && npm run build --workspace=@picompanion/highlight \\",
    "    && npm run build --workspace=@picompanion/client \\",
    "    && npm run build --workspace=@picompanion/design-tokens \\",
    "    && npm run build --workspace=@picompanion/frontend-core \\",
    "    && npm run build --workspace=@picompanion/web \\",
    "    && npm run build:clean --workspace=@picompanion/server \\",
    "    && npm run build:daemon-web-ui -- --skip-build",
  ].join("\n");
  const result = checkDockerPackaging({
    dockerfileContent: dockerfile,
    repoPathExists: allPathsExist(),
  });
  assert.deepEqual(result.violations, []);
  assert.equal(result.ok, true);
});

test("checkDockerPackaging fails when a COPY source does not exist in the repository", () => {
  const dockerfile = [
    "FROM node:22",
    "COPY nonexistent-path .",
    ...REQUIRED_WORKSPACE_BUILD_STEPS.map((w) => `RUN npm run build --workspace=${w}`),
    "RUN npm run build:daemon-web-ui",
  ].join("\n");
  const result = checkDockerPackaging({
    dockerfileContent: dockerfile,
    repoPathExists: noPathsExist(),
  });
  assert.equal(result.ok, false);
  assert.ok(result.violations.some((v) => v.includes("nonexistent-path")));
});

test("checkDockerPackaging fails when a required workspace build step is missing", () => {
  const dockerfile = [
    "FROM node:22",
    "COPY . .",
    // Missing @picompanion/web entirely.
    "RUN npm run build --workspace=@picompanion/protocol \\",
    "    && npm run build --workspace=@picompanion/relay \\",
    "    && npm run build --workspace=@picompanion/highlight \\",
    "    && npm run build --workspace=@picompanion/client \\",
    "    && npm run build --workspace=@picompanion/design-tokens \\",
    "    && npm run build --workspace=@picompanion/frontend-core \\",
    "    && npm run build:clean --workspace=@picompanion/server \\",
    "    && npm run build:daemon-web-ui",
  ].join("\n");
  const result = checkDockerPackaging({
    dockerfileContent: dockerfile,
    repoPathExists: allPathsExist(),
  });
  assert.equal(result.ok, false);
  assert.ok(result.violations.some((v) => v.includes('"@picompanion/web"')));
});

test("checkDockerPackaging fails when the build:daemon-web-ui step is missing (T43A1's invariant dropped)", () => {
  const dockerfile = [
    "FROM node:22",
    "COPY . .",
    ...REQUIRED_WORKSPACE_BUILD_STEPS.map((w) => `RUN npm run build --workspace=${w}`),
  ].join("\n");
  const result = checkDockerPackaging({
    dockerfileContent: dockerfile,
    repoPathExists: allPathsExist(),
  });
  assert.equal(result.ok, false);
  assert.ok(result.violations.some((v) => v.includes("build:daemon-web-ui")));
});

test("checkDockerPackaging fails when a legacy Paseo path is referenced", () => {
  const dockerfile = [
    "FROM node:22",
    "COPY packages/app/dist /legacy",
    ...REQUIRED_WORKSPACE_BUILD_STEPS.map((w) => `RUN npm run build --workspace=${w}`),
    "RUN npm run build:daemon-web-ui",
  ].join("\n");
  const result = checkDockerPackaging({
    dockerfileContent: dockerfile,
    repoPathExists: allPathsExist(),
  });
  assert.equal(result.ok, false);
  assert.ok(result.violations.some((v) => v.includes("legacy")));
});

test("checkDockerPackaging passes against the REAL packaging/docker/Dockerfile in this repository", () => {
  const result = checkDockerPackaging({
    dockerfileContent: realDockerfile(),
    repoPathExists: allPathsExist(),
  });
  assert.deepEqual(result.violations, []);
});

test("mutation: deleting the real Dockerfile's build:daemon-web-ui step makes checkDockerPackaging fail", () => {
  const mutated = realDockerfile().replace(/&& npm run build:daemon-web-ui[^\n]*/, "");
  const result = checkDockerPackaging({
    dockerfileContent: mutated,
    repoPathExists: allPathsExist(),
  });
  assert.equal(result.ok, false);
  assert.ok(result.violations.some((v) => v.includes("build:daemon-web-ui")));
});

// --- hasBalancedDelimiters ----------------------------------------------

test("hasBalancedDelimiters accepts balanced content", () => {
  assert.equal(hasBalancedDelimiters("{ a = [1, 2, (3)]; }"), true);
});

test("hasBalancedDelimiters rejects an unclosed brace", () => {
  assert.equal(hasBalancedDelimiters("{ a = 1;"), false);
});

test("hasBalancedDelimiters rejects mismatched delimiters", () => {
  assert.equal(hasBalancedDelimiters("{ a = (1]; }"), false);
});

// --- extractNixSrcPath / extractNixPhaseCommands ----------------------------------------------

test("extractNixSrcPath extracts a `src = ...;` attribute", () => {
  assert.equal(extractNixSrcPath("buildNpmPackage { src = ../..; version = 1; }"), "../..");
});

test("extractNixSrcPath returns null when no src attribute is present", () => {
  assert.equal(extractNixSrcPath("buildNpmPackage { version = 1; }"), null);
});

test("extractNixPhaseCommands concatenates every ''...'' block", () => {
  const flake = "buildPhase = ''\n  npm run build\n'';\ninstallPhase = ''\n  echo done\n'';";
  const commands = extractNixPhaseCommands(flake);
  assert.match(commands, /npm run build/);
  assert.match(commands, /echo done/);
});

// --- checkNixPackaging ----------------------------------------------

function realNixWorkspaceCommands() {
  return REQUIRED_WORKSPACE_BUILD_STEPS.map((w) => `npm run build --workspace=${w}`).join("\n");
}

test("checkNixPackaging passes a well-formed flake with every required workspace, the bundle step, and no legacy reference", () => {
  const flake = `{ outputs = { }: { packages.default = buildNpmPackage {
    src = ../..;
    buildPhase = ''
      ${realNixWorkspaceCommands()}
      npm run build:daemon-web-ui -- --skip-build
    '';
  }; }; }`;
  const result = checkNixPackaging({ flakeContent: flake, repoPathExists: allPathsExist() });
  assert.deepEqual(result.violations, []);
  assert.equal(result.ok, true);
});

test("checkNixPackaging fails on unbalanced delimiters", () => {
  const flake = `{ outputs = { }: { packages.default = buildNpmPackage { src = ../..;`;
  const result = checkNixPackaging({ flakeContent: flake, repoPathExists: allPathsExist() });
  assert.equal(result.ok, false);
  assert.ok(result.violations.some((v) => v.includes("unbalanced")));
});

test("checkNixPackaging fails when src path does not exist", () => {
  const flake = `{ src = ../../nonexistent; buildPhase = ''${realNixWorkspaceCommands()}\nnpm run build:daemon-web-ui''; }`;
  const result = checkNixPackaging({ flakeContent: flake, repoPathExists: noPathsExist() });
  assert.equal(result.ok, false);
  assert.ok(result.violations.some((v) => v.includes("does not exist")));
});

test("checkNixPackaging fails when a required workspace is missing from the build phase", () => {
  const flake = `{ src = ../..; buildPhase = ''npm run build --workspace=@picompanion/protocol\nnpm run build:daemon-web-ui''; }`;
  const result = checkNixPackaging({ flakeContent: flake, repoPathExists: allPathsExist() });
  assert.equal(result.ok, false);
  assert.ok(result.violations.some((v) => v.includes('"@picompanion/web"')));
});

test("checkNixPackaging fails when the build:daemon-web-ui step is missing", () => {
  const flake = `{ src = ../..; buildPhase = ''${realNixWorkspaceCommands()}''; }`;
  const result = checkNixPackaging({ flakeContent: flake, repoPathExists: allPathsExist() });
  assert.equal(result.ok, false);
  assert.ok(result.violations.some((v) => v.includes("build:daemon-web-ui")));
});

test("checkNixPackaging fails when a legacy Paseo path is referenced", () => {
  const flake = `{ src = ../..; buildPhase = ''${realNixWorkspaceCommands()}\nnpm run build:daemon-web-ui\ncp -r packages/app $out''; }`;
  const result = checkNixPackaging({ flakeContent: flake, repoPathExists: allPathsExist() });
  assert.equal(result.ok, false);
  assert.ok(result.violations.some((v) => v.includes("legacy")));
});

test("checkNixPackaging passes against the REAL packaging/nix/flake.nix in this repository", () => {
  const result = checkNixPackaging({
    flakeContent: realFlake(),
    repoPathExists: allPathsExist(),
  });
  assert.deepEqual(result.violations, []);
});

test("mutation: deleting the real flake's build:daemon-web-ui step makes checkNixPackaging fail", () => {
  const mutated = realFlake().replace(/npm run build:daemon-web-ui[^\n]*/, "");
  const result = checkNixPackaging({ flakeContent: mutated, repoPathExists: allPathsExist() });
  assert.equal(result.ok, false);
  assert.ok(result.violations.some((v) => v.includes("build:daemon-web-ui")));
});

// --- findBuildOrderViolations (T174) ----------------------------------------

test("findBuildOrderViolations is clean for correctly-ordered text: build:clean before build:daemon-web-ui, every dependency before its dependent", () => {
  const commandText = [
    "npm run build --workspace=@picompanion/protocol",
    "npm run build --workspace=@picompanion/relay",
    "npm run build --workspace=@picompanion/highlight",
    "npm run build --workspace=@picompanion/client",
    "npm run build --workspace=@picompanion/design-tokens",
    "npm run build --workspace=@picompanion/frontend-core",
    "npm run build --workspace=@picompanion/web",
    "npm run build:clean --workspace=@picompanion/server",
    "npm run build:daemon-web-ui -- --skip-build",
  ].join("\n");
  assert.deepEqual(findBuildOrderViolations(commandText), []);
});

test("findBuildOrderViolations flags build:clean running AFTER build:daemon-web-ui (the T43A1 dist-wipe hazard)", () => {
  const commandText = [
    "npm run build:daemon-web-ui -- --skip-build",
    "npm run build:clean --workspace=@picompanion/server",
  ].join("\n");
  const violations = findBuildOrderViolations(commandText);
  assert.ok(violations.some((v) => v.includes("AFTER") && v.includes("build:daemon-web-ui")));
});

test("findBuildOrderViolations does not duplicate a 'missing' violation when build:clean or build:daemon-web-ui is entirely absent", () => {
  assert.deepEqual(findBuildOrderViolations("npm run build --workspace=@picompanion/protocol"), []);
  assert.deepEqual(
    findBuildOrderViolations("npm run build:clean --workspace=@picompanion/server"),
    [],
  );
});

test("findBuildOrderViolations flags a workspace built before its own dependency", () => {
  const commandText = [
    "npm run build --workspace=@picompanion/client",
    "npm run build --workspace=@picompanion/protocol",
    "npm run build --workspace=@picompanion/relay",
  ].join("\n");
  const violations = findBuildOrderViolations(commandText);
  assert.ok(
    violations.some(
      (v) => v.includes("@picompanion/client") && v.includes("@picompanion/protocol"),
    ),
  );
  assert.ok(
    violations.some((v) => v.includes("@picompanion/client") && v.includes("@picompanion/relay")),
  );
});

test("findBuildOrderViolations does not flag a dependency-ordering pair when either side is entirely absent", () => {
  // @picompanion/web depends on @picompanion/design-tokens per
  // WORKSPACE_BUILD_DEPENDENCIES, but design-tokens is never mentioned
  // here — that omission is the presence checks' job, not this function's.
  assert.deepEqual(findBuildOrderViolations("npm run build --workspace=@picompanion/web"), []);
});

test("findBuildOrderViolations does NOT flag reordering two workspaces with no dependency relationship between them (no false positive)", () => {
  // @picompanion/relay and @picompanion/highlight both have empty
  // @picompanion/* `dependencies` fields — neither is in
  // WORKSPACE_BUILD_DEPENDENCIES, so swapping them is not a violation.
  assert.ok(!("@picompanion/relay" in WORKSPACE_BUILD_DEPENDENCIES));
  assert.ok(!("@picompanion/highlight" in WORKSPACE_BUILD_DEPENDENCIES));
  const commandText = [
    "npm run build --workspace=@picompanion/highlight",
    "npm run build --workspace=@picompanion/relay",
  ].join("\n");
  assert.deepEqual(findBuildOrderViolations(commandText), []);
});

test("mutation: swapping build:clean and build:daemon-web-ui in the REAL Dockerfile makes checkDockerPackaging fail", () => {
  const original = realDockerfile();
  const oldOrder = [
    "    && npm run build:clean --workspace=@picompanion/server \\",
    "    && npm run build:daemon-web-ui -- --skip-build",
  ].join("\n");
  const newOrder = [
    "    && npm run build:daemon-web-ui -- --skip-build \\",
    "    && npm run build:clean --workspace=@picompanion/server",
  ].join("\n");
  assert.ok(original.includes(oldOrder), "fixture assumption: real Dockerfile's exact line pair");
  const mutated = original.replace(oldOrder, newOrder);
  const result = checkDockerPackaging({
    dockerfileContent: mutated,
    repoPathExists: allPathsExist(),
  });
  assert.equal(result.ok, false);
  assert.ok(
    result.violations.some((v) => v.includes("AFTER") && v.includes("build:daemon-web-ui")),
  );
});

test("mutation: swapping build:clean and build:daemon-web-ui in the REAL flake.nix makes checkNixPackaging fail", () => {
  const original = realFlake();
  const oldOrder = [
    "            npm run build:clean --workspace=@picompanion/server",
    "            npm run build:daemon-web-ui -- --skip-build",
  ].join("\n");
  const newOrder = [
    "            npm run build:daemon-web-ui -- --skip-build",
    "            npm run build:clean --workspace=@picompanion/server",
  ].join("\n");
  assert.ok(original.includes(oldOrder), "fixture assumption: real flake.nix's exact line pair");
  const mutated = original.replace(oldOrder, newOrder);
  const result = checkNixPackaging({ flakeContent: mutated, repoPathExists: allPathsExist() });
  assert.equal(result.ok, false);
  assert.ok(
    result.violations.some((v) => v.includes("AFTER") && v.includes("build:daemon-web-ui")),
  );
});

test("mutation: building @picompanion/client before @picompanion/protocol in the REAL Dockerfile makes checkDockerPackaging fail", () => {
  const original = realDockerfile();
  const oldOrder = [
    "RUN npm run build --workspace=@picompanion/protocol \\",
    "    && npm run build --workspace=@picompanion/relay \\",
    "    && npm run build --workspace=@picompanion/highlight \\",
    "    && npm run build --workspace=@picompanion/client \\",
  ].join("\n");
  const newOrder = [
    "RUN npm run build --workspace=@picompanion/client \\",
    "    && npm run build --workspace=@picompanion/relay \\",
    "    && npm run build --workspace=@picompanion/highlight \\",
    "    && npm run build --workspace=@picompanion/protocol \\",
  ].join("\n");
  assert.ok(original.includes(oldOrder), "fixture assumption: real Dockerfile's exact block");
  const mutated = original.replace(oldOrder, newOrder);
  const result = checkDockerPackaging({
    dockerfileContent: mutated,
    repoPathExists: allPathsExist(),
  });
  assert.equal(result.ok, false);
  assert.ok(
    result.violations.some(
      (v) => v.includes("@picompanion/client") && v.includes("@picompanion/protocol"),
    ),
  );
});

// --- comment-awareness of the build-step checks (T178) ----------------------
//
// T174's ordering check and the presence checks beside it read
// `extractDockerRunCommands`'/`extractNixPhaseCommands`'s output, and
// neither extractor stripped `#` comments before T178: a whole-line
// comment inside a Dockerfile RUN continuation got welded into the RUN
// text by the continuation join, and a Nix phase's `#` shell comments
// were never stripped at all. Reproduced at the P6-W21 gate and again at
// the review: commenting out `build:clean --workspace=@picompanion/
// server` (continuation left intact) left `run-guard-docker-packaging-
// paths.mjs` at exit 0 in BOTH packaging files, because the presence
// check found `@picompanion/server` inside the comment text and the
// ordering check read the comment's position as the step's.

test("extractDockerRunCommands strips a #-commented line inside a RUN continuation instead of welding it into the command text", () => {
  const dockerfile = [
    "RUN npm run build --workspace=@picompanion/web \\",
    "    # && npm run build:clean --workspace=@picompanion/server \\",
    "    && npm run build:daemon-web-ui -- --skip-build",
  ].join("\n");
  const commands = extractDockerRunCommands(dockerfile);
  assert.doesNotMatch(commands, /@picompanion\/server/);
  assert.match(commands, /build:daemon-web-ui/);
});

test("extractDockerRunCommands does not strip a real instruction that merely follows a removed comment line", () => {
  const dockerfile = [
    "RUN npm run build --workspace=@picompanion/web \\",
    "    # a comment with no trailing backslash",
    "RUN npm run build --workspace=@picompanion/server",
  ].join("\n");
  const commands = extractDockerRunCommands(dockerfile);
  assert.match(commands, /@picompanion\/web/);
  assert.match(commands, /@picompanion\/server/);
});

test("extractNixPhaseCommands strips a #-commented line instead of treating it as a real step", () => {
  const flake = [
    "buildPhase = ''",
    "  npm run build --workspace=@picompanion/web",
    "  # npm run build:clean --workspace=@picompanion/server",
    "  npm run build:daemon-web-ui -- --skip-build",
    "'';",
  ].join("\n");
  const commands = extractNixPhaseCommands(flake);
  assert.doesNotMatch(commands, /@picompanion\/server/);
  assert.match(commands, /build:daemon-web-ui/);
});

test("mutation: commenting out build:clean in the REAL Dockerfile, continuation left intact, makes checkDockerPackaging fail", () => {
  const original = realDockerfile();
  const oldLine = "    && npm run build:clean --workspace=@picompanion/server \\";
  const newLine = "    # && npm run build:clean --workspace=@picompanion/server \\";
  assert.ok(original.includes(oldLine), "fixture assumption: real Dockerfile's exact line");
  const mutated = original.replace(oldLine, newLine);
  const result = checkDockerPackaging({
    dockerfileContent: mutated,
    repoPathExists: allPathsExist(),
  });
  assert.equal(result.ok, false);
  assert.ok(result.violations.some((v) => v.includes('workspace "@picompanion/server"')));
});

// --- the strip must not eat a legal `#` (P6-W22 gate) -----------------------
//
// T178's Nix half used `stripNixComments`, whose pattern is inline
// (`#.*$`). Inside a Nix `''…''` indented string a `#` is literal text at
// both the Nix and the shell level, so that erased the rest of any legal
// command containing one. Measured on the real flake at the gate:
// rewriting the highlight build step to `echo "step 3 # of 8" && npm run
// build --workspace=@picompanion/highlight` took the guard to EXIT=1 with
// `no build phase command builds workspace "@picompanion/highlight"` — a
// build step the file genuinely runs, erased. The pre-T178 guard passed on
// that same flake, so T178's own fix introduced it. These two tests pin
// both halves: the legal `#` survives, and the commented-out step still
// disappears.

test("extractNixPhaseCommands keeps a legal inline # inside a phase command", () => {
  const flake = [
    "buildPhase = ''",
    '  echo "step 3 # of 8" && npm run build --workspace=@picompanion/highlight',
    "'';",
  ].join("\n");
  const commands = extractNixPhaseCommands(flake);
  assert.match(commands, /@picompanion\/highlight/);
});

test("mutation: a legal inline # in the REAL flake.nix does not erase its build step", () => {
  const original = realFlake();
  const oldLine = "            npm run build --workspace=@picompanion/highlight";
  const newLine =
    '            echo "step 3 # of 8" && npm run build --workspace=@picompanion/highlight';
  assert.ok(original.includes(oldLine), "fixture assumption: real flake.nix's exact line");
  const mutated = original.replace(oldLine, newLine);
  const result = checkNixPackaging({ flakeContent: mutated, repoPathExists: allPathsExist() });
  assert.equal(result.ok, true, result.violations.join("; "));
});
test("mutation: commenting out build:clean in the REAL flake.nix makes checkNixPackaging fail", () => {
  const original = realFlake();
  const oldLine = "            npm run build:clean --workspace=@picompanion/server";
  const newLine = "            # npm run build:clean --workspace=@picompanion/server";
  assert.ok(original.includes(oldLine), "fixture assumption: real flake.nix's exact line");
  const mutated = original.replace(oldLine, newLine);
  const result = checkNixPackaging({ flakeContent: mutated, repoPathExists: allPathsExist() });
  assert.equal(result.ok, false);
  assert.ok(result.violations.some((v) => v.includes('workspace "@picompanion/server"')));
});
