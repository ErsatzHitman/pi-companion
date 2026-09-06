#!/usr/bin/env node
// CLI entry point for the daemon-web-ui-bundled guard (T171). Run from the
// repository root (CI runs it via
// `node scripts/ci/run-guard-daemon-web-ui-bundled.mjs`) AFTER the web app
// and `@picompanion/server` have both been built and
// `node scripts/build-daemon-web-ui.mjs` has run — this script does not
// build anything itself, it only packs and inspects what is already on
// disk. See scripts/ci/guard-daemon-web-ui-bundled.mjs for the checked
// rule, the thresholds, and the calibration numbers they are set against.
//
// Shells out to the real `npm pack --dry-run --json --ignore-scripts
// --workspace=@picompanion/server` (never a fixture) so the thing under
// test is the actual packed tarball listing, not a hand-written stand-in
// for it.
import { execFileSync } from "node:child_process";

import { checkDaemonWebUiBundled, parsePackListing } from "./guard-daemon-web-ui-bundled.mjs";

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" });
}

function npmPackDryRunJson(root) {
  // `npm` resolves to `npm.cmd` on Windows, which `execFileSync` can only
  // launch through a shell (matching `scripts/build-daemon-web-ui.mjs`'s
  // own `run()` helper's handling of the same issue).
  return execFileSync(
    "npm",
    ["pack", "--dry-run", "--json", "--ignore-scripts", "--workspace=@picompanion/server"],
    {
      cwd: root,
      encoding: "utf8",
      shell: process.platform === "win32",
      maxBuffer: 32 * 1024 * 1024,
    },
  );
}

function main() {
  const root = git(["rev-parse", "--show-toplevel"]).trim();
  const packJson = npmPackDryRunJson(root);
  const files = parsePackListing(packJson);
  const result = checkDaemonWebUiBundled(files);

  if (result.ok) {
    console.log(
      `guard-daemon-web-ui-bundled: OK — ${result.webUiFileCount} file(s), ` +
        `${result.webUiTotalBytes} byte(s) under dist/server/web-ui/ in the packed ` +
        "@picompanion/server tarball, including a real index.html.",
    );
    return;
  }

  console.error("guard-daemon-web-ui-bundled: FAILED");
  console.error("  The packed @picompanion/server tarball does not carry a real web UI bundle:");
  for (const violation of result.violations) {
    console.error(`    - ${violation}`);
  }
  console.error(
    "  This means the daemon this tarball ships would serve no web UI (or a broken one). Build " +
      "apps/web (npm run build --workspace=@picompanion/web, after protocol -> relay -> " +
      "design-tokens -> frontend-core), run `node scripts/build-daemon-web-ui.mjs`, then re-pack " +
      "and re-run this guard before trusting the packaging step.",
  );
  process.exitCode = 1;
}

main();
