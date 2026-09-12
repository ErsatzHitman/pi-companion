import { describe, expect, it } from "vitest";
import type { ReferenceCandidate } from "./references.js";
import {
  detectReferenceToken,
  filterReferenceCandidates,
  findResolvedReferences,
  insertReference,
  loadReferenceCandidates,
  removeReference,
} from "./references.js";

const CANDIDATES: ReferenceCandidate[] = [
  { kind: "file", id: "src/composer/Composer.tsx", label: "src/composer/Composer.tsx" },
  { kind: "file", id: "src/index.ts", label: "src/index.ts" },
  { kind: "skill", id: "review", label: "@review", description: "Review the current diff" },
];

describe("detectReferenceToken", () => {
  it("detects a bare @ at the end of the draft", () => {
    expect(detectReferenceToken("hello @")).toEqual({
      start: 6,
      end: 7,
      query: "",
      kind: null,
    });
  });

  it("detects a token after whitespace and extracts its query", () => {
    expect(detectReferenceToken("look at @src/ind")).toEqual({
      start: 8,
      end: 16,
      query: "src/ind",
      kind: null,
    });
  });

  it("starts the token at the draft start", () => {
    expect(detectReferenceToken("@rev")).toEqual({ start: 0, end: 4, query: "rev", kind: null });
  });

  it("does not treat an email address as a reference", () => {
    expect(detectReferenceToken("mail me@example.com")).toBeNull();
  });

  it("stops at the first space after the @", () => {
    expect(detectReferenceToken("hello @world done")).toBeNull();
    // Caret inside the token still detects it.
    expect(detectReferenceToken("hello @world done", 9)).toEqual({
      start: 6,
      end: 12,
      query: "wo",
      kind: null,
    });
  });

  it("recognizes file: and skill: scopes", () => {
    expect(detectReferenceToken("@file:src")).toEqual({
      start: 0,
      end: 9,
      query: "src",
      kind: "file",
    });
    expect(detectReferenceToken("@skill:rev")).toEqual({
      start: 0,
      end: 10,
      query: "rev",
      kind: "skill",
    });
  });

  it("returns null when the caret is not inside a token", () => {
    expect(detectReferenceToken("plain text", 4)).toBeNull();
  });
});

describe("filterReferenceCandidates", () => {
  it("matches id, label and description substrings", () => {
    const token = { start: 0, end: 4, query: "composer", kind: null } as const;
    expect(filterReferenceCandidates(CANDIDATES, token).map((c) => c.id)).toEqual([
      "src/composer/Composer.tsx",
    ]);
  });

  it("honours a kind scope", () => {
    const token = { start: 0, end: 5, query: "", kind: "skill" } as const;
    expect(filterReferenceCandidates(CANDIDATES, token).map((c) => c.id)).toEqual(["review"]);
  });

  it("sorts id-prefix matches first and respects the limit", () => {
    const token = { start: 0, end: 4, query: "s", kind: null } as const;
    const filtered = filterReferenceCandidates(CANDIDATES, token, { limit: 1 });
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.id).toBe("src/composer/Composer.tsx");
  });
});

describe("insertReference", () => {
  it("replaces the whole token with plain @id text plus a space", () => {
    const token = detectReferenceToken("see @src/ind");
    expect(token).not.toBeNull();
    const insertion = insertReference("see @src/ind", token!, CANDIDATES[0]!);
    expect(insertion.text).toBe("see @src/composer/Composer.tsx ");
    expect(insertion.caret).toBe(insertion.text.length);
  });

  it("uses insertText when a candidate supplies one", () => {
    const token = detectReferenceToken("@rev")!;
    const insertion = insertReference("@rev", token, {
      kind: "skill",
      id: "review",
      label: "@review",
      insertText: "@review --strict",
    });
    expect(insertion.text).toBe("@review --strict ");
  });
});

describe("findResolvedReferences", () => {
  it("finds only tokens that name a known candidate", () => {
    const resolved = findResolvedReferences(
      "review @src/index.ts then @src/nope.ts and @review",
      CANDIDATES,
    );
    expect(resolved.map((entry) => entry.candidate.id)).toEqual(["src/index.ts", "review"]);
  });

  it("ignores an @ inside an email and trailing sentence punctuation", () => {
    expect(findResolvedReferences("me@src/index.ts", CANDIDATES)).toEqual([]);
    expect(
      findResolvedReferences("see @src/index.ts.", CANDIDATES).map((r) => r.candidate.id),
    ).toEqual(["src/index.ts"]);
  });

  it("returns nothing when there are no candidates", () => {
    expect(findResolvedReferences("@src/index.ts", [])).toEqual([]);
  });
});

describe("removeReference", () => {
  it("removes the token and a trailing space", () => {
    const [reference] = findResolvedReferences("see @src/index.ts now", CANDIDATES);
    expect(removeReference("see @src/index.ts now", reference!)).toEqual({
      text: "see now",
      caret: 4,
    });
  });
});

describe("loadReferenceCandidates", () => {
  it("merges files and skills, tolerating a missing source", async () => {
    const merged = await loadReferenceCandidates({
      files: { listFiles: async () => [CANDIDATES[0]!] },
      skills: { listSkills: async () => [CANDIDATES[2]!] },
    });
    expect(merged.map((candidate) => candidate.id)).toEqual([
      "src/composer/Composer.tsx",
      "review",
    ]);
    expect(await loadReferenceCandidates({})).toEqual([]);
  });
});
