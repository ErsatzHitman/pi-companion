import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * T42A3 source-level coverage for `DiagnosticsScreen.tsx`.
 *
 * `react-native` component modules can't be rendered under this
 * workspace's plain `vitest` setup (this repo's `CLAUDE.md`'s
 * "RN-in-vitest limitation" note) — like `files-screen.test.ts` and
 * `sessions-screen.test.ts`, this statically verifies the source
 * contracts a render pass would otherwise check. The real logic (which
 * sections/fields render, what gets redacted, disconnected behaviour)
 * is unit tested directly in `diagnostics-model.test.ts` and
 * `diagnostics-export.test.ts`.
 */
function readScreenSource(): string {
  return readFileSync(fileURLToPath(new URL("./DiagnosticsScreen.tsx", import.meta.url)), "utf8");
}

/** Comment-stripped, matching `files-screen.test.ts`'s `readScreenCode()` precedent: this file's own doc comments quote several of the strings the assertions below look for. */
function readScreenCode(): string {
  return readScreenSource()
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

describe("DiagnosticsScreen source", () => {
  const source = readScreenSource();
  const code = readScreenCode();

  it("renders every section the live snapshot produces, driven by the model — never a hand-typed section list in the screen itself", () => {
    expect(code).toMatch(/from\s+["']\.\/use-diagnostics-snapshot\.js["']/);
    expect(code).toMatch(/useDiagnosticsSnapshot\(\{/);
    expect(code).toMatch(/sections\.map\(\(section\)\s*=>/);
    // No literal section id/title anywhere in the screen itself.
    expect(code).not.toMatch(/"Connection"/);
    expect(code).not.toMatch(/"Versions"/);
    expect(code).not.toMatch(/"Capabilities"/);
  });

  it("builds the export bundle from the SAME sections it renders, never a second field list", () => {
    expect(code).toMatch(/from\s+["']\.\/use-diagnostics-export\.js["']/);
    expect(code).toMatch(/useDiagnosticsExport\(\{\s*sections,/);
  });

  it("omits the export control entirely when no Sharing is wired, rather than rendering a dead button", () => {
    expect(code).toMatch(/\{sharing\s*\?\s*\(/);
    expect(code).not.toMatch(/Boolean\(sharing\)/);
  });

  it("surfaces a redaction refusal as a visible, danger-toned failure — never a silent no-op", () => {
    expect(code).toMatch(/state\.status === "error"/);
    expect(code).toMatch(/tone="danger"/);
    expect(code).toMatch(/Export failed/);
  });

  it("uses only theme tokens for colour, never a raw hex literal", () => {
    expect(code).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(code).toMatch(/theme\.colors\./);
  });

  it("declares a 48dp field-row touch target", () => {
    const minDimensions = [...code.matchAll(/minHeight:\s*(\d+)\b/g)].map((match) =>
      Number(match[1]),
    );
    expect(minDimensions.length).toBeGreaterThan(0);
    for (const value of minDimensions) {
      expect(value).toBeGreaterThanOrEqual(48);
    }
  });

  it("makes every field value selectable text, since there is no clipboard-copy affordance on this platform yet", () => {
    expect(code).toMatch(/<Text[^>]*\bselectable\b/);
  });

  it("never imports react-native's Clipboard or a raw navigator.clipboard-style API — this screen discloses, rather than fakes, the missing copy affordance", () => {
    expect(code).not.toMatch(/from\s+["']@react-native-clipboard\/clipboard["']/);
    expect(code).not.toMatch(/expo-clipboard/);
  });

  it("composes the shared Section/Button/StatusIndicator primitives rather than hand-rolling them", () => {
    expect(source).toMatch(
      /import\s*\{[^}]*\bButton\b[^}]*\bSection\b[^}]*\bStatusIndicator\b[^}]*\}\s*from\s*"\.\.\/\.\.\/ui\/primitives"/,
    );
    expect(code).toMatch(/<Section\b/);
    expect(code).toMatch(/<Button\b/);
    expect(code).toMatch(/<StatusIndicator\b/);
  });

  it("is mounted by a real route, and says so", () => {
    // CORRECTED (P7-W7 merge gate): this test asserted the opposite —
    // `expect(source).toMatch(/Not mounted anywhere yet/)` — locking in
    // prose that the gate's own route falsified. A test that pins an
    // absence has to be retired by whoever ends the absence, or it fails
    // the commit that fixes the gap.
    expect(source).toMatch(/Mounted at `\/h\/:serverId\/diagnostics`/);
    expect(source).not.toMatch(/\*\*Not mounted anywhere yet\.\*\*/);
  });
});
