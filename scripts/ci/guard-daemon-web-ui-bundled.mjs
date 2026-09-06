// T171: CI guard — the packed `@picompanion/server` tarball must actually
// carry the built web UI, not just have a packaging step that ran without
// error.
//
// T43A1 (this task's stated dependency) made `scripts/build-daemon-web-
// ui.mjs` fail loudly when `apps/web/dist` is missing at bundling time —
// that guards the INPUT. Nothing guarded the OUTPUT: `.github/workflows/
// ci.yml`'s `daemon-package-dry-run` job builds the web app, bundles it
// into `packages/server/dist/server/web-ui`, then runs
// `npm pack --dry-run --ignore-scripts --workspace=@picompanion/server` and
// only PRINTS the resulting listing — nothing reads it. An
// `apps/web/dist` that builds successfully but produces an empty (or
// near-empty) output directory bundles into an equally empty
// `web-ui/`, and `npm pack` still exits 0: an empty directory packs into an
// empty tarball entry set for that prefix, not a build failure. See this
// task's brief for the second, separate hole: the `typecheck` job's
// "Verify public package contents" step packs `@picompanion/server` in a
// job that never builds `apps/web` or runs `build-daemon-web-ui.mjs` at
// all, so that tarball legitimately never carries `web-ui/` — the fix for
// that hole is a comment on the workflow step (this guard is not run
// there), not an assertion this module can satisfy.
//
// Calibration, measured at `6e37118` (this guard's own commit) via a real
// `npm pack --dry-run --json --ignore-scripts --workspace=@picompanion/server`
// after building protocol -> relay -> highlight -> client -> design-tokens
// -> frontend-core -> web -> server and running
// `node scripts/build-daemon-web-ui.mjs`:
//   - 176 entries under `dist/server/web-ui/`
//   - 793 files in the tarball total
//   - 12,033,178 bytes (12.0 MiB) unpacked total
//   - 7,663,545 bytes across just the `dist/server/web-ui/` entries
//   - `dist/server/web-ui/index.html` is 960 bytes
//
// The thresholds below are deliberately well below those real numbers —
// this guard must never need editing just because the web app grew or
// shrank a chunk on an ordinary UI change (CLAUDE.md: "a check that must be
// updated on every UI change is a check that gets deleted within two
// waves") — while staying far enough above zero/trivial that "the bundle
// step silently produced nothing" or "index.html is an empty placeholder"
// both still fail it. See guard-daemon-web-ui-bundled.test.mjs and this
// task's report for the real RED (bundle emptied) / GREEN (bundle
// restored) proof against an actual `npm pack --dry-run` run — not a
// hand-written fixture.
export const WEB_UI_PREFIX = "dist/server/web-ui/";
export const INDEX_HTML_PATH = "dist/server/web-ui/index.html";

// ~11% of the real 176-entry count.
export const MIN_WEB_UI_FILE_COUNT = 20;
// ~6.5% of the real ~7.3 MiB of web-ui content (500 KiB).
export const MIN_WEB_UI_TOTAL_BYTES = 500_000;
// ~21% of the real 960-byte index.html (200 bytes) — well above what an
// empty or near-empty placeholder page would be, well below the real page.
export const MIN_INDEX_HTML_BYTES = 200;

/**
 * @typedef {{ path: string, size: number }} PackedFile
 */

/**
 * Parses the stdout of `npm pack --dry-run --json --ignore-scripts
 * --workspace=<name>` into the packed file list for that one workspace.
 * `npm pack --json` prints a JSON array with one object per packed
 * workspace (`{ name, filename, files: [{ path, size, mode }], ... }`);
 * this guard always packs exactly one workspace, so anything other than a
 * single-element array is a shape this guard was not written to handle,
 * not a "no files" result — surfaced as a thrown error rather than being
 * silently read as an empty (and therefore always-failing, but for the
 * wrong reason) file list.
 *
 * @param {string} jsonText
 * @returns {PackedFile[]}
 */
export function parsePackListing(jsonText) {
  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch (cause) {
    throw new Error(
      `guard-daemon-web-ui-bundled: could not parse \`npm pack --json\` output as JSON: ${cause.message}`,
      { cause },
    );
  }
  if (!Array.isArray(parsed) || parsed.length !== 1) {
    throw new Error(
      `guard-daemon-web-ui-bundled: expected \`npm pack --json\` to report exactly one packed ` +
        `workspace, got ${Array.isArray(parsed) ? parsed.length : typeof parsed}. Was more than ` +
        `one --workspace flag passed, or did npm's --json shape change?`,
    );
  }
  const [entry] = parsed;
  if (!entry || !Array.isArray(entry.files)) {
    throw new Error(
      "guard-daemon-web-ui-bundled: `npm pack --json` output has no `files` array — npm's " +
        "--json shape may have changed.",
    );
  }
  return entry.files.map((file) => ({ path: file.path, size: file.size }));
}

/**
 * @param {PackedFile[]} files
 * @returns {PackedFile[]}
 */
export function findWebUiFiles(files) {
  return files.filter((file) => file.path.startsWith(WEB_UI_PREFIX));
}

/**
 * Checks a packed file list against the thresholds above. Returns the
 * list of human-readable violations (empty when the bundle is genuinely
 * present).
 *
 * @param {PackedFile[]} files
 * @returns {{ ok: boolean, violations: string[], webUiFileCount: number, webUiTotalBytes: number }}
 */
export function checkDaemonWebUiBundled(files) {
  const webUiFiles = findWebUiFiles(files);
  const webUiFileCount = webUiFiles.length;
  const webUiTotalBytes = webUiFiles.reduce((sum, file) => sum + file.size, 0);
  const violations = [];

  if (webUiFileCount < MIN_WEB_UI_FILE_COUNT) {
    violations.push(
      `only ${webUiFileCount} file(s) under "${WEB_UI_PREFIX}" in the packed tarball, expected ` +
        `at least ${MIN_WEB_UI_FILE_COUNT}. The web UI bundle looks missing or near-empty — run ` +
        `\`node scripts/build-daemon-web-ui.mjs\` after a real \`apps/web/dist\` build.`,
    );
  }

  if (webUiTotalBytes < MIN_WEB_UI_TOTAL_BYTES) {
    violations.push(
      `only ${webUiTotalBytes} byte(s) total under "${WEB_UI_PREFIX}" in the packed tarball, ` +
        `expected at least ${MIN_WEB_UI_TOTAL_BYTES}.`,
    );
  }

  const indexHtml = webUiFiles.find((file) => file.path === INDEX_HTML_PATH);
  if (!indexHtml) {
    violations.push(`no "${INDEX_HTML_PATH}" entry in the packed tarball at all.`);
  } else if (indexHtml.size < MIN_INDEX_HTML_BYTES) {
    violations.push(
      `"${INDEX_HTML_PATH}" is only ${indexHtml.size} byte(s), expected at least ` +
        `${MIN_INDEX_HTML_BYTES} — this looks like an empty placeholder, not a real built page.`,
    );
  }

  return { ok: violations.length === 0, violations, webUiFileCount, webUiTotalBytes };
}
