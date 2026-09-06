// T171: unit tests for guard-daemon-web-ui-bundled.mjs's pure functions.
// No real `npm pack` invocation here — see this task's report for the
// manual RED/GREEN proof against the real packed
// `@picompanion/server` tarball (bundle emptied -> guard fails with the
// real npm output; bundle restored -> guard passes with the real 176-file,
// 7,663,545-byte baseline this repository's HEAD produces).
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  checkDaemonWebUiBundled,
  findWebUiFiles,
  INDEX_HTML_PATH,
  MIN_INDEX_HTML_BYTES,
  MIN_WEB_UI_FILE_COUNT,
  MIN_WEB_UI_TOTAL_BYTES,
  parsePackListing,
  WEB_UI_PREFIX,
} from "./guard-daemon-web-ui-bundled.mjs";

function realIndexHtml() {
  return { path: INDEX_HTML_PATH, size: 960 };
}

function manyWebUiFiles(count, sizeEach = 5000) {
  const files = [];
  for (let i = 0; i < count; i += 1) {
    files.push({ path: `${WEB_UI_PREFIX}assets/chunk-${i}.js`, size: sizeEach });
  }
  return files;
}

test("parsePackListing parses npm pack --json's single-workspace shape", () => {
  const json = JSON.stringify([
    {
      name: "@picompanion/server",
      filename: "picompanion-server-0.3.0-beta.2.tgz",
      files: [
        { path: "package.json", size: 100, mode: 420 },
        { path: "dist/server/web-ui/index.html", size: 960, mode: 420 },
      ],
    },
  ]);
  assert.deepEqual(parsePackListing(json), [
    { path: "package.json", size: 100 },
    { path: "dist/server/web-ui/index.html", size: 960 },
  ]);
});

test("parsePackListing throws on invalid JSON rather than silently returning an empty list", () => {
  assert.throws(() => parsePackListing("not json"), /could not parse/);
});

test("parsePackListing throws when npm reports zero or more than one packed workspace", () => {
  assert.throws(() => parsePackListing("[]"), /exactly one packed workspace/);
  assert.throws(
    () => parsePackListing(JSON.stringify([{ files: [] }, { files: [] }])),
    /exactly one packed workspace/,
  );
});

test("parsePackListing throws when the reported entry has no files array", () => {
  assert.throws(
    () => parsePackListing(JSON.stringify([{ name: "@picompanion/server" }])),
    /no `files` array/,
  );
});

test("findWebUiFiles keeps only entries under dist/server/web-ui/", () => {
  const files = [
    { path: "package.json", size: 10 },
    { path: "dist/server/index.js", size: 20 },
    { path: "dist/server/web-ui/index.html", size: 960 },
    { path: "dist/server/web-ui/assets/a.js", size: 500 },
  ];
  assert.deepEqual(findWebUiFiles(files), [
    { path: "dist/server/web-ui/index.html", size: 960 },
    { path: "dist/server/web-ui/assets/a.js", size: 500 },
  ]);
});

test("checkDaemonWebUiBundled passes a realistic bundle (calibrated on the real 176-file, 7,663,545-byte HEAD tarball)", () => {
  const files = [
    { path: "package.json", size: 200 },
    ...manyWebUiFiles(175, 43_762), // ~7.66MB total across 175 chunk files
    realIndexHtml(),
  ];
  const result = checkDaemonWebUiBundled(files);
  assert.equal(result.ok, true);
  assert.deepEqual(result.violations, []);
  assert.equal(result.webUiFileCount, 176);
});

test("checkDaemonWebUiBundled fails when dist/server/web-ui/ is entirely absent", () => {
  const files = [
    { path: "package.json", size: 200 },
    { path: "dist/server/index.js", size: 5000 },
  ];
  const result = checkDaemonWebUiBundled(files);
  assert.equal(result.ok, false);
  assert.equal(result.webUiFileCount, 0);
  assert.ok(result.violations.some((v) => v.includes("only 0 file(s)")));
  assert.ok(result.violations.some((v) => v.includes(`no "${INDEX_HTML_PATH}" entry`)));
});

test("checkDaemonWebUiBundled fails when only a .gitkeep placeholder survived (the real emptied-bundle reproduction)", () => {
  // This is exactly what `mv dist/server/web-ui aside; mkdir dist/server/
  // web-ui; touch .gitkeep` produces against the real `npm pack` — see this
  // task's report.
  const files = [
    { path: "package.json", size: 200 },
    { path: `${WEB_UI_PREFIX}.gitkeep`, size: 1 },
  ];
  const result = checkDaemonWebUiBundled(files);
  assert.equal(result.ok, false);
  assert.equal(result.webUiFileCount, 1);
  assert.equal(result.webUiTotalBytes, 1);
});

test("checkDaemonWebUiBundled fails on file count alone even when total bytes and index.html both look fine", () => {
  const files = [
    realIndexHtml(),
    { path: `${WEB_UI_PREFIX}assets/one-huge-file.js`, size: 2_000_000 },
  ];
  const result = checkDaemonWebUiBundled(files);
  assert.equal(result.ok, false);
  assert.equal(result.webUiFileCount, 2);
  assert.ok(result.webUiFileCount < MIN_WEB_UI_FILE_COUNT);
  assert.ok(result.violations.some((v) => v.includes("only 2 file(s)")));
});

test("checkDaemonWebUiBundled fails on total bytes alone even when file count and index.html both look fine", () => {
  const files = [realIndexHtml(), ...manyWebUiFiles(MIN_WEB_UI_FILE_COUNT + 5, 10)];
  const result = checkDaemonWebUiBundled(files);
  assert.equal(result.ok, false);
  assert.ok(result.webUiTotalBytes < MIN_WEB_UI_TOTAL_BYTES);
  assert.ok(result.violations.some((v) => v.includes("byte(s) total")));
});

test("checkDaemonWebUiBundled fails when index.html is present but a trivial/empty placeholder", () => {
  const files = [
    { path: INDEX_HTML_PATH, size: 5 },
    ...manyWebUiFiles(MIN_WEB_UI_FILE_COUNT + 5, 50_000),
  ];
  const result = checkDaemonWebUiBundled(files);
  assert.equal(result.ok, false);
  assert.ok(result.violations.some((v) => v.includes("empty placeholder")));
});

test("checkDaemonWebUiBundled: index.html byte floor is exercised right at its boundary", () => {
  const passing = [
    { path: INDEX_HTML_PATH, size: MIN_INDEX_HTML_BYTES },
    ...manyWebUiFiles(MIN_WEB_UI_FILE_COUNT + 5, 50_000),
  ];
  assert.equal(checkDaemonWebUiBundled(passing).ok, true);

  const failing = [
    { path: INDEX_HTML_PATH, size: MIN_INDEX_HTML_BYTES - 1 },
    ...manyWebUiFiles(MIN_WEB_UI_FILE_COUNT + 5, 50_000),
  ];
  assert.equal(checkDaemonWebUiBundled(failing).ok, false);
});
