// Contract test for T38A0, T38B0b, T51A and T99.
//
// Proves that the seven commands T38A0/T38B0b/T51A added to `PiRpcCommand`
// (`fork`, `clone`, `set_session_name`, `set_auto_retry`, `set_steering_mode`,
// `set_follow_up_mode`, `get_commands`), plus `get_entries` (pre-existing,
// its `since?: string` drift closed by T99), still match the REAL signatures
// declared by the installed Pi's own `dist/modes/rpc/rpc-types.d.ts`
// `RpcCommand` union — so a drift in either file (ours, or a future Pi
// upgrade) fails this test. Note on the historical "35 command arms" phrase
// this file's own comments once used: T51A counted by hand and found the
// real total is **32** `RpcCommand` request-type arms plus **2** separate
// `RpcExtensionUIRequest`/`RpcExtensionUIResponse` message types outside
// that union — not 35. See `docs/pi-extension-compatibility.md`'s T51A
// findings section (§9.1) for the corrected count and the full verdict
// table for all 32 arms; this file does not re-derive that audit.
//
// What this test does NOT prove: it never opens a socket to any daemon.
// Agents in this repository must never bind or connect to the production
// daemon (port 6767) or the dev daemon (port 6768), so none of these
// commands has been round-tripped against a live Pi RPC session. T38A3,
// T38A4 and T38B2 — whichever lands first — must perform that live
// round-trip before shipping a user-facing flow that depends on these
// shapes; see the doc comment on `PiRpcCommand` in `rpc-types.ts`.
//
// --- T99: how this test behaves with and without an installed Pi ---
//
// Before T99, every check in this file read the installed Pi CLI's own
// `.d.ts` and, when none could be found (for example on a CI runner that
// never installs the `pi` CLI), each `it(...)` printed a warning and
// `return`ed early. Vitest counts an `it` that returns without a failed
// assertion as PASSED — so on CI this whole file reported plain green while
// verifying literally nothing about our RPC mirror. That is this
// repository's single most catalogued defect class ("a skip that reports
// green"), landed in its most consequential location: the one test whose
// entire job is to catch RPC drift.
//
// T99 fixes this two ways:
//
//  1. The field-for-field comparisons below now run against a VENDORED,
//     pinned snapshot of the exact Pi `.d.ts` fragments under test
//     (`VENDORED_PI_RPC_TYPES_DTS_VERSION` / `VENDORED_PI_RPC_COMMAND_FRAGMENT`
//     below), not the live installed file. This is real, executable
//     content on every machine — including CI, which has no `pi` CLI — so
//     these `it`s now PASS or FAIL for real everywhere, never skip. This
//     follows T136's precedent: vendor one small, exact fragment with a
//     parity assertion against the real thing, not the whole package.
//  2. A second, separate `describe.skipIf` block below checks that vendored
//     snapshot for staleness against whatever Pi IS installed on the
//     machine running the test. `describe.skipIf`/`it.skipIf` report as
//     SKIPPED in vitest's own summary output — a distinct, visible count,
//     never folded into "passed" — so a reader of the test run's own output
//     sees plainly that this half did not execute, rather than inferring a
//     false "everything was checked" from a green summary. When Pi IS
//     installed (any developer machine with `pi` on `PATH`, this one
//     included), this block runs for real and fails if the vendored
//     snapshot has gone stale against a newer Pi release — the signal that
//     `VENDORED_PI_RPC_TYPES_DTS_VERSION` and the fragment below need
//     re-verifying and bumping.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const OUR_RPC_TYPES_PATH = path.join(__dirname, "rpc-types.ts");

// Vendored, pinned snapshot of the fragments of the installed Pi's own
// `dist/modes/rpc/rpc-types.d.ts` that this test compares our mirror
// against. Captured verbatim (field order, optionality and literal unions)
// from `@earendil-works/pi-coding-agent@0.84.1`'s real declaration file —
// read directly from
// `%LOCALAPPDATA%\pi-node\current\node_modules\@earendil-works\pi-coding-agent\dist\modes\rpc\rpc-types.d.ts`
// on 2026-09-05 — NOT reproduced from memory or from our own mirror. This is
// a small, exact fragment of Pi's real union, not the package: T136 vendored
// one regex from `expo-router` with a parity assertion rather than vendoring
// `expo-router` itself, and this follows that same shape.
//
// When Pi is upgraded and the staleness-check `describe.skipIf` block below
// starts failing, re-read the real `.d.ts`, update this fragment and the
// version string together, and re-run both blocks.
const VENDORED_PI_RPC_TYPES_DTS_VERSION = "0.84.1";
const VENDORED_PI_RPC_TYPES_DTS_FRAGMENT = `
export type RpcCommand = {
    id?: string;
    type: "fork";
    entryId: string;
} | {
    id?: string;
    type: "clone";
} | {
    id?: string;
    type: "set_session_name";
    name: string;
} | {
    id?: string;
    type: "set_auto_retry";
    enabled: boolean;
} | {
    id?: string;
    type: "set_steering_mode";
    mode: "all" | "one-at-a-time";
} | {
    id?: string;
    type: "set_follow_up_mode";
    mode: "all" | "one-at-a-time";
} | {
    id?: string;
    type: "get_commands";
} | {
    id?: string;
    type: "get_entries";
    since?: string;
};
export interface RpcSessionState {
    steeringMode: "all" | "one-at-a-time";
    followUpMode: "all" | "one-at-a-time";
}
`;

/**
 * Finds the installed Pi CLI's `rpc-types.d.ts`, or null if none of the
 * candidate locations exist on this machine. Read-only: never writes to,
 * or otherwise modifies, anything under the resolved path.
 */
function locateInstalledPiRpcTypesDts(): string | null {
  const relativeDtsParts = [
    "node_modules",
    "@earendil-works",
    "pi-coding-agent",
    "dist",
    "modes",
    "rpc",
    "rpc-types.d.ts",
  ];

  const envOverride = process.env.PI_RPC_TYPES_D_TS_PATH;
  if (envOverride && existsSync(envOverride)) {
    return envOverride;
  }

  const candidates: string[] = [];

  const localAppData = process.env.LOCALAPPDATA;
  if (localAppData) {
    candidates.push(path.join(localAppData, "pi-node", "current", ...relativeDtsParts));
  }

  try {
    const finder = process.platform === "win32" ? "where" : "which";
    const output = execFileSync(finder, ["pi"], { encoding: "utf8" }).trim();
    const firstLine = output.split(/\r?\n/)[0]?.trim();
    if (firstLine) {
      // Walk upward from the resolved executable looking for a sibling
      // `node_modules` tree — covers both the `pi-node/current/pi` layout
      // (bin and node_modules are siblings) and a plain npm-global install
      // a couple of directories further up.
      let dir = path.dirname(firstLine);
      for (let i = 0; i < 4; i++) {
        candidates.push(path.join(dir, ...relativeDtsParts));
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
      }
    }
  } catch {
    // `pi` is not on PATH on this machine; fall through to what we have.
  }

  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

/**
 * Strips `//` line comments and `/* *\/` block comments before matching, so
 * a doc comment that quotes the very object-literal shape it explains (as
 * this file's own comments on `fork`/`clone`/`set_session_name` do) can
 * never be mistaken for a second, real union arm.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

/**
 * Extracts the flat object-literal block for a given discriminant value,
 * matched on either `type: "X"` (Pi's `RpcCommand`) or our own field of the
 * same name, tolerant of both the multi-line formatting Pi's `.d.ts` uses
 * and the single-line formatting this file uses. Assumes (true for every
 * command arm compared here) that the block contains no nested `{}`.
 */
function extractCommandBlock(source: string, discriminant: string): string {
  const pattern = new RegExp(`\\{[^{}]*type:\\s*"${discriminant}"[^{}]*\\}`, "g");
  const matches = source.match(pattern);
  if (!matches || matches.length === 0) {
    throw new Error(`no RpcCommand block found for type "${discriminant}"`);
  }
  if (matches.length > 1) {
    throw new Error(
      `expected exactly one RpcCommand block for type "${discriminant}", found ${matches.length}`,
    );
  }
  return matches[0];
}

/**
 * Parses a flat `{ field?: type; field2: type2 }` block into a
 * name -> "?:type" map, order-independent, so two differently-formatted
 * (single-line vs multi-line) blocks compare equal iff their fields match.
 */
function extractFields(block: string): Record<string, string> {
  const inner = block.slice(1, -1).trim();
  const withTrailingSemicolon = inner.endsWith(";") ? inner : `${inner};`;
  const fields: Record<string, string> = {};
  const fieldPattern = /(\w+)(\?)?:\s*([^;]+);/g;
  let match: RegExpExecArray | null;
  // biome-ignore lint: straightforward regex-driven extraction loop
  while ((match = fieldPattern.exec(withTrailingSemicolon)) !== null) {
    const [, name, optional, rawType] = match;
    fields[name] = `${optional ? "?" : ""}:${rawType.trim()}`;
  }
  return fields;
}

/**
 * Extracts a single field's declared value type (the text after `fieldName?:`
 * or `fieldName:`, up to the terminating `;`), from anywhere in `source`.
 * Unlike `extractFields`, this does not require the field to live inside a
 * flat `{...}` block with no nested braces — it just needs the field name to
 * be unambiguous in the file, which `steeringMode` and `followUpMode` are in
 * both `rpc-types.ts`, the vendored fragment, and the installed Pi's `.d.ts`.
 */
function extractFieldType(source: string, fieldName: string): { optional: boolean; type: string } {
  const pattern = new RegExp(`\\b${fieldName}(\\??):\\s*([^;]+);`);
  const match = source.match(pattern);
  if (!match) {
    throw new Error(`no field named "${fieldName}" found`);
  }
  return { optional: match[1] === "?", type: match[2].trim() };
}

/**
 * If `valueType` is a bare identifier (e.g. `PiQueueMode`) that resolves to a
 * top-level `export type <name> = <rhs>;` declaration in `source`, returns
 * the alias's right-hand side; otherwise returns `valueType` unchanged. Our
 * mirror names some repeated unions (`PiQueueMode`) rather than inlining
 * them at every use, unlike Pi's own `.d.ts` (and the vendored fragment
 * above, which mirrors Pi's inlining), so a literal source-text comparison
 * must see through that one indirection layer or every alias use would
 * falsely read as drift.
 */
function resolveTypeAlias(source: string, valueType: string): string {
  const trimmed = valueType.trim();
  if (!/^[A-Za-z_]\w*$/.test(trimmed)) {
    return valueType;
  }
  const aliasPattern = new RegExp(`export type ${trimmed}\\s*=\\s*([^;]+);`);
  const match = source.match(aliasPattern);
  return match ? match[1].trim() : valueType;
}

/**
 * Applies `resolveTypeAlias` to every field's value-type portion of an
 * `extractFields` result (each value is `"?:type"` or `":type"`), leaving
 * the optional-marker prefix untouched.
 */
function resolveFieldAliases(
  fields: Record<string, string>,
  source: string,
): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const [name, value] of Object.entries(fields)) {
    const colonIndex = value.indexOf(":");
    const prefix = value.slice(0, colonIndex + 1);
    const rawType = value.slice(colonIndex + 1);
    resolved[name] = `${prefix}${resolveTypeAlias(source, rawType)}`;
  }
  return resolved;
}

const installedPiRpcTypesDtsPath = locateInstalledPiRpcTypesDts();

const mirroredCommands: Array<{ type: string; ourFile: string }> = [
  { type: "fork", ourFile: OUR_RPC_TYPES_PATH },
  { type: "clone", ourFile: OUR_RPC_TYPES_PATH },
  { type: "set_session_name", ourFile: OUR_RPC_TYPES_PATH },
  { type: "set_auto_retry", ourFile: OUR_RPC_TYPES_PATH },
  { type: "set_steering_mode", ourFile: OUR_RPC_TYPES_PATH },
  { type: "set_follow_up_mode", ourFile: OUR_RPC_TYPES_PATH },
  { type: "get_commands", ourFile: OUR_RPC_TYPES_PATH },
  { type: "get_entries", ourFile: OUR_RPC_TYPES_PATH },
];

const mirroredStateFields = ["steeringMode", "followUpMode"];

// --- Layer 1: unconditional, runs everywhere including CI (no Pi needed) ---

describe("PiRpcCommand matches the vendored Pi RpcCommand snapshot field-for-field (T38A0, T38B0b, T51A, T99)", () => {
  it.each(mirroredCommands)(
    "$type matches the vendored Pi RpcCommand snapshot field-for-field",
    ({ type, ourFile }) => {
      const ourSource = stripComments(readFileSync(ourFile, "utf8"));
      const vendoredSource = VENDORED_PI_RPC_TYPES_DTS_FRAGMENT;

      const vendoredBlock = extractCommandBlock(vendoredSource, type);
      const ourBlock = extractCommandBlock(ourSource, type);

      const vendoredFields = extractFields(vendoredBlock);
      const ourFields = resolveFieldAliases(extractFields(ourBlock), ourSource);

      expect(ourFields).toEqual(vendoredFields);
    },
  );

  it("records that this comparison never opened a socket to any daemon", () => {
    // See the module doc comment and the doc comment on `PiRpcCommand` in
    // rpc-types.ts: the acceptance criterion "exercised against a dev
    // daemon" was NOT satisfied by this task. This assertion exists so a
    // reader who greps this file for that fact finds it stated as a test,
    // not just a comment that can drift unnoticed from the code.
    const source = readFileSync(OUR_RPC_TYPES_PATH, "utf8");
    expect(source).toContain("NONE of the four has been exercised against a");
  });
});

describe("PiSessionState matches the vendored Pi RpcSessionState snapshot (T38B0b)", () => {
  it.each(mirroredStateFields)(
    "%s carries the same value union as the vendored Pi RpcSessionState field",
    (fieldName) => {
      const vendoredField = extractFieldType(VENDORED_PI_RPC_TYPES_DTS_FRAGMENT, fieldName);
      const ourSource = stripComments(readFileSync(OUR_RPC_TYPES_PATH, "utf8"));
      const ourField = extractFieldType(ourSource, fieldName);
      const ourResolvedType = resolveTypeAlias(ourSource, ourField.type);

      // Pi's own `RpcSessionState` declares both fields REQUIRED (verified:
      // `dist/modes/rpc/rpc-types.d.ts`, mirrored verbatim in the
      // vendored fragment above). Our mirror deliberately keeps them
      // optional — see the doc comment on `PiSessionState` in
      // `rpc-types.ts` for why — so only the value union is compared here;
      // the optionality divergence is asserted separately below as a
      // documented, intentional difference rather than left for this check
      // to paper over.
      expect(vendoredField.optional).toBe(false);
      expect(ourResolvedType).toBe(vendoredField.type);
    },
  );

  it("keeps steeringMode and followUpMode optional on our mirror, unlike Pi's required fields (documented divergence)", () => {
    const ourSource = stripComments(readFileSync(OUR_RPC_TYPES_PATH, "utf8"));
    const steeringMode = extractFieldType(ourSource, "steeringMode");
    const followUpMode = extractFieldType(ourSource, "followUpMode");
    expect(steeringMode.optional).toBe(true);
    expect(followUpMode.optional).toBe(true);
  });
});

// --- Layer 2: staleness check of the vendored snapshot itself ---
//
// This block is the ONLY part of this file that can skip, and it skips
// visibly: `describe.skipIf` makes vitest report these cases under its own
// "skipped" count, distinct from "passed" — never silently folded into a
// green summary the way a bare `it(...) { if (!x) return; }` was before
// T99. It answers a different question from Layer 1 above: not "does our
// mirror match what we last verified Pi to declare" (always checked, on
// every machine, including CI) but "has Pi's real, installed declaration
// moved since we last vendored it" (checked only where Pi is installed).
describe.skipIf(!installedPiRpcTypesDtsPath)(
  "the vendored Pi RpcCommand/RpcSessionState snapshot stays honest against the installed Pi CLI (T99 staleness check)",
  () => {
    it.each(mirroredCommands)(
      "$type: vendored snapshot still matches the installed Pi CLI field-for-field",
      ({ type }) => {
        if (!installedPiRpcTypesDtsPath) {
          throw new Error("unreachable: describe.skipIf guards this block");
        }
        const piDts = stripComments(readFileSync(installedPiRpcTypesDtsPath, "utf8"));
        const piFields = extractFields(extractCommandBlock(piDts, type));
        const vendoredFields = extractFields(
          extractCommandBlock(VENDORED_PI_RPC_TYPES_DTS_FRAGMENT, type),
        );

        expect(
          vendoredFields,
          `VENDORED_PI_RPC_TYPES_DTS_FRAGMENT's "${type}" arm has drifted from the installed Pi CLI. ` +
            `Re-read the real .d.ts, update the fragment and bump VENDORED_PI_RPC_TYPES_DTS_VERSION ` +
            `(currently "${VENDORED_PI_RPC_TYPES_DTS_VERSION}") in rpc-types.pi-mirror.contract.test.ts.`,
        ).toEqual(piFields);
      },
    );

    it.each(mirroredStateFields)(
      "%s: vendored RpcSessionState snapshot still matches the installed Pi CLI",
      (fieldName) => {
        if (!installedPiRpcTypesDtsPath) {
          throw new Error("unreachable: describe.skipIf guards this block");
        }
        const piDts = stripComments(readFileSync(installedPiRpcTypesDtsPath, "utf8"));
        const piField = extractFieldType(piDts, fieldName);
        const vendoredField = extractFieldType(VENDORED_PI_RPC_TYPES_DTS_FRAGMENT, fieldName);

        expect(
          vendoredField,
          `VENDORED_PI_RPC_TYPES_DTS_FRAGMENT's RpcSessionState.${fieldName} has drifted from the ` +
            `installed Pi CLI. Re-read the real .d.ts and update the fragment plus ` +
            `VENDORED_PI_RPC_TYPES_DTS_VERSION (currently "${VENDORED_PI_RPC_TYPES_DTS_VERSION}").`,
        ).toEqual(piField);
      },
    );

    it("records the Pi version this snapshot was vendored from, for a human to compare against what's installed", () => {
      // This does not read the installed package.json and assert equality —
      // a version bump with NO field-level drift (the common case) should
      // not fail this test. It exists so a developer investigating a
      // staleness failure above immediately sees which version the
      // snapshot claims to be from.
      expect(VENDORED_PI_RPC_TYPES_DTS_VERSION).toBe("0.84.1");
    });
  },
);
