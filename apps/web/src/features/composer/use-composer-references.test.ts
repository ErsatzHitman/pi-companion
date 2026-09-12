import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { composer as coreComposer } from "@picompanion/frontend-core";

import { useComposerReferences } from "./use-composer-references.js";

const SKILLS: coreComposer.ReferenceCandidate[] = [
  { kind: "skill", id: "review", label: "@review", description: "Review the current diff" },
  { kind: "skill", id: "release", label: "@release", description: "Cut a release" },
];

const FILE: coreComposer.ReferenceCandidate = {
  kind: "file",
  id: "src/index.ts",
  label: "src/index.ts",
};

interface HookInput {
  draftText: string;
  caret?: number;
  files?: coreComposer.ReferenceFileSource;
  skills?: readonly coreComposer.ReferenceCandidate[];
}

function renderReferences(initial: HookInput) {
  return renderHook(
    (props: HookInput) =>
      useComposerReferences({
        draftText: props.draftText,
        caret: props.caret ?? props.draftText.length,
        files: props.files,
        skills: props.skills ?? [],
      }),
    { initialProps: initial },
  );
}

describe("useComposerReferences", () => {
  it("detects an open @ token and offers the skills it was given", () => {
    const { result } = renderReferences({ draftText: "please @", skills: SKILLS });
    expect(result.current.token).toEqual({ start: 7, end: 8, query: "", kind: null });
    expect(result.current.isOpen).toBe(true);
    expect(result.current.candidates.map((candidate) => candidate.id)).toEqual([
      "release",
      "review",
    ]);
  });

  it("filters as the query grows and closes once the token ends", () => {
    const { result, rerender } = renderReferences({ draftText: "@rev", skills: SKILLS });
    expect(result.current.candidates.map((candidate) => candidate.id)).toEqual(["review"]);

    rerender({ draftText: "@rev ", caret: 5, skills: SKILLS });
    expect(result.current.token).toBeNull();
    expect(result.current.isOpen).toBe(false);
  });

  it("loads file candidates lazily, on the first open token only", async () => {
    const listFiles = vi.fn(async () => [FILE]);
    const files = { listFiles };
    const { result, rerender } = renderReferences({
      draftText: "no reference here",
      files,
      skills: SKILLS,
    });
    expect(listFiles).not.toHaveBeenCalled();

    rerender({ draftText: "@src", caret: 4, files, skills: SKILLS });
    await waitFor(() => expect(listFiles).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(result.current.candidates.map((candidate) => candidate.id)).toEqual(["src/index.ts"]),
    );

    // A later token reuses the cached result instead of walking again.
    rerender({ draftText: "@src/i", caret: 6, files, skills: SKILLS });
    await waitFor(() => expect(listFiles).toHaveBeenCalledTimes(1));
  });

  it("moves the highlight and returns a plain-text insertion for the chosen candidate", () => {
    const { result, rerender } = renderReferences({ draftText: "see @", skills: SKILLS });

    act(() => result.current.moveActive(1));
    expect(result.current.activeCandidate?.id).toBe("review");

    const insertion = result.current.choose();
    expect(insertion).toEqual({ text: "see @review ", caret: 12 });

    // The rewritten draft no longer contains an open token, so the list closes.
    rerender({ draftText: insertion!.text, caret: insertion!.caret, skills: SKILLS });
    expect(result.current.isOpen).toBe(false);
  });

  it("resolves references already present in the draft", async () => {
    const { result } = renderReferences({
      draftText: "review @review then @src/index.ts",
      files: { listFiles: async () => [FILE] },
      skills: SKILLS,
    });
    await waitFor(() =>
      expect(result.current.resolved.map((entry) => entry.candidate.id)).toEqual([
        "review",
        "src/index.ts",
      ]),
    );
  });

  it("dismisses on request and reports nothing to choose with no candidates", () => {
    const { result, rerender } = renderReferences({ draftText: "@x", skills: [] });
    expect(result.current.isOpen).toBe(false);
    expect(result.current.choose()).toBeNull();

    rerender({ draftText: "@", caret: 1, skills: SKILLS });
    expect(result.current.isOpen).toBe(true);
    act(() => result.current.dismiss());
    expect(result.current.isOpen).toBe(false);
  });
});
