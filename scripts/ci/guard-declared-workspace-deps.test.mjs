import assert from "node:assert/strict";
import test from "node:test";
import {
  extractWorkspaceImports,
  findUndeclaredWorkspaceDeps,
  isTestFile,
  resolvePackageName,
} from "./guard-declared-workspace-deps.mjs";

// --- resolvePackageName --------------------------------------------------

test("resolvePackageName resolves a bare package specifier to itself", () => {
  assert.equal(resolvePackageName("@picompanion/protocol"), "@picompanion/protocol");
});

test("resolvePackageName resolves a subpath specifier to its package name", () => {
  assert.equal(resolvePackageName("@picompanion/highlight/lezer-only"), "@picompanion/highlight");
  assert.equal(
    resolvePackageName("@picompanion/protocol/binary-frames/terminal"),
    "@picompanion/protocol",
  );
});

// --- findUndeclaredWorkspaceDeps: the required "fails on missing, passes on complete" pair ---

test("fails when a package is imported but absent from dependencies (missing-declaration fixture)", () => {
  const files = [
    {
      path: "apps/android/src/features/files/file-syntax-highlight.ts",
      content: 'import { highlightCodeLezerOnly } from "@picompanion/highlight/lezer-only";\n',
    },
  ];
  const manifest = { dependencies: { "@picompanion/protocol": "0.3.0-beta.2" } };

  const violations = findUndeclaredWorkspaceDeps(files, manifest);

  assert.deepEqual(violations, [
    {
      path: "apps/android/src/features/files/file-syntax-highlight.ts",
      packageName: "@picompanion/highlight",
    },
  ]);
});

test("passes when every imported package is declared (complete-manifest fixture)", () => {
  const files = [
    {
      path: "apps/android/src/features/files/file-syntax-highlight.ts",
      content: 'import { highlightCodeLezerOnly } from "@picompanion/highlight/lezer-only";\n',
    },
    {
      path: "apps/android/src/app-shell/core.ts",
      content: 'import { createConnection } from "@picompanion/frontend-core";\n',
    },
  ];
  const manifest = {
    dependencies: {
      "@picompanion/highlight": "0.3.0-beta.2",
      "@picompanion/frontend-core": "0.1.0",
    },
  };

  assert.deepEqual(findUndeclaredWorkspaceDeps(files, manifest), []);
});

// --- subpath resolution feeding into the declared-dependency check ------

test("a violation on a subpath import is reported under the resolved package name, not the subpath", () => {
  const files = [
    {
      path: "apps/web/src/features/files/file-syntax-highlight.ts",
      content: 'import { highlightCodeLezerOnly } from "@picompanion/highlight/lezer-only";\n',
    },
  ];
  const manifest = { dependencies: {} };

  const violations = findUndeclaredWorkspaceDeps(files, manifest);

  assert.deepEqual(violations, [
    {
      path: "apps/web/src/features/files/file-syntax-highlight.ts",
      packageName: "@picompanion/highlight",
    },
  ]);
});

// --- type-only imports are deliberately ignored (see module header) -----

test("a whole-clause type-only import does not require a dependencies entry", () => {
  const files = [
    {
      path: "apps/web/src/app/daemon-client-context.tsx",
      content: 'import type { DaemonClient } from "@picompanion/client";\n',
    },
  ];
  const manifest = { dependencies: {}, devDependencies: { "@picompanion/client": "0.3.0-beta.2" } };

  assert.deepEqual(findUndeclaredWorkspaceDeps(files, manifest), []);
});

test("a named-clause import where every specifier has its own type prefix is type-only", () => {
  const files = [
    {
      path: "apps/web/src/features/connect/apply-connection-offer.test.ts",
      content:
        'import { type ConnectionState, type DaemonClientConfig } from "@picompanion/client";\n',
    },
  ];
  const manifest = {};

  assert.deepEqual(findUndeclaredWorkspaceDeps(files, manifest), []);
});

test("a mixed clause with one non-type specifier is a value import, not type-only", () => {
  const files = [
    {
      path: "apps/web/src/features/sessions/daemon-sessions-client.fixture.test.ts",
      content: 'import { DaemonClient, type WebSocketLike } from "@picompanion/client";\n',
    },
  ];
  const manifest = { dependencies: {}, devDependencies: {} };

  const violations = findUndeclaredWorkspaceDeps(files, manifest);

  assert.deepEqual(violations, [
    {
      path: "apps/web/src/features/sessions/daemon-sessions-client.fixture.test.ts",
      packageName: "@picompanion/client",
    },
  ]);
});

test("a type-only re-export does not require a dependencies entry", () => {
  const files = [
    {
      path: "apps/web/src/app/reexport.ts",
      content: 'export type { ConnectionState } from "@picompanion/client";\n',
    },
  ];
  assert.deepEqual(findUndeclaredWorkspaceDeps(files, {}), []);
});

test("a value re-export requires a dependencies entry", () => {
  const files = [
    {
      path: "apps/web/src/app/reexport.ts",
      content: 'export { DaemonClient } from "@picompanion/client";\n',
    },
  ];
  const violations = findUndeclaredWorkspaceDeps(files, {});
  assert.deepEqual(violations, [
    { path: "apps/web/src/app/reexport.ts", packageName: "@picompanion/client" },
  ]);
});

// --- test files may satisfy the requirement from devDependencies --------

test("isTestFile recognizes .test. and .fixture.test. filenames", () => {
  assert.equal(isTestFile("apps/web/src/features/connect/apply-connection-offer.test.ts"), true);
  assert.equal(
    isTestFile("apps/web/src/features/sessions/daemon-sessions-client.fixture.test.ts"),
    true,
  );
  assert.equal(isTestFile("apps/android/src/app-shell/core.ts"), false);
});

test("a value import declared only in devDependencies passes from a test file", () => {
  const files = [
    {
      path: "apps/web/src/features/sessions/daemon-sessions-client.fixture.test.ts",
      content: 'import { DaemonClient } from "@picompanion/client";\n',
    },
  ];
  const manifest = { dependencies: {}, devDependencies: { "@picompanion/client": "0.3.0-beta.2" } };

  assert.deepEqual(findUndeclaredWorkspaceDeps(files, manifest), []);
});

test("the same devDependencies-only declaration still fails from a non-test (production) file", () => {
  const files = [
    {
      path: "apps/web/src/app/daemon-client-context.tsx",
      content: 'import { DaemonClient } from "@picompanion/client";\n',
    },
  ];
  const manifest = { dependencies: {}, devDependencies: { "@picompanion/client": "0.3.0-beta.2" } };

  const violations = findUndeclaredWorkspaceDeps(files, manifest);

  assert.deepEqual(violations, [
    { path: "apps/web/src/app/daemon-client-context.tsx", packageName: "@picompanion/client" },
  ]);
});

// --- regression: an intervening non-workspace import must not bleed its
// missing `type` keyword into the next, unrelated workspace import's clause
// (found via a real scan of apps/android/src/app-shell/core.test.ts, whose
// `import { describe, expect, it, vi } from "vitest";` immediately precedes
// `import type { ConnectionState } from "@picompanion/client";`) ----------

test("a non-workspace import immediately before a type-only workspace import does not turn it into a value import", () => {
  const content =
    'import { describe, expect, it, vi } from "vitest";\n\nimport type { ConnectionState } from "@picompanion/client";\n';

  assert.deepEqual(extractWorkspaceImports(content), [
    { packageName: "@picompanion/client", typeOnly: true },
  ]);
});

// --- extractWorkspaceImports: non-workspace and dynamic/require forms ----

test("extractWorkspaceImports ignores non-@picompanion specifiers", () => {
  assert.deepEqual(extractWorkspaceImports('import React from "react";\n'), []);
});

test("extractWorkspaceImports treats a dynamic import() as a value import", () => {
  const result = extractWorkspaceImports('const m = await import("@picompanion/highlight");\n');
  assert.deepEqual(result, [{ packageName: "@picompanion/highlight", typeOnly: false }]);
});

test("extractWorkspaceImports treats a bare side-effect import as a value import", () => {
  const result = extractWorkspaceImports('import "@picompanion/highlight";\n');
  assert.deepEqual(result, [{ packageName: "@picompanion/highlight", typeOnly: false }]);
});

test("extractWorkspaceImports does not flag a bare-word mention inside a comment", () => {
  const content =
    "/**\n * `@picompanion/highlight` is not declared in apps/android's dependencies.\n */\nexport const x = 1;\n";
  assert.deepEqual(extractWorkspaceImports(content), []);
});
