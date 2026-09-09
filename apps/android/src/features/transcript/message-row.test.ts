import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * `message-row.tsx` imports `react-native` (via `../../ui/recipes`'s
 * `StreamingMessage`), which cannot be rendered under this workspace's
 * plain `vitest` setup — see `./transcript-accessibility.test.ts`'s doc
 * comment for the identical constraint and the `readCode()` pattern this
 * file copies. All real logic (`speakerFor`, `boundedText`,
 * `areMessageRowPropsEqual`) already has render-free proof in
 * `./message-row-model.test.ts`; this file only proves the .tsx actually
 * wires that logic into the render tree and the `memo` boundary, rather
 * than, say, silently duplicating or dropping it.
 */
function readSource(): string {
  return readFileSync(fileURLToPath(new URL("./message-row.tsx", import.meta.url)), "utf8");
}

function readCode(): string {
  return readSource()
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

describe("message-row.tsx: composes StreamingMessage from the model's mapping, not a private one", () => {
  it("passes speakerFor(entry) as the speaker prop", () => {
    expect(readCode()).toMatch(/speaker=\{speakerFor\(entry\)\}/);
  });

  it("passes boundedText(entry.text) as the text prop, not entry.text directly", () => {
    expect(readCode()).toMatch(/text=\{boundedText\(entry\.text\)\}/);
  });

  it("forwards the streaming prop unchanged", () => {
    expect(readCode()).toMatch(/streaming=\{streaming\}/);
  });
});

describe("message-row.tsx: memoized on the model's comparator", () => {
  it("wraps the row in memo(..., areMessageRowPropsEqual) — never a bare memo() with default shallow-prop comparison", () => {
    expect(readCode()).toMatch(
      /export const TranscriptMessageRow = memo\(\s*TranscriptMessageRowImpl,\s*areMessageRowPropsEqual,?\s*\)/,
    );
  });
});

describe("message-row.tsx: T33A5 renders entry.images via MessageAttachments", () => {
  it("composes MessageAttachments with the entry's images, entryId, and speaker", () => {
    const source = readCode();
    expect(source).toMatch(/<MessageAttachments\b/);
    expect(source).toMatch(/images=\{images\}/);
    expect(source).toMatch(/entryId=\{entry\.id\}/);
    expect(source).toMatch(/speaker=\{speakerFor\(entry\)\}/);
  });

  it("derives images from entry.images with a safe fallback (never crashes on an entry with no images)", () => {
    expect(readCode()).toMatch(/const images = entry\.images \?\? \[\]/);
  });

  // T284: proves the .tsx actually forwards resolveImageUri, not just
  // that TranscriptMessageRowProps declares it — a strip-comments source
  // match, same discipline every other assertion in this file uses.
  it("destructures resolveImageUri from props and forwards it unchanged to MessageAttachments", () => {
    const source = readCode();
    expect(source).toMatch(
      /function TranscriptMessageRowImpl\(\{[\s\S]*?resolveImageUri[\s\S]*?\}: TranscriptMessageRowProps\)/,
    );
    expect(source).toMatch(/resolveImageUri=\{resolveImageUri\}/);
  });
});

describe("message-row.tsx: T308 renders the message's local time beneath it", () => {
  it("takes the label from the model's timestampLabelFor, never formatting a date inline", () => {
    const source = readCode();
    expect(source).toMatch(/const stamp = timestampLabelFor\(entry\)/);
    // A second, private formatter here is the web/Android drift T308 exists
    // to prevent — so no `Intl`, `toLocale*`, or hand-built date string may
    // appear in this file at all.
    expect(source).not.toMatch(/Intl\./);
    expect(source).not.toMatch(/toLocale(Time|Date)String/);
    expect(source).not.toMatch(/getHours\(\)|getMinutes\(\)/);
  });

  it("renders the label inside a Text, guarded so a null label renders nothing", () => {
    const source = readCode();
    expect(source).toMatch(/\{stamp \? \(/);
    expect(source).toMatch(/<Text[\s\S]*?\{stamp\.text\}[\s\S]*?<\/Text>/);
  });

  it("imports Text from react-native rather than reaching for a web element", () => {
    expect(readCode()).toMatch(/import \{ StyleSheet, Text, View \} from "react-native"/);
  });

  it("exposes the full dated time as the accessible name, since the visible label may omit the date", () => {
    expect(readCode()).toMatch(/accessibilityLabel=\{stamp\.title\}/);
  });

  it("suffixes the row's testId for the timestamp, matching web's -timestamp convention", () => {
    expect(readCode()).toMatch(/testID=\{testId \? `\$\{testId\}-timestamp` : undefined\}/);
  });

  it("has ONE return path, so the timestamp cannot be rendered in one branch and forgotten in the other", () => {
    const source = readCode();
    // The pre-T308 shape returned a bare `StreamingMessage` early when the
    // entry had no images, then a second tree with them. Both trees now have
    // to carry the timestamp, and two of them is how they drift — so the
    // component body has exactly one `return`.
    const returns = source.match(/^\s{2}return \(/gm) ?? [];
    expect(returns).toHaveLength(1);
    expect(source).not.toMatch(/if \(images\.length === 0\)/);
    // …and the attachments are now conditional inside that single tree.
    expect(source).toMatch(/\{images\.length > 0 \? \(/);
  });

  it("styles the timestamp from theme tokens, never a raw colour or size", () => {
    const source = readCode();
    expect(source).toMatch(/timestamp: \{[\s\S]*?color: theme\.colors\["ink-3"\]/);
    expect(source).toMatch(
      /timestamp: \{[\s\S]*?fontSize: theme\.typography\.variant\.caption\.fontSize/,
    );
  });
});
