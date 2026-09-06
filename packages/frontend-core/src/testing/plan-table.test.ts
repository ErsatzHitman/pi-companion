import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  extractMarkdownTableAfterHeading,
  parseSection117BridgeElementsTable,
} from "./plan-table.js";

/**
 * `plan-table.ts` stays `node:fs`-free (see its doc comment), so this
 * `.test.ts` file — which, unlike that module, is excluded from this
 * package's strict `tsc` build and so is free to use Node builtins, per
 * `../import-guard.test.ts`'s own precedent — does the actual disk read
 * and hands the parser plain text.
 */
function findRepoRoot(startDir: string): string {
  let dir = startDir;
  for (let hops = 0; hops < 12; hops += 1) {
    if (existsSync(join(dir, "plan.md"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`findRepoRoot: could not locate plan.md by walking up from ${startDir}`);
}

function loadRealPlanMarkdown(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const repoRoot = findRepoRoot(here);
  return readFileSync(join(repoRoot, "plan.md"), "utf8");
}

describe("extractMarkdownTableAfterHeading", () => {
  const SAMPLE = [
    "Some prose before the heading.",
    "",
    "**A table heading:**",
    "",
    "| Col A | Col B |",
    "| --- | --- |",
    "| `one` | first |",
    "| `two` | second |",
    "",
    "Prose after the table.",
  ].join("\n");

  it("parses the data rows following the heading, excluding header and separator", () => {
    expect(extractMarkdownTableAfterHeading(SAMPLE, "**A table heading:**")).toEqual([
      ["`one`", "first"],
      ["`two`", "second"],
    ]);
  });

  it("throws loudly — not an empty array — when the heading does not occur at all", () => {
    const noHeading = SAMPLE.replace("**A table heading:**", "**A different heading:**");
    expect(() => extractMarkdownTableAfterHeading(noHeading, "**A table heading:**")).toThrow(
      /heading .* was not found/,
    );
  });

  it("throws loudly — not an empty array — when the heading exists but no table follows it", () => {
    const noTable = ["**A table heading:**", "", "Just a sentence, no table here.", ""].join("\n");
    expect(() => extractMarkdownTableAfterHeading(noTable, "**A table heading:**")).toThrow(
      /no markdown table/,
    );
  });

  it("throws loudly when the table has a header but zero data rows", () => {
    const emptyTable = ["**A table heading:**", "", "| Col A | Col B |", "| --- | --- |", ""].join(
      "\n",
    );
    expect(() => extractMarkdownTableAfterHeading(emptyTable, "**A table heading:**")).toThrow(
      /zero data rows/,
    );
  });

  it("throws loudly when the line after the header is not a separator row", () => {
    const malformed = [
      "**A table heading:**",
      "",
      "| Col A | Col B |",
      "| `one` | first |",
      "",
    ].join("\n");
    expect(() => extractMarkdownTableAfterHeading(malformed, "**A table heading:**")).toThrow(
      /separator row/,
    );
  });
});

describe("parseSection117BridgeElementsTable", () => {
  it("parses the real plan.md's §11.7 table into exactly twelve rows", () => {
    const rows = parseSection117BridgeElementsTable(loadRealPlanMarkdown());
    expect(rows).toHaveLength(12);
    expect(rows).toEqual(
      expect.arrayContaining([
        { extension: "loop", requiredUi: expect.stringContaining("panel containing status") },
        { extension: "ask-user", requiredUi: expect.stringContaining("rich form with search") },
      ]),
    );
    expect(rows.map((row) => row.extension).sort()).toEqual(
      [
        "advisor",
        "ask-user",
        "btw",
        "loop",
        "minimal-status",
        "pi-goal",
        "plan-mode",
        "prompt-arbitrage",
        "subagents",
        "switchboard",
        "todo",
        "workflows",
      ].sort(),
    );
  });

  it("fails loudly (throws), rather than reporting zero rows, when pointed at markdown with no §11.7 table — proves the parser cannot pass vacuously", () => {
    const noTableMarkdown = "# Some other document\n\nNothing resembling §11.7 here.\n";
    expect(() => parseSection117BridgeElementsTable(noTableMarkdown)).toThrow(/was not found/);
  });

  it("fails loudly when pointed at a real file with no §11.7 table in it (this package's own README)", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const repoRoot = findRepoRoot(here);
    const readmeContent = readFileSync(join(repoRoot, "README.md"), "utf8");
    expect(() => parseSection117BridgeElementsTable(readmeContent)).toThrow(/was not found/);
  });

  it("fails loudly when a row's Extension cell is not wrapped in backticks", () => {
    const badRow = [
      "**First-class UI through bridge elements:**",
      "",
      "| Extension | Required UI |",
      "| --- | --- |",
      "| loop | panel |",
      "",
    ].join("\n");
    expect(() => parseSection117BridgeElementsTable(badRow)).toThrow(/not wrapped in backticks/);
  });
});
