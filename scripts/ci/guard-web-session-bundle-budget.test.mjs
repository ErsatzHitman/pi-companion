// T44A1: unit tests for guard-web-session-bundle-budget.mjs's pure
// functions. No real `vite build` here — see this task's report for the
// real, end-to-end RED (budget override set far below the real measured
// total) / GREEN (override unset) proof against the actual built
// `apps/web` output, run via `run-guard-web-session-bundle-budget.mjs`.
//
// `REAL_SHAPED_MANIFEST` below is not invented: it is a trimmed copy of
// the actual `.vite/manifest.json` a real `vite build --manifest` of this
// repository's `apps/web` produced at this task's `HEAD` (file names,
// hashes, `imports`/`dynamicImports`/`css` edges all real — only the
// unrelated font/asset entries were dropped, since nothing here reads
// them). That is what lets the tests below assert the exact real
// exclusion the module header describes, rather than a shape a guard
// author merely believes is representative.
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  checkSessionBundleBudget,
  collectStaticClosureAssets,
  ENTRY_HTML_KEY,
  listInitialAssetFiles,
  SESSION_BUNDLE_BUDGET_BYTES,
  SESSION_ROUTE_MODULE_KEY,
} from "./guard-web-session-bundle-budget.mjs";

/** @returns {import("./guard-web-session-bundle-budget.mjs").ViteManifest} */
function realShapedManifest() {
  return {
    "../../node_modules/@codemirror/commands/dist/index.js": {
      file: "assets/dist-BzJyNCYH.js",
      imports: ["_dist-Bj0fty1X.js", "_dist-CoR_aYt_.js", "_dist-CkoHHJYU.js", "_dist-C_d9qk56.js"],
    },
    "../../node_modules/@xterm/addon-fit/lib/addon-fit.mjs": {
      file: "assets/addon-fit-DIOBYJe3.js",
    },
    "../../node_modules/@xterm/xterm/lib/xterm.mjs": {
      file: "assets/xterm-NbRy5xNw.js",
    },
    "../../node_modules/jsqr/dist/jsQR.js": {
      file: "assets/jsQR-B1eQcpQl.js",
      imports: ["_rolldown-runtime-Dd_uD5pT.js"],
    },
    "../../packages/highlight/dist/index.js": {
      file: "assets/dist-JlnjuQmd.js",
      imports: ["_dist-Bj0fty1X.js", "_file-syntax-highlight-Cptb-E_u.js", "_dist-C_d9qk56.js"],
    },
    "_Toggle-BJ5zq28m.js": {
      file: "assets/Toggle-BJ5zq28m.js",
      css: ["assets/Toggle-DBsfUzKb.css"],
      imports: ["_rolldown-runtime-Dd_uD5pT.js", "_jsx-runtime-BpzPEenQ.js"],
    },
    "_browser-probe-transport-KNnpOTuT.js": {
      file: "assets/browser-probe-transport-KNnpOTuT.js",
      imports: ["_rolldown-runtime-Dd_uD5pT.js"],
    },
    "_dist-Bj0fty1X.js": { file: "assets/dist-Bj0fty1X.js" },
    "_dist-C_d9qk56.js": {
      file: "assets/dist-C_d9qk56.js",
      imports: [
        "_rolldown-runtime-Dd_uD5pT.js",
        "_dist-Bj0fty1X.js",
        "_dist-CoR_aYt_.js",
        "_dist-CkoHHJYU.js",
      ],
    },
    "_dist-CkoHHJYU.js": {
      file: "assets/dist-CkoHHJYU.js",
      imports: ["_rolldown-runtime-Dd_uD5pT.js", "_dist-CoR_aYt_.js"],
    },
    "_dist-CoR_aYt_.js": {
      file: "assets/dist-CoR_aYt_.js",
      imports: ["_rolldown-runtime-Dd_uD5pT.js"],
    },
    "_file-syntax-highlight-Cptb-E_u.js": {
      file: "assets/file-syntax-highlight-Cptb-E_u.js",
      imports: ["_dist-Bj0fty1X.js"],
    },
    "_jsx-runtime-BpzPEenQ.js": {
      file: "assets/jsx-runtime-BpzPEenQ.js",
      imports: ["_rolldown-runtime-Dd_uD5pT.js"],
    },
    "_preload-helper-BFFo02Z4.js": {
      file: "assets/preload-helper-BFFo02Z4.js",
      imports: ["_rolldown-runtime-Dd_uD5pT.js", "_jsx-runtime-BpzPEenQ.js"],
    },
    "_primitives-cTQLTgsf.js": {
      file: "assets/primitives-cTQLTgsf.js",
      imports: ["_rolldown-runtime-Dd_uD5pT.js", "_jsx-runtime-BpzPEenQ.js", "_Toggle-BJ5zq28m.js"],
    },
    "_rolldown-runtime-Dd_uD5pT.js": { file: "assets/rolldown-runtime-Dd_uD5pT.js" },
    "_route-BxL1RPoc.js": {
      file: "assets/route-BxL1RPoc.js",
      imports: ["_rolldown-runtime-Dd_uD5pT.js", "_jsx-runtime-BpzPEenQ.js"],
    },
    "_route-placeholder-CuP4BTeh.js": {
      file: "assets/route-placeholder-CuP4BTeh.js",
      imports: ["_jsx-runtime-BpzPEenQ.js"],
    },
    "index.html": {
      file: "assets/index-C2PM7DAC.js",
      isEntry: true,
      css: ["assets/index-Pb7v8Hrn.css"],
      imports: [
        "_rolldown-runtime-Dd_uD5pT.js",
        "_jsx-runtime-BpzPEenQ.js",
        "_route-BxL1RPoc.js",
        "_preload-helper-BFFo02Z4.js",
        "_Toggle-BJ5zq28m.js",
        "_primitives-cTQLTgsf.js",
      ],
      dynamicImports: [
        "_browser-probe-transport-KNnpOTuT.js",
        "src/features/extensions/renderers/diff.tsx",
        "src/routes/screens/connect-screen.tsx",
        "src/routes/screens/host-diagnostics-screen.tsx",
        "src/routes/screens/host-session-files-screen.tsx",
        "src/routes/screens/host-session-terminal-screen.tsx",
        "src/routes/screens/host-session-screen.tsx",
        "src/routes/screens/host-sessions-screen.tsx",
        "src/routes/screens/host-settings-screen.tsx",
        "src/routes/screens/host-screen.tsx",
      ],
    },
    "src/features/extensions/renderers/diff.tsx": {
      file: "assets/diff-C2MulyCn.js",
      imports: [
        "_jsx-runtime-BpzPEenQ.js",
        "_primitives-cTQLTgsf.js",
        "index.html",
        "_file-syntax-highlight-Cptb-E_u.js",
      ],
    },
    "src/features/files/file-diff.ts": { file: "assets/file-diff-CIVS1Tw0.js" },
    "src/routes/screens/connect-screen.tsx": {
      file: "assets/connect-screen--KlTHq8a.js",
      css: ["assets/connect-screen-Bg8Cw3fC.css"],
      imports: [
        "_rolldown-runtime-Dd_uD5pT.js",
        "_jsx-runtime-BpzPEenQ.js",
        "_preload-helper-BFFo02Z4.js",
        "_Toggle-BJ5zq28m.js",
        "_browser-probe-transport-KNnpOTuT.js",
      ],
      dynamicImports: ["../../node_modules/jsqr/dist/jsQR.js"],
    },
    "src/routes/screens/host-diagnostics-screen.tsx": {
      file: "assets/host-diagnostics-screen-CD1wEGVm.js",
      css: ["assets/host-diagnostics-screen-DSyX5bAs.css"],
      imports: [
        "_rolldown-runtime-Dd_uD5pT.js",
        "_jsx-runtime-BpzPEenQ.js",
        "_preload-helper-BFFo02Z4.js",
        "_Toggle-BJ5zq28m.js",
        "_primitives-cTQLTgsf.js",
        "index.html",
      ],
    },
    "src/routes/screens/host-screen.tsx": {
      file: "assets/host-screen-D96pf0MK.js",
      imports: [
        "_jsx-runtime-BpzPEenQ.js",
        "_route-BxL1RPoc.js",
        "index.html",
        "_route-placeholder-CuP4BTeh.js",
      ],
    },
    "src/routes/screens/host-session-files-screen.tsx": {
      file: "assets/host-session-files-screen-CzhhF6cw.js",
      css: ["assets/host-session-files-screen-DBAlJQes.css"],
      imports: [
        "_rolldown-runtime-Dd_uD5pT.js",
        "_jsx-runtime-BpzPEenQ.js",
        "_route-BxL1RPoc.js",
        "_preload-helper-BFFo02Z4.js",
        "_Toggle-BJ5zq28m.js",
        "_primitives-cTQLTgsf.js",
        "index.html",
        "_file-syntax-highlight-Cptb-E_u.js",
      ],
      dynamicImports: [
        "src/features/files/file-diff.ts",
        "_dist-CoR_aYt_.js",
        "_dist-CkoHHJYU.js",
        "../../node_modules/@codemirror/commands/dist/index.js",
        "_dist-C_d9qk56.js",
        "../../packages/highlight/dist/index.js",
      ],
    },
    "src/routes/screens/host-session-screen.tsx": {
      file: "assets/host-session-screen-96FwHaPO.js",
      css: ["assets/host-session-screen-CwaPMxPX.css"],
      imports: [
        "_rolldown-runtime-Dd_uD5pT.js",
        "_jsx-runtime-BpzPEenQ.js",
        "_route-BxL1RPoc.js",
        "_preload-helper-BFFo02Z4.js",
        "_Toggle-BJ5zq28m.js",
        "_primitives-cTQLTgsf.js",
        "index.html",
      ],
    },
    "src/routes/screens/host-session-terminal-screen.tsx": {
      file: "assets/host-session-terminal-screen-DJQq5LXV.js",
      css: ["assets/host-session-terminal-screen-Cwk-Er9T.css"],
      imports: [
        "_rolldown-runtime-Dd_uD5pT.js",
        "_jsx-runtime-BpzPEenQ.js",
        "_route-BxL1RPoc.js",
        "_preload-helper-BFFo02Z4.js",
        "_Toggle-BJ5zq28m.js",
        "_primitives-cTQLTgsf.js",
        "index.html",
      ],
      dynamicImports: [
        "../../node_modules/@xterm/xterm/lib/xterm.mjs",
        "../../node_modules/@xterm/addon-fit/lib/addon-fit.mjs",
      ],
    },
    "src/routes/screens/host-sessions-screen.tsx": {
      file: "assets/host-sessions-screen-DQxy3omh.js",
      imports: [
        "_rolldown-runtime-Dd_uD5pT.js",
        "_jsx-runtime-BpzPEenQ.js",
        "_route-BxL1RPoc.js",
        "index.html",
      ],
    },
    "src/routes/screens/host-settings-screen.tsx": {
      file: "assets/host-settings-screen-De5xUJEU.js",
      imports: [
        "_rolldown-runtime-Dd_uD5pT.js",
        "_jsx-runtime-BpzPEenQ.js",
        "_route-BxL1RPoc.js",
        "_Toggle-BJ5zq28m.js",
        "_primitives-cTQLTgsf.js",
        "index.html",
        "_route-placeholder-CuP4BTeh.js",
      ],
    },
  };
}

test("ENTRY_HTML_KEY and SESSION_ROUTE_MODULE_KEY match the real manifest's real keys", () => {
  const manifest = realShapedManifest();
  assert.ok(Object.hasOwn(manifest, ENTRY_HTML_KEY));
  assert.ok(Object.hasOwn(manifest, SESSION_ROUTE_MODULE_KEY));
});

test("listInitialAssetFiles returns exactly the entry closure plus the session screen's own closure", () => {
  const files = listInitialAssetFiles(realShapedManifest());
  assert.deepEqual(
    new Set(files),
    new Set([
      "assets/index-C2PM7DAC.js",
      "assets/index-Pb7v8Hrn.css",
      "assets/rolldown-runtime-Dd_uD5pT.js",
      "assets/jsx-runtime-BpzPEenQ.js",
      "assets/route-BxL1RPoc.js",
      "assets/preload-helper-BFFo02Z4.js",
      "assets/Toggle-BJ5zq28m.js",
      "assets/Toggle-DBsfUzKb.css",
      "assets/primitives-cTQLTgsf.js",
      "assets/host-session-screen-96FwHaPO.js",
      "assets/host-session-screen-CwaPMxPX.css",
    ]),
  );
  assert.equal(files.length, 11); // no duplicates from the shared-import diamond
});

test("listInitialAssetFiles excludes every chunk reachable only via a dynamicImports edge", () => {
  const files = new Set(listInitialAssetFiles(realShapedManifest()));
  const excludedFiles = [
    "assets/host-session-terminal-screen-DJQq5LXV.js", // terminal screen
    "assets/host-session-terminal-screen-Cwk-Er9T.css",
    "assets/xterm-NbRy5xNw.js", // xterm itself
    "assets/addon-fit-DIOBYJe3.js",
    "assets/host-session-files-screen-CzhhF6cw.js", // file editor / diff screen
    "assets/host-session-files-screen-DBAlJQes.css",
    "assets/file-diff-CIVS1Tw0.js",
    "assets/dist-BzJyNCYH.js", // @codemirror/commands
    "assets/dist-JlnjuQmd.js", // @picompanion/highlight
    "assets/file-syntax-highlight-Cptb-E_u.js",
    "assets/diff-C2MulyCn.js", // pi-ui diff renderer
    "assets/connect-screen--KlTHq8a.js", // unrelated other screens
    "assets/connect-screen-Bg8Cw3fC.css",
    "assets/jsQR-B1eQcpQl.js",
    "assets/host-diagnostics-screen-CD1wEGVm.js",
    "assets/host-diagnostics-screen-DSyX5bAs.css",
    "assets/host-sessions-screen-DQxy3omh.js",
    "assets/host-settings-screen-De5xUJEU.js",
    "assets/host-screen-D96pf0MK.js",
    "assets/browser-probe-transport-KNnpOTuT.js",
  ];
  for (const excluded of excludedFiles) {
    assert.ok(!files.has(excluded), `expected ${excluded} to be excluded, but it was included`);
  }
});

test("collectStaticClosureAssets throws (never silently returns an empty set) when a root key is missing", () => {
  const manifest = realShapedManifest();
  assert.throws(
    () =>
      collectStaticClosureAssets(manifest, ["index.html", "src/routes/screens/does-not-exist.tsx"]),
    /manifest has no entry for "src\/routes\/screens\/does-not-exist\.tsx"/,
  );
});

test("collectStaticClosureAssets tolerates cycles back to an already-visited key (e.g. a chunk importing 'index.html')", () => {
  // Several real entries above (diff.tsx, host-diagnostics-screen.tsx, ...)
  // list "index.html" inside their own `imports` — a real edge shape this
  // guard's traversal must not infinite-loop on.
  const files = collectStaticClosureAssets(realShapedManifest(), [
    "src/features/extensions/renderers/diff.tsx",
  ]);
  assert.ok(files.includes("assets/diff-C2MulyCn.js"));
  assert.ok(files.includes("assets/index-C2PM7DAC.js")); // reached via the cycle back to index.html
});

test("MUTATION: a route accidentally gaining STATIC imports of the lazy chunks is caught by the budget check", () => {
  // Simulates the real failure mode this guard exists for: someone removes
  // the `lazyRouteComponent`/`import()` boundary and the terminal screen's
  // xterm dependency, plus `@picompanion/highlight`'s syntax-highlight
  // data, become normal static imports of the session screen.
  const manifest = realShapedManifest();
  manifest["src/routes/screens/host-session-screen.tsx"].imports.push(
    "../../node_modules/@xterm/xterm/lib/xterm.mjs",
    "_file-syntax-highlight-Cptb-E_u.js",
  );
  const files = new Set(listInitialAssetFiles(manifest));
  assert.ok(
    files.has("assets/xterm-NbRy5xNw.js"),
    "the mutated static import must now be included",
  );
  assert.ok(files.has("assets/file-syntax-highlight-Cptb-E_u.js"));

  // Real measured per-file gzip sizes from this task's report (not
  // invented): summing them with xterm's and the highlight data's real
  // gzip sizes now added pushes the total well past the budget.
  const REAL_GZIP_BYTES = {
    "assets/index-C2PM7DAC.js": 100_701,
    "assets/preload-helper-BFFo02Z4.js": 95_299,
    "assets/host-session-screen-96FwHaPO.js": 22_756,
    "assets/route-BxL1RPoc.js": 9_432,
    "assets/index-Pb7v8Hrn.css": 4_692,
    "assets/jsx-runtime-BpzPEenQ.js": 2_992,
    "assets/Toggle-DBsfUzKb.css": 2_767,
    "assets/primitives-cTQLTgsf.js": 2_491,
    "assets/Toggle-BJ5zq28m.js": 1_419,
    "assets/host-session-screen-CwaPMxPX.css": 1_217,
    "assets/rolldown-runtime-Dd_uD5pT.js": 627,
    "assets/xterm-NbRy5xNw.js": 83_083, // measured: 331,247 raw -> 83,083 gzip
    "assets/file-syntax-highlight-Cptb-E_u.js": 230_900, // measured: 707,982 raw -> 230,900 gzip
    "assets/dist-Bj0fty1X.js": 9_314, // measured: 27,115 raw -> 9,314 gzip (highlight data's own leaf dependency)
  };
  let total = 0;
  for (const file of files) {
    assert.ok(Object.hasOwn(REAL_GZIP_BYTES, file), `no measured size fixture for ${file}`);
    total += REAL_GZIP_BYTES[file];
  }
  const result = checkSessionBundleBudget(total);
  assert.equal(result.ok, false);
  assert.match(result.message, /FAILED/);
});

test("checkSessionBundleBudget: at or under budget is ok, one byte over fails", () => {
  assert.equal(checkSessionBundleBudget(SESSION_BUNDLE_BUDGET_BYTES).ok, true);
  assert.equal(checkSessionBundleBudget(SESSION_BUNDLE_BUDGET_BYTES - 1).ok, true);
  assert.equal(checkSessionBundleBudget(SESSION_BUNDLE_BUDGET_BYTES + 1).ok, false);
});

test("checkSessionBundleBudget honors an explicit budget override", () => {
  assert.equal(checkSessionBundleBudget(1000, 500).ok, false);
  assert.equal(checkSessionBundleBudget(500, 500).ok, true);
});

test("SESSION_BUNDLE_BUDGET_BYTES is exactly 500 KiB (binary, not decimal)", () => {
  assert.equal(SESSION_BUNDLE_BUDGET_BYTES, 512_000);
});
