import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Enforced import-purity guard for @picompanion/frontend-core (T14).
 *
 * Repository invariant: packages/frontend-core must never import React,
 * React Native, Expo, DOM types, or browser globals. The lint rule half
 * of the guard lives in this package's `.oxlintrc.json`
 * (`no-restricted-imports` / `no-restricted-globals`, applied via
 * `extends` to every file under this package). This test is the test
 * half: it runs that same lint config both against the real source (so
 * the guard fails the build the moment a violation is committed) and
 * against a seeded, throwaway fixture (so the guard is proven to catch
 * violations at all, per this task's acceptance criteria).
 */

const thisFileDir = path.dirname(fileURLToPath(import.meta.url));
const packageDir = path.join(thisFileDir, "..");
const srcDir = thisFileDir;

const require = createRequire(import.meta.url);
const oxlintPackageDir = path.dirname(require.resolve("oxlint/package.json"));
const oxlintBin = path.join(oxlintPackageDir, "bin", "oxlint");

interface OxlintResult {
  status: number;
  output: string;
}

function runOxlint(targetPath: string): OxlintResult {
  try {
    const output = execFileSync(process.execPath, [oxlintBin, targetPath], {
      cwd: packageDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { status: 0, output };
  } catch (error) {
    const execError = error as { status?: number | null; stdout?: string; stderr?: string };
    return {
      status: execError.status ?? 1,
      output: `${execError.stdout ?? ""}${execError.stderr ?? ""}`,
    };
  }
}

describe("frontend-core import-purity guard", () => {
  it("passes oxlint's no-restricted-imports/globals rules against the real source tree", () => {
    const result = runOxlint(srcDir);
    if (result.status !== 0) {
      // eslint-disable-next-line no-console
      console.error(result.output);
    }
    expect(result.status).toBe(0);
  });

  it("fails on a seeded React import (acceptance criterion: guard fails the build on a seeded violation)", () => {
    const fixtureDir = mkdtempSync(path.join(tmpdir(), "frontend-core-guard-react-"));
    const fixtureFile = path.join(fixtureDir, "seeded-react-violation.ts");
    writeFileSync(
      fixtureFile,
      ['import React from "react";', "", "export const seeded = React;", ""].join("\n"),
    );
    try {
      // Run with this package's cwd so the nested .oxlintrc.json (which
      // extends the repo root config) applies to the fixture file too.
      const result = runOxlint(fixtureFile);
      expect(result.status).not.toBe(0);
      expect(result.output).toContain("no-restricted-imports");
    } finally {
      rmSync(fixtureDir, { recursive: true, force: true });
    }
  });

  it("fails on a seeded DOM global reference (acceptance criterion: guard fails on a seeded DOM violation)", () => {
    const fixtureDir = mkdtempSync(path.join(tmpdir(), "frontend-core-guard-dom-"));
    const fixtureFile = path.join(fixtureDir, "seeded-dom-violation.ts");
    writeFileSync(
      fixtureFile,
      ["export function seeded(): string {", "  return window.location.href;", "}", ""].join("\n"),
    );
    try {
      const result = runOxlint(fixtureFile);
      expect(result.status).not.toBe(0);
      expect(result.output).toContain("no-restricted-globals");
    } finally {
      rmSync(fixtureDir, { recursive: true, force: true });
    }
  });
});
