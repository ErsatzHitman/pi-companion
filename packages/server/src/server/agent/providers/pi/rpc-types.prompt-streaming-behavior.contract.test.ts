// Contract test for T97.
//
// Proves that `PiRpcCommand`'s "prompt" arm carries `streamingBehavior?`
// exactly as the installed Pi's own `dist/modes/rpc/rpc-types.d.ts`
// `RpcCommand` "prompt" arm declares it:
//
//   streamingBehavior?: "steer" | "followUp";
//
// This test deliberately does NOT reuse the field-for-field whole-block
// comparison `rpc-types.pi-mirror.contract.test.ts` uses for T38A0's four
// commands: doing so for "prompt" would also compare the `images` field,
// and this repo's mirror renames Pi's `ImageContent` to `PiImageContent`
// (see `PiImageContent` in rpc-types.ts) — a deliberate, pre-existing
// rename unrelated to T97 that would make a literal whole-block `toEqual`
// fail for a reason this task does not own. Reconciling that naming (and
// producing the full 35-arm diff) is T99's job, not T97's — T99's own
// section names this exact field ("`prompt` matches Pi's signature") as
// something its audit should read, not re-derive. This test instead checks
// only the field T97 is scoped to: that `streamingBehavior` exists on both
// sides, with the same optionality and the same two literal values.
//
// Like the sibling contract test, this reads a file from the local
// machine's installed Pi CLI and is a no-op (skipped, not failed) when no
// Pi is installed — for example on a CI runner that never installs the
// `pi` CLI. On a machine with Pi installed (this one included) it runs for
// real and fails on drift. It never opens a socket to any daemon.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const OUR_RPC_TYPES_PATH = path.join(__dirname, "rpc-types.ts");
const OUR_RUNTIME_PATH = path.join(__dirname, "runtime.ts");

/**
 * Finds the installed Pi CLI's `rpc-types.d.ts`, or null if none of the
 * candidate locations exist on this machine. Read-only: never writes to,
 * or otherwise modifies, anything under the resolved path. Mirrors the
 * locator in `rpc-types.pi-mirror.contract.test.ts` (kept as a separate
 * small copy here rather than an import, so this file stays a
 * self-contained, independently-removable proof of T97's one claim).
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

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

/**
 * Extracts the flat object-literal block for `type: "prompt"`, tolerant of
 * both the multi-line formatting Pi's `.d.ts` uses and the formatting this
 * file uses. Assumes (true for the "prompt" arm in both files) that the
 * block contains no nested `{}`.
 */
function extractPromptBlock(source: string): string {
  const pattern = /\{[^{}]*type:\s*"prompt"[^{}]*\}/g;
  const matches = source.match(pattern);
  if (!matches || matches.length === 0) {
    throw new Error('no RpcCommand block found for type "prompt"');
  }
  if (matches.length > 1) {
    throw new Error(
      `expected exactly one RpcCommand block for type "prompt", found ${matches.length}`,
    );
  }
  return matches[0];
}

/**
 * Extracts just the `streamingBehavior` field's `?:type` text from a flat
 * `{ field?: type; field2: type2 }` block, or null when the field is
 * absent — the decisive check for T97's claim (as opposed to
 * `rpc-types.pi-mirror.contract.test.ts`'s whole-block comparison, which
 * this test deliberately avoids; see the module doc comment above).
 */
function extractStreamingBehaviorField(block: string): string | null {
  const inner = block.slice(1, -1).trim();
  const withTrailingSemicolon = inner.endsWith(";") ? inner : `${inner};`;
  const match = /\bstreamingBehavior(\?)?:\s*([^;]+);/.exec(withTrailingSemicolon);
  if (!match) return null;
  const [, optional, rawType] = match;
  return `${optional ? "?" : ""}:${rawType.trim()}`;
}

/**
 * Resolves our `PiPromptStreamingBehavior` alias (used at the "prompt" arm's
 * `streamingBehavior` field, matching this file's existing `Pi`-prefixed
 * renames such as `PiImageContent`) to its own declared literal-union RHS,
 * read from `rpc-types.ts` itself rather than assumed, so this comparison
 * stays honest if the alias's definition ever drifts from its own use site.
 */
function resolvePiPromptStreamingBehaviorAlias(fieldText: string, ourSource: string): string {
  const aliasMatch = /export type PiPromptStreamingBehavior = ([^;]+);/.exec(ourSource);
  if (!aliasMatch) {
    throw new Error("PiPromptStreamingBehavior alias not found in rpc-types.ts");
  }
  const aliasRhs = aliasMatch[1].trim();
  return fieldText.replace("PiPromptStreamingBehavior", aliasRhs);
}

const installedPiRpcTypesDtsPath = locateInstalledPiRpcTypesDts();

describe('PiRpcCommand "prompt" arm mirrors Pi\'s streamingBehavior field (T97)', () => {
  it('streamingBehavior matches Pi\'s installed RpcCommand "prompt" arm field-for-field', () => {
    if (!installedPiRpcTypesDtsPath) {
      console.warn(
        '[T97] Skipping live comparison for "prompt".streamingBehavior: no installed Pi CLI ' +
          "was found on this machine (checked PI_RPC_TYPES_D_TS_PATH, %LOCALAPPDATA%\\pi-node, " +
          "and `where`/`which pi`). This check only runs for real where Pi is installed.",
      );
      return;
    }

    const piDts = stripComments(readFileSync(installedPiRpcTypesDtsPath, "utf8"));
    const ourSource = stripComments(readFileSync(OUR_RPC_TYPES_PATH, "utf8"));

    const piField = extractStreamingBehaviorField(extractPromptBlock(piDts));
    const rawOurField = extractStreamingBehaviorField(extractPromptBlock(ourSource));

    // Pi actually declares this field (guards the guard: if Pi ever drops
    // or renames it, this fails loudly instead of both sides silently
    // agreeing on "absent").
    expect(piField).not.toBeNull();
    expect(rawOurField).not.toBeNull();
    const ourField = resolvePiPromptStreamingBehaviorAlias(rawOurField as string, ourSource);
    expect(ourField).toEqual(piField);
  });

  it("resolves PiPromptStreamingBehavior to the same two literal values Pi's inline union uses", () => {
    // rpc-types.ts spells the field as `PiPromptStreamingBehavior` (a named
    // alias, consistent with this file's existing `Pi`-prefixed renames
    // such as `PiImageContent`) rather than repeating Pi's inline
    // `"steer" | "followUp"` at every use site. Prove the alias itself
    // still carries exactly Pi's two literal values, so the string-level
    // comparison above (which resolves through this alias to nothing more
    // than a name) is not the only thing standing between this file and
    // drift.
    const ourSource = readFileSync(OUR_RPC_TYPES_PATH, "utf8");
    expect(ourSource).toContain('export type PiPromptStreamingBehavior = "steer" | "followUp";');
  });
});

describe("PiRuntimeSession.prompt carries the streamingBehavior parameter (T97)", () => {
  // WHY THIS IS A SOURCE-TEXT CHECK AND NOT A TYPE ERROR.
  //
  // `runtime.ts`'s `PiRuntimeSession.prompt()` third parameter is what lets
  // a `PiRuntimeSession`-typed caller (T38B0c) pass a routing choice at
  // all. Nothing else in this repository can fail when it is deleted:
  //
  //  - the runtime behaviour lives in `cli-runtime.ts`'s concrete class,
  //    which TypeScript still accepts as an implementation of the narrower
  //    interface (an implementer may declare extra trailing optional
  //    parameters), so `cli-runtime.test.ts` stays green;
  //  - the one call site that actually passes a third argument
  //    (`cli-runtime.test.ts`'s "forwards a per-message streamingBehavior
  //    choice" case) is never typechecked, because
  //    `packages/server/tsconfig.server.json` excludes `src/**/*.test.ts`
  //    from the project `npm run typecheck --workspace=@picompanion/server`
  //    builds.
  //
  // Verified by mutation before writing this: deleting the parameter (and
  // its now-unused import) from `runtime.ts` left the server typecheck at
  // exit 0 and every server test green. This assertion is the only thing
  // that fails on that mutation, so the hunk stops being a change nothing
  // can falsify.
  it("declares streamingBehavior?: PiPromptStreamingBehavior on the PiRuntimeSession.prompt signature", () => {
    const runtimeSource = stripComments(readFileSync(OUR_RUNTIME_PATH, "utf8"));

    const interfaceStart = runtimeSource.indexOf("export interface PiRuntimeSession");
    expect(interfaceStart).toBeGreaterThanOrEqual(0);
    const promptStart = runtimeSource.indexOf("prompt(", interfaceStart);
    expect(promptStart).toBeGreaterThan(interfaceStart);
    const promptEnd = runtimeSource.indexOf("Promise<PiPromptAck>", promptStart);
    expect(promptEnd).toBeGreaterThan(promptStart);

    const promptSignature = runtimeSource.slice(promptStart, promptEnd);
    expect(promptSignature).toMatch(/streamingBehavior\?:\s*PiPromptStreamingBehavior\s*,?/);
  });
});
