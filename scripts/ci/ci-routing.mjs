// T17A: pure helpers for validating that `.github/workflows/ci.yml`'s
// path-filter gating and `.github/ci-paths.yml`'s filter definitions stay
// consistent with each other, and that a given set of changed repo paths
// routes to the expected CI jobs. Exercised by `ci-routing.test.mjs`.
//
// This intentionally re-implements the small subset of dorny/paths-filter's
// glob semantics this repo's filters use (directory `**` prefixes and exact
// file paths) rather than depending on the real action, so routing behavior
// can be asserted in a fast, dependency-free unit test.

/**
 * Minimal parser for this repo's `.github/ci-paths.yml` shape only
 * (top-level `key:` filter names, each followed by a YAML list of quoted
 * glob strings; `#` comments and blank lines ignored). Deliberately avoids
 * a YAML library dependency so this stays reproducible under `npm ci`
 * without relying on an undeclared transitive package.
 *
 * @param {string} source raw file contents of .github/ci-paths.yml
 * @returns {Record<string, string[]>}
 */
export function parseCiPathFilters(source) {
  /** @type {Record<string, string[]>} */
  const filters = {};
  let currentKey;

  for (const rawLine of source.split("\n")) {
    const line = rawLine.replace(/#.*$/, "").trimEnd();
    if (line.trim() === "") continue;

    const keyMatch = /^([a-z-]+):\s*$/.exec(line);
    if (keyMatch) {
      currentKey = keyMatch[1];
      filters[currentKey] = [];
      continue;
    }

    const itemMatch = /^\s*-\s*"(.*)"\s*$/.exec(line);
    if (itemMatch && currentKey) {
      filters[currentKey].push(itemMatch[1]);
    }
  }

  return filters;
}

/**
 * @param {string} pattern a `.github/ci-paths.yml` glob entry
 * @param {string} path a repo-relative, forward-slash file path
 * @returns {boolean}
 */
export function matchesPattern(pattern, path) {
  if (pattern.endsWith("/**")) {
    const prefix = pattern.slice(0, -3);
    return path === prefix || path.startsWith(`${prefix}/`);
  }
  if (!pattern.includes("*")) {
    return path === pattern;
  }
  // Minimal glob support (`*` within a single path segment) for entries like
  // "Dockerfile.*" or "docker-compose*.yml"; sufficient for this repo's
  // current filter set.
  const escaped = pattern
    .split("/")
    .map((segment) => segment.replaceAll(/[.+^${}()|[\]\\]/g, "\\$&").replaceAll("*", "[^/]*"))
    .join("/");
  return new RegExp(`^${escaped}$`).test(path);
}

/**
 * @param {Record<string, string[]>} filters parsed .github/ci-paths.yml
 * @param {string[]} changedPaths repo-relative changed file paths
 * @returns {Record<string, boolean>} filter name -> whether it matched
 */
export function evaluateFilters(filters, changedPaths) {
  const result = {};
  for (const [name, patterns] of Object.entries(filters)) {
    result[name] = changedPaths.some((path) =>
      patterns.some((pattern) => matchesPattern(pattern, path)),
    );
  }
  return result;
}

/**
 * Mirrors the `changes` job's `full` output formula in ci.yml.
 *
 * @param {Record<string, boolean>} matched output of evaluateFilters
 * @param {"pull_request" | "push" | "merge_group" | "workflow_dispatch"} eventName
 */
export function isFullRun(matched, eventName) {
  return eventName !== "pull_request" || matched.routing || matched.workspace || matched.ci;
}
