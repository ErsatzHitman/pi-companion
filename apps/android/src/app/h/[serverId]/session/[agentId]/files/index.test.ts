import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * `index.tsx` source-level check — T331. The route file imports
 * `./[...path]`, which reaches `expo-router` and `react-native`, so it
 * cannot be imported under this workspace's plain `vitest` setup; this
 * mirrors `[...path].test.ts`'s own source-text pattern.
 */
function readCode(relative: string): string {
  const source = readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

describe("files/index.tsx (the files root, beside the catch-all)", () => {
  it("default-exports the catch-all route's own component and nothing else", () => {
    // Whitespace-collapsed: stripping the doc comment leaves blank lines behind.
    const code = readCode("./index.tsx").replace(/\s+/g, " ").trim();
    expect(code).toBe(
      'import SessionFilesRoute from "./[...path]"; export default SessionFilesRoute;',
    );
  });

  it("sits beside a [...path].tsx catch-all that defaults path to [] — the shape Expo Router needs for a wildcard's own root", () => {
    const catchAll = readCode("./[...path].tsx");
    expect(catchAll).toMatch(/export default function SessionFilesRoute\(/);
    expect(catchAll).toMatch(/path=\{path \?\? \[\]\}/);
  });

  it("MUTATION PROOF: the catch-all wildcard alone cannot match its own root (why this file exists)", () => {
    // `expo-router` maps `[...path]` to `*path`, and its forked matcher
    // compiles a `*` part to `((.*\/))` — read from the installed package,
    // not assumed, so an SDK that starts matching zero segments retires
    // this file's reason for being and fails here first.
    const forks = readFileSync(
      fileURLToPath(
        new URL(
          "../../../../../../../../../node_modules/expo-router/build/fork/getStateFromPath-forks.js",
          import.meta.url,
        ),
      ),
      "utf8",
    );
    expect(forks).toMatch(
      /it\.startsWith\('\*'\)\)\s*\{\s*return `\(\(\.\*\\\\\/\)\$\{it\.endsWith\('\?'\) \? '\?' : ''\}\)`/,
    );
    const wildcardOnly = /^(h\/([^/]+\/)session\/([^/]+\/)files\/((.*\/)))$/;
    expect(wildcardOnly.test("h/e2e-host/session/e2e-files-agent/files/src/")).toBe(true);
    expect(wildcardOnly.test("h/e2e-host/session/e2e-files-agent/files/")).toBe(false);
  });
});
