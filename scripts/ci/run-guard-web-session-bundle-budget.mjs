#!/usr/bin/env node
// CLI entry point for the web-session-bundle-budget guard (T44A1, plan.md
// §14.5). Run from the repository root (CI runs it via `node
// scripts/ci/run-guard-web-session-bundle-budget.mjs`) AFTER
// `npm run build --workspace=@picompanion/web` (or the equivalent
// per-package build chain: protocol -> design-tokens -> frontend-core ->
// web) has already produced built `dist/` output for every `@picompanion/*`
// package `apps/web` depends on — this script's own throwaway Vite build
// resolves those the same way the real one does, and fails the same way a
// real build would if they are missing.
//
// This script does its OWN separate `vite build`, with `build.manifest:
// true`, into a scratch temp directory — never `apps/web/dist` itself,
// which `scripts/build-daemon-web-ui.mjs` and the packaging steps around it
// depend on staying exactly what the real build step produced. See
// scripts/ci/guard-web-session-bundle-budget.mjs for why a manifest (the
// real Vite/Rolldown module graph) is what makes "excluding lazy
// terminal/editor/diff chunks" a fact this guard can check, rather than an
// exemption it has to apply by hand.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";

import { build, loadConfigFromFile, mergeConfig } from "vite";

import {
  checkSessionBundleBudget,
  listInitialAssetFiles,
  SESSION_BUNDLE_BUDGET_BYTES,
} from "./guard-web-session-bundle-budget.mjs";

/**
 * Calibration/proof-only escape hatch: overrides the budget this run
 * checks against. Never set by any `.github/workflows/*.yml` step —
 * `grep -rn WEB_SESSION_BUNDLE_BUDGET_BYTES_OVERRIDE .github/` must find
 * nothing but this comment and this file. Exists so the real RED/GREEN
 * proof for this guard (see this task's report) can be reproduced against
 * the real build without editing the committed threshold: run once with
 * this set far below the measured total (RED, with the real measured
 * bytes printed), then again unset (GREEN).
 */
const BUDGET_OVERRIDE_ENV_VAR = "WEB_SESSION_BUNDLE_BUDGET_BYTES_OVERRIDE_FOR_CALIBRATION_ONLY";

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function resolveBudgetBytes() {
  const raw = process.env[BUDGET_OVERRIDE_ENV_VAR];
  if (raw === undefined || raw === "") return SESSION_BUNDLE_BUDGET_BYTES;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(
      `${BUDGET_OVERRIDE_ENV_VAR} must be a positive number, got ${JSON.stringify(raw)}`,
    );
  }
  console.warn(
    `guard-web-session-bundle-budget: ${BUDGET_OVERRIDE_ENV_VAR} is set — checking against ` +
      `${parsed} byte(s) instead of the committed ${SESSION_BUNDLE_BUDGET_BYTES} byte(s) ` +
      "budget. This must never be set in CI.",
  );
  return parsed;
}

async function buildWithManifest(webRoot) {
  const outDir = mkdtempSync(path.join(tmpdir(), "pc-web-session-bundle-budget-"));
  try {
    const loaded = await loadConfigFromFile(
      { command: "build", mode: "production" },
      path.join(webRoot, "vite.config.ts"),
      webRoot,
    );
    if (!loaded) {
      throw new Error(`guard-web-session-bundle-budget: could not load ${webRoot}/vite.config.ts`);
    }
    const merged = mergeConfig(loaded.config, {
      root: webRoot,
      build: { manifest: true, outDir, emptyOutDir: true, sourcemap: false },
      logLevel: "warn",
    });
    await build(merged);
    const manifestPath = path.join(outDir, ".vite", "manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    return { outDir, manifest };
  } catch (err) {
    rmSync(outDir, { recursive: true, force: true });
    throw err;
  }
}

async function main() {
  const root = git(["rev-parse", "--show-toplevel"]);
  const webRoot = path.join(root, "apps", "web");

  const { outDir, manifest } = await buildWithManifest(webRoot);
  try {
    const assetFiles = listInitialAssetFiles(manifest);

    let totalGzipBytes = 0;
    const breakdown = [];
    for (const relFile of assetFiles) {
      const absFile = path.join(outDir, relFile);
      const raw = readFileSync(absFile);
      const gz = gzipSync(raw, { level: 9 });
      totalGzipBytes += gz.length;
      breakdown.push({ file: relFile, rawBytes: raw.length, gzipBytes: gz.length });
    }
    breakdown.sort((a, b) => b.gzipBytes - a.gzipBytes);

    console.log(
      "guard-web-session-bundle-budget: initial JS+CSS for the web session route " +
        `(${assetFiles.length} file(s)):`,
    );
    for (const { file, rawBytes, gzipBytes } of breakdown) {
      console.log(`  ${file}: ${rawBytes} raw -> ${gzipBytes} gzip`);
    }

    const budgetBytes = resolveBudgetBytes();
    const result = checkSessionBundleBudget(totalGzipBytes, budgetBytes);
    console.log(`guard-web-session-bundle-budget: ${result.message}`);
    if (!result.ok) {
      console.error(
        "guard-web-session-bundle-budget: FAILED — plan.md §14.5's web session route budget " +
          "is exceeded. Measure before changing the budget; do not silence this by raising the " +
          "limit without written rationale (CLAUDE.md, plan.md §14.5).",
      );
      process.exitCode = 1;
    }
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error("guard-web-session-bundle-budget: FAILED");
  console.error(err.stack ?? String(err));
  process.exitCode = 1;
});
