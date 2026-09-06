// T175: CI guard — do the packaging artifacts' RUNTIME ENTRYPOINT paths
// resolve to something that actually exists?
//
// `guard-docker-packaging-paths.mjs`'s header claims "Every filesystem path
// each packaging file's build steps reference ... resolves to something
// that actually exists" but its `extractDockerCopySources` extracts only
// `COPY` sources. `ENTRYPOINT`, `CMD`, `WORKDIR`, and the Nix
// `installPhase` launcher path are never extracted or checked anywhere.
// Measured at the P6-W20 gate: rewriting the Dockerfile's `ENTRYPOINT` to
// `["node", "dist/scripts/THIS-FILE-DOES-NOT-EXIST.js"]` and the flake's
// launcher to a matching bogus path leaves that guard OK on both, exit 0.
//
// This file is a separate, new guard rather than an addition to
// guard-docker-packaging-paths.mjs — T178 (same wave) owns that file's
// comment-handling and build-step checks, and this task was scoped to a
// new file to stay disjoint from it. If a future consolidation wants to
// fold this into that guard, that is a deliberate choice for whoever owns
// it next, not an accident of this task avoiding a merge conflict.
//
// --- The resolution rule (the hard part) ------------------------------
//
// An `ENTRYPOINT`/`CMD` path is relative to the image's `WORKDIR`, not the
// repository root, and the Nix launcher's path is relative to `$out`, not
// the repository root either. Both packaging files establish a fixed
// mapping back to the repository root as part of their own build recipe
// (not a generic Docker/Nix semantic — specific to how THESE two files lay
// out their build context):
//   - Dockerfile: `WORKDIR /repo` + `COPY . .` (builder stage) and
//     `COPY --from=builder ... /repo /repo` (runtime stage) mean the
//     in-container path `/repo` IS the repository root.
//   - flake.nix: `cp -r . "$out/lib/picompanion/"` in `installPhase` means
//     `$out/lib/picompanion` IS the repository root as it stood mid-build.
// `CONTAINER_REPO_ROOT` and `NIX_OUT_REPO_ROOT_PREFIX` below encode those
// two mappings; if either packaging file ever changes its own convention,
// these two constants (and the header comments above, which is where this
// guard's assumption is written down for a human to catch) need updating
// together.
//
// The resolved repository-relative path this guard ends up with —
// `packages/server/dist/scripts/supervisor-entrypoint.js` for both files
// today — names a BUILD OUTPUT under `dist/`, gitignored and therefore
// usually absent in a clean checkout (this guard's own CI job never builds
// anything before running). A guard that requires that exact file to exist
// on disk would pass only on a tree someone happened to build locally and
// fail on every fresh checkout — see this task's brief, "a guard that
// passes only on a freshly-built tree and fails in a clean checkout is a
// guard that gets deleted".
//
// DECISION: this guard treats a resolved path as existing when EITHER
//   (a) the literal resolved path exists on disk (a real, already-built
//       tree — meaningful when it happens, but not required), OR
//   (b) a SOURCE file that this repository's own TypeScript build
//       convention would compile into that path exists — computed by
//       stripping the `dist/` path segment and swapping a trailing `.js`
//       extension for `.ts` (`mapArtifactPathToSourceCandidates` below).
// This is deliberately sounder than asserting only against the filesystem
// (per this task's brief) because it is meaningful on the REAL committed
// files regardless of build state: on a clean checkout, (a) is false and
// (b) is what proves the entrypoint is real; on a tree someone has built
// (true of this repository's working tree as of this task, since
// `packages/server/dist` already exists locally), (a) is also true. A
// bogus renamed entrypoint fails BOTH — neither a same-named source file
// nor a same-named already-built dist file exists — which is exactly the
// P6-W20 reproduction this guard closes.
//
// DISCLOSED GAP: this does not run `tsc` and cannot prove the source file
// would actually COMPILE to that exact dist path (a `rootDir`/`outDir`
// misconfiguration could break that mapping without this guard noticing),
// and a STALE `dist/` file left over from a previous build of a
// since-renamed source would make (a) pass when the current source no
// longer supports it. Both are real, disclosed limits of a guard that
// cannot run a real build — see this file's own header for the constraint
// (no `docker build`/`nix build`/`npm install` in this environment).
//
// Pure, dependency-free check functions only, matching every other guard
// in this directory — `run-guard-packaging-entrypoints.mjs` is the CLI
// entry point that reads the real files and injects a real
// `existsSync`-backed `repoPathExists`.

/** This Dockerfile's own convention (see header comment above) — NOT a
 * generic Docker semantic. */
const CONTAINER_REPO_ROOT = "/repo";

/** This flake's own convention (see header comment above). */
const NIX_OUT_REPO_ROOT_PREFIX = "$out/lib/picompanion/";

const DOCKER_INTERPRETERS = new Set(["node", "sh", "bash", "python", "python3", "dumb-init"]);

/**
 * Splits an ENTRYPOINT/CMD instruction's argument text into tokens,
 * handling both JSON-array (`["node", "x.js"]`) and shell
 * (`node x.js`) forms. Shell-form quoting is handled only for simple
 * single/double-quoted tokens — sufficient for this guard's one use,
 * matching `guard-docker-packaging-paths.mjs`'s own crude-but-sufficient
 * parsing style for constructs this simple.
 *
 * @param {string} rest
 * @returns {string[]}
 */
export function parseDockerInstructionTokens(rest) {
  const trimmed = rest.trim();
  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch {
      // Not valid JSON — fall through to shell-form parsing below.
    }
  }
  const tokens = trimmed.match(/(?:"[^"]*"|'[^']*'|\S+)/g) ?? [];
  return tokens.map((t) => t.replace(/^['"]|['"]$/g, ""));
}

/**
 * Picks the executable's path out of an ENTRYPOINT/CMD's tokens. When the
 * first token is a known interpreter (`node`, `sh`, ...), the path is the
 * NEXT token (`["node", "dist/scripts/x.js"]` -> `dist/scripts/x.js`).
 * Otherwise, the first token is treated as the path only if it looks like
 * one (contains `/` or ends in a script extension) — `["npm", "start"]`
 * has no filesystem path to check and correctly yields `null`.
 *
 * @param {string[]} tokens
 * @returns {string | null}
 */
export function pickExecutablePath(tokens) {
  if (tokens.length === 0) return null;
  if (DOCKER_INTERPRETERS.has(tokens[0]) && tokens.length > 1) {
    return tokens[1];
  }
  if (/\/|\.(js|mjs|cjs|ts|py|sh)$/.test(tokens[0])) {
    return tokens[0];
  }
  return null;
}

/**
 * Normalizes a POSIX-style path (resolves `.`/`..` segments), preserving
 * whether it is absolute.
 *
 * @param {string} p
 * @returns {string}
 */
function normalizePosix(p) {
  const isAbsolute = p.startsWith("/");
  const stack = [];
  for (const part of p.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      stack.pop();
      continue;
    }
    stack.push(part);
  }
  return (isAbsolute ? "/" : "") + stack.join("/");
}

/**
 * Resolves a possibly-relative Dockerfile path against a WORKDIR (POSIX
 * join semantics — matching how Docker itself resolves ENTRYPOINT/CMD/
 * WORKDIR paths, which are always container-internal POSIX paths
 * regardless of host OS).
 *
 * @param {string} p
 * @param {string | null} workdir
 * @returns {string}
 */
export function resolveDockerPath(p, workdir) {
  if (p.startsWith("/")) return normalizePosix(p);
  const base = workdir ?? "/";
  return normalizePosix(`${base.replace(/\/+$/, "")}/${p}`);
}

/**
 * Extracts every ENTRYPOINT/CMD instruction's resolved executable path
 * from a Dockerfile, tracking WORKDIR per build stage. A stage started
 * with `FROM <name> AS <newStage>` where `<name>` matches an EARLIER
 * stage's name in this same file inherits that stage's ending WORKDIR
 * (real Docker/BuildKit semantics: such a stage continues from the named
 * stage's filesystem state); a stage started from any other base image
 * (this repository's own Dockerfile: both stages are `FROM ${NODE_IMAGE}`)
 * starts with no WORKDIR (Docker's own default).
 *
 * @param {string} dockerfileContent
 * @returns {{ instruction: string, rawPath: string, resolvedPath: string }[]}
 */
export function extractDockerEntrypointPaths(dockerfileContent) {
  const joined = dockerfileContent.replace(/\\\r?\n/g, " ");
  const lines = joined.split(/\r?\n/);

  /** @type {Record<string, string | null>} */
  const stageWorkdirAtEnd = {};
  let currentStageName = null;
  let currentWorkdir = null;

  /** @type {{ instruction: string, rawPath: string, resolvedPath: string }[]} */
  const results = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();

    const fromMatch = line.match(/^FROM\s+(\S+)(?:\s+AS\s+(\S+))?/i);
    if (fromMatch) {
      if (currentStageName !== null) {
        stageWorkdirAtEnd[currentStageName] = currentWorkdir;
      }
      const [, base, newStageName] = fromMatch;
      const baseKey = Object.keys(stageWorkdirAtEnd).find(
        (name) => name.toLowerCase() === base.toLowerCase(),
      );
      currentWorkdir = baseKey ? stageWorkdirAtEnd[baseKey] : null;
      currentStageName = newStageName ?? null;
      continue;
    }

    const workdirMatch = line.match(/^WORKDIR\s+(\S+)/i);
    if (workdirMatch) {
      currentWorkdir = resolveDockerPath(workdirMatch[1], currentWorkdir);
      continue;
    }

    const instrMatch = line.match(/^(ENTRYPOINT|CMD)\s+(.*)$/i);
    if (instrMatch) {
      const [, instruction, rest] = instrMatch;
      const tokens = parseDockerInstructionTokens(rest);
      const execPath = pickExecutablePath(tokens);
      if (execPath) {
        results.push({
          instruction: instruction.toUpperCase(),
          rawPath: execPath,
          resolvedPath: resolveDockerPath(execPath, currentWorkdir),
        });
      }
    }
  }

  return results;
}

/**
 * Maps a Dockerfile's resolved absolute in-container path back to a
 * repository-relative path, using this Dockerfile's own `/repo` == repo
 * root convention (see header comment). Returns `null` when the path is
 * not under that known root and so cannot be checked.
 *
 * @param {string} absolutePath
 * @returns {string | null}
 */
export function dockerAbsolutePathToRepoRelative(absolutePath) {
  if (absolutePath === CONTAINER_REPO_ROOT) return ".";
  const prefix = `${CONTAINER_REPO_ROOT}/`;
  if (!absolutePath.startsWith(prefix)) return null;
  return absolutePath.slice(prefix.length);
}

const NIX_LAUNCHER_EXEC_PATTERN = /exec\s+\S*\/bin\/node\s+"([^"]+)"/;

/**
 * Extracts the launcher script path from a Nix flake's `installPhase`
 * `exec .../bin/node "<path>" "\$@"` line. Matched directly against the
 * whole flake content (rather than routed through a shared phase-text
 * extractor) so this file has no import dependency on
 * `guard-docker-packaging-paths.mjs` — kept fully disjoint from T178's
 * file, per this task's scope.
 *
 * @param {string} flakeContent
 * @returns {string | null}
 */
export function extractNixLauncherPath(flakeContent) {
  const match = flakeContent.match(NIX_LAUNCHER_EXEC_PATTERN);
  return match ? match[1] : null;
}

/**
 * Maps the Nix launcher's raw path back to a repository-relative path,
 * using this flake's own `$out/lib/picompanion` == repo root convention
 * (see header comment). Returns `null` when not under that known prefix.
 *
 * @param {string} rawPath
 * @returns {string | null}
 */
export function nixLauncherPathToRepoRelative(rawPath) {
  if (!rawPath.startsWith(NIX_OUT_REPO_ROOT_PREFIX)) return null;
  return rawPath.slice(NIX_OUT_REPO_ROOT_PREFIX.length);
}

/**
 * Given a repository-relative BUILD OUTPUT path (one that names a `dist/`
 * segment), returns the source file candidate(s) this repository's own
 * TypeScript build convention would compile it from: strip the `dist/`
 * segment and, if the path ends in `.js`, also try swapping that
 * extension for `.ts` (a plain `.mjs`/`.cjs` file copied verbatim into
 * `dist/` keeps its own extension in the source candidate). Returns an
 * empty array when the path has no `dist/` segment to strip (nothing to
 * map — the path is presumably already a source-tree reference).
 *
 * @param {string} repoRelativePath
 * @returns {string[]}
 */
export function mapArtifactPathToSourceCandidates(repoRelativePath) {
  const segments = repoRelativePath.split("/");
  const distIndex = segments.indexOf("dist");
  if (distIndex === -1) return [];
  const withoutDist = [...segments.slice(0, distIndex), ...segments.slice(distIndex + 1)].join("/");
  const candidates = [withoutDist];
  if (withoutDist.endsWith(".js")) {
    candidates.push(`${withoutDist.slice(0, -3)}.ts`);
  }
  return candidates;
}

/**
 * Does a repository-relative path "resolve to something that actually
 * exists" under this guard's decision (see header comment)? True when
 * either the literal path exists, or a mapped source candidate does.
 *
 * @param {string} repoRelativePath
 * @param {(candidate: string) => boolean} repoPathExists
 * @returns {boolean}
 */
export function artifactPathResolves(repoRelativePath, repoPathExists) {
  if (repoPathExists(repoRelativePath)) return true;
  return mapArtifactPathToSourceCandidates(repoRelativePath).some((candidate) =>
    repoPathExists(candidate),
  );
}

/**
 * @param {{ dockerfileContent: string, repoPathExists: (path: string) => boolean }} args
 * @returns {{ ok: boolean, violations: string[] }}
 */
export function checkDockerEntrypoint({ dockerfileContent, repoPathExists }) {
  const violations = [];
  const entries = extractDockerEntrypointPaths(dockerfileContent).filter((e) => e.resolvedPath);

  if (entries.length === 0) {
    violations.push("no ENTRYPOINT or CMD instruction names an executable path to check");
    return { ok: false, violations };
  }

  for (const entry of entries) {
    const repoRelative = dockerAbsolutePathToRepoRelative(entry.resolvedPath);
    if (repoRelative === null) {
      violations.push(
        `${entry.instruction} path "${entry.rawPath}" resolves to "${entry.resolvedPath}", ` +
          `which is outside the known container repo root (${CONTAINER_REPO_ROOT}) and cannot be checked`,
      );
      continue;
    }
    if (!artifactPathResolves(repoRelative, repoPathExists)) {
      violations.push(
        `${entry.instruction} path "${entry.rawPath}" (resolved: ${entry.resolvedPath} -> ` +
          `${repoRelative}) does not exist — no built dist file at that path, and no matching source file`,
      );
    }
  }

  return { ok: violations.length === 0, violations };
}

/**
 * @param {{ flakeContent: string, repoPathExists: (path: string) => boolean }} args
 * @returns {{ ok: boolean, violations: string[] }}
 */
export function checkNixEntrypoint({ flakeContent, repoPathExists }) {
  const violations = [];

  const rawPath = extractNixLauncherPath(flakeContent);
  if (!rawPath) {
    violations.push('no `exec .../bin/node "<path>"` launcher line found in the installPhase');
    return { ok: false, violations };
  }

  const repoRelative = nixLauncherPathToRepoRelative(rawPath);
  if (repoRelative === null) {
    violations.push(
      `launcher path "${rawPath}" is outside the known $out repo-root prefix ` +
        `(${NIX_OUT_REPO_ROOT_PREFIX}) and cannot be checked`,
    );
    return { ok: false, violations };
  }

  if (!artifactPathResolves(repoRelative, repoPathExists)) {
    violations.push(
      `launcher path "${rawPath}" (repo-relative: ${repoRelative}) does not exist — ` +
        "no built dist file at that path, and no matching source file",
    );
  }

  return { ok: violations.length === 0, violations };
}
