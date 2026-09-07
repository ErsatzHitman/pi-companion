import assert from "node:assert/strict";
import test from "node:test";

import {
  findSigningMaterialViolations,
  SIGNING_MATERIAL_EXTENSIONS,
  SIGNING_MATERIAL_FILENAMES,
} from "./guard-signing-material.mjs";

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
