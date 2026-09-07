import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  findSigningMaterialViolations,
  SIGNING_MATERIAL_EXTENSIONS,
  SIGNING_MATERIAL_FILENAMES,
} from "./guard-signing-material.mjs";
import { readContentIfWorthwhile } from "./run-guard-signing-material.mjs";

test("SIGNING_MATERIAL_EXTENSIONS and SIGNING_MATERIAL_FILENAMES are non-empty", () => {
  assert.ok(SIGNING_MATERIAL_EXTENSIONS.size > 0);
  assert.ok(SIGNING_MATERIAL_FILENAMES.size > 0);
});

test("the two lists are disjoint in shape — no extension is also a whole filename", () => {
  for (const ext of SIGNING_MATERIAL_EXTENSIONS) {
    assert.ok(!SIGNING_MATERIAL_FILENAMES.has(ext));
  }
});

for (const ext of [
  ".keystore",
  ".jks",
  ".p12",
  ".pfx",
  ".pepk",
  ".apk",
  ".aab",
  ".mobileprovision",
]) {
  test(`flags a tracked path with extension "${ext}"`, () => {
    const violations = findSigningMaterialViolations(`apps/android/release${ext}`);
    assert.equal(violations.length, 1);
    assert.equal(violations[0].kind, "extension");
    assert.equal(violations[0].detail, ext);
  });
}

test(`every entry in SIGNING_MATERIAL_EXTENSIONS actually fires (no dead entry)`, () => {
  for (const ext of SIGNING_MATERIAL_EXTENSIONS) {
    const violations = findSigningMaterialViolations(`some/tracked/path${ext}`);
    assert.equal(violations.length, 1, `expected exactly one violation for extension ${ext}`);
    assert.equal(violations[0].kind, "extension");
  }
});

test("flags google-services.json regardless of directory", () => {
  const violations = findSigningMaterialViolations("apps/android/google-services.json");
  assert.equal(violations.length, 1);
  assert.equal(violations[0].kind, "filename");
  assert.equal(violations[0].detail, "google-services.json");
});

test("flags credentials.json at the repository root", () => {
  const violations = findSigningMaterialViolations("credentials.json");
  assert.equal(violations.length, 1);
  assert.equal(violations[0].kind, "filename");
  assert.equal(violations[0].detail, "credentials.json");
});

test("flags credentials.json nested under apps/android", () => {
  const violations = findSigningMaterialViolations("apps/android/credentials.json");
  assert.equal(violations.length, 1);
  assert.equal(violations[0].kind, "filename");
});

test("does not flag an ordinary source file", () => {
  assert.deepEqual(findSigningMaterialViolations("apps/android/src/app-shell/core.ts"), []);
  assert.deepEqual(findSigningMaterialViolations("scripts/ci/guard-signing-material.mjs"), []);
  assert.deepEqual(findSigningMaterialViolations("apps/android/eas.json"), []);
});

test("does not flag a filename that merely CONTAINS a reserved basename as a substring", () => {
  // "my-credentials.json" is not the reserved basename "credentials.json" —
  // basenameOf() compares the whole last path segment, not a substring.
  assert.deepEqual(findSigningMaterialViolations("docs/my-credentials.json"), []);
  assert.deepEqual(findSigningMaterialViolations("docs/credentials.json.md"), []);
});

test("does not flag content with no violation shape, even when content is provided", () => {
  const content = "export const ordinary = 1;\n";
  assert.deepEqual(findSigningMaterialViolations("packages/protocol/src/index.ts", content), []);
});

// The PEM fixture below is built via `+` at runtime, matching
// guard-secret-scan.test.mjs's own established convention, so the full,
// contiguous "-----BEGIN...PRIVATE KEY-----" header never appears as a
// literal run of characters in THIS file's own tracked source — see
// guard-secret-scan.mjs's module header for why that matters: this
// guard's own test fixtures must never trip the real secret-scan (or this)
// guard when either later scans every tracked file in the repository.
test("flags a PEM private-key header committed under an unrelated extension", () => {
  const header = "-----BEGIN " + "RSA PRIVATE KEY" + "-----";
  const content = "// exported by accident\n" + header + "\nMIIExampleNotARealKey==\n";
  const violations = findSigningMaterialViolations("docs/oops.txt", content);
  assert.equal(violations.length, 1);
  assert.equal(violations[0].kind, "pem-private-key");
  assert.equal(violations[0].line, 2);
});

test("a signing extension AND a PEM header in the same file report both violations", () => {
  const header = "-----BEGIN " + "PRIVATE KEY" + "-----";
  const content = header + "\nMIIExampleNotARealKey==\n";
  const violations = findSigningMaterialViolations("release.jks", content);
  const kinds = violations.map((v) => v.kind).sort();
  assert.deepEqual(kinds, ["extension", "pem-private-key"]);
});

test("omitting content entirely still runs the name-based checks (the binary-file case)", () => {
  const violations = findSigningMaterialViolations("apps/android/release.keystore");
  assert.equal(violations.length, 1);
  assert.equal(violations[0].kind, "extension");
});

// Mutation-style proof: delete the entry, and the guard can no longer see
// the exact case it exists for. This is the "prove the runner can see your
// case" discipline CLAUDE.md requires before trusting any curated list.
// REMOVED at the P9-W5 merge gate: a test titled "MUTATION: removing an
// extension from the set stops the guard from seeing that case" that performed
// no mutation. It copied `SIGNING_MATERIAL_EXTENSIONS`, deleted `.jks` from the
// COPY, asserted the copy lacked it, then called
// `findSigningMaterialViolations` — which reads the module-level Set. The copy
// was never passed to anything, and every assertion still passed with all three
// mutation lines deleted, which is how the gate identified it.
// `findSigningMaterialViolations` takes no set override, so a real mutation
// proof is not expressible against it; the coverage the title promised is
// already given, honestly, by the "every entry in SIGNING_MATERIAL_EXTENSIONS
// actually fires (no dead entry)" test above, which walks the real exported Set.

// ---------------------------------------------------------------------------
// T237: CLI-level coverage of `readContentIfWorthwhile`
// (`run-guard-signing-material.mjs`) — the wiring above the pure matcher,
// which is exactly where the P9-W5 gate's asymmetry lived and where this
// suite previously had zero coverage. These tests write REAL files to a real
// temp directory on disk (never inside the repository tree, so they can
// never themselves become a tracked fixture the guard would have to scan)
// and call the real, exported CLI function against real absolute paths —
// not the matcher, and not a fixture string handed to it in memory.
//
// The PEM header is assembled from separate string pieces at runtime, same
// convention as every other fixture in this file, so the literal header
// never appears as a contiguous run of characters in this file's own tracked
// source.
// ---------------------------------------------------------------------------

function withTempDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), "guard-signing-material-t237-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("T237: readContentIfWorthwhile reads a real .zip file's content — the extension is no longer skipped", () => {
  withTempDir((dir) => {
    const header = "-----BEGIN " + "RSA PRIVATE KEY" + "-----";
    const content = header + "\nMIIExampleNotARealKey==\n";
    const filePath = join(dir, "key.zip");
    writeFileSync(filePath, content, "utf8");

    const read = readContentIfWorthwhile(filePath);

    assert.equal(read, content);
  });
});

test("T237: the same real .zip file, run through the full pipeline, reports a pem-private-key violation", () => {
  withTempDir((dir) => {
    const header = "-----BEGIN " + "EC PRIVATE KEY" + "-----";
    const content = "leading text\n" + header + "\nMIIExampleNotARealKey==\n";
    const filePath = join(dir, "key.zip");
    writeFileSync(filePath, content, "utf8");

    const read = readContentIfWorthwhile(filePath);
    const violations = findSigningMaterialViolations("key.zip", read);

    assert.equal(violations.length, 1);
    assert.equal(violations[0].kind, "pem-private-key");
    assert.equal(violations[0].line, 2);
  });
});

for (const ext of [".jar", ".pdf", ".png", ".woff2", ".mp3"]) {
  test(`T237: readContentIfWorthwhile reads a real ${ext} file's content — no longer in any skip list`, () => {
    withTempDir((dir) => {
      const header = "-----BEGIN " + "OPENSSH PRIVATE KEY" + "-----";
      const content = header + "\nb3BlbnNzaC1rZXktdjEAAAAAB==\n";
      const filePath = join(dir, `key${ext}`);
      writeFileSync(filePath, content, "utf8");

      const read = readContentIfWorthwhile(filePath);

      assert.equal(read, content);
      const violations = findSigningMaterialViolations(`key${ext}`, read);
      assert.equal(violations.length, 1);
      assert.equal(violations[0].kind, "pem-private-key");
    });
  });
}

// The firing this proves was WATCHED, not asserted from the production code
// alone: this test locally re-creates the OLD `SKIP_CONTENT_READ_EXTENSIONS`
// mechanism (T237 deleted the real one) against the exact same real file and
// shows the two behaviours disagree — the old shape genuinely returns
// `undefined` for the same bytes the new, shipped `readContentIfWorthwhile`
// reads. This is the P9-W5 gate's `.txt`-vs-`.zip` asymmetry, reproduced
// directly rather than described.
test("T237: reproduces the pre-fix asymmetry directly — the OLD skip-by-extension shape misses what the shipped code now catches", () => {
  withTempDir((dir) => {
    const header = "-----BEGIN " + "DSA PRIVATE KEY" + "-----";
    const content = header + "\nMIIExampleNotARealKey==\n";
    const filePath = join(dir, "key.zip");
    writeFileSync(filePath, content, "utf8");

    function oldReadContentIfWorthwhile(absolutePath) {
      const oldSkipExtensions = new Set([".png", ".jpg", ".zip", ".jar", ".pdf"]);
      const dot = absolutePath.lastIndexOf(".");
      const ext = dot === -1 ? "" : absolutePath.slice(dot).toLowerCase();
      if (oldSkipExtensions.has(ext)) return undefined;
      return readContentIfWorthwhile(absolutePath);
    }

    const oldBehaviour = oldReadContentIfWorthwhile(filePath);
    const newBehaviour = readContentIfWorthwhile(filePath);

    assert.equal(oldBehaviour, undefined, "the old skip-by-extension shape must miss this file");
    assert.equal(newBehaviour, content, "the shipped code must read this same file's content");
    assert.deepEqual(findSigningMaterialViolations("key.zip", oldBehaviour), []);
    assert.equal(findSigningMaterialViolations("key.zip", newBehaviour)[0].kind, "pem-private-key");
  });
});

test("T237: readContentIfWorthwhile still respects the 5 MiB size cap regardless of extension", () => {
  withTempDir((dir) => {
    const filePath = join(dir, "big.zip");
    // Just over 5 MiB — the cap is about SIZE, not the (now-removed) extension skip.
    const oversized = "a".repeat(5 * 1024 * 1024 + 1);
    writeFileSync(filePath, oversized, "utf8");

    const read = readContentIfWorthwhile(filePath);

    assert.equal(read, undefined);
  });
});

test("T237: readContentIfWorthwhile returns undefined for a path that does not exist (no I/O throw escapes)", () => {
  withTempDir((dir) => {
    const missing = join(dir, "does-not-exist.zip");
    assert.equal(readContentIfWorthwhile(missing), undefined);
  });
});

test("T237: running the real guard's CLI against the real, committed tree still exits 0 (no false positive on real tracked binary assets)", () => {
  const result = execFileSync(process.execPath, ["scripts/ci/run-guard-signing-material.mjs"], {
    encoding: "utf8",
  });
  assert.match(result, /guard-signing-material: OK/);
});
