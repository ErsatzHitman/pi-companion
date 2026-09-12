import { describe, expect, it } from "vitest";

import type { permissions } from "@picompanion/frontend-core";

import {
  buildQuestionAnswers,
  buildQuestionSubmitResponse,
  canSubmitQuestionAnswers,
  describeQuestionOptionLabel,
  explainQuestionPanelDetail,
  explainQuestionSubmitBlock,
  hasQuestionValue,
  initialQuestionValues,
  isQuestionAnswered,
  questionOptionGlyph,
  questionPanelDismissLabel,
  toggleMultiSelectQuestionValue,
  unansweredQuestionHeaders,
  type ApprovalQuestionValues,
} from "./approvals-question-model.js";

/**
 * The Android counterpart of `apps/web/src/features/approvals/
 * PermissionDialog.test.tsx`'s "question presentation" coverage, moved
 * down one level: the web file clicks a rendered `<select>`; this
 * workspace's plain `vitest` cannot parse `react-native`, so the same
 * decisions — what a draft answer is worth, when Submit is live, what
 * Submit sends, and what a dismiss sends — are asserted against the
 * pure functions `ApprovalsQuestionForm.tsx` is a shell over
 * (`approvals-question-model.ts`). The form's own composition is proven
 * separately, source-level, in `ApprovalsQuestionForm.test.ts`.
 */

function question(
  overrides: Partial<permissions.PermissionDialogQuestion> & { header: string },
): permissions.PermissionDialogQuestion {
  return {
    question: `Question ${overrides.header}`,
    options: [],
    multiSelect: false,
    ...overrides,
  };
}

/** The two-question combined `ask_user` dialog: a required select plus an optional comment (`agent.ts`'s own shape). */
const COMBINED_ASK_USER: permissions.PermissionDialogQuestion[] = [
  question({
    header: "Response",
    question: "Choose an environment",
    options: [{ label: "staging" }, { label: "production" }],
    allowOther: true,
  }),
  question({
    header: "Comment",
    question: "Optional comment",
    placeholder: "Optional comment (press Enter to skip)...",
    allowEmpty: true,
  }),
];

describe("initialQuestionValues", () => {
  it("seeds an empty draft per header — [] for a multiSelect question, '' for every other", () => {
    const values = initialQuestionValues([
      question({ header: "a" }),
      question({ header: "b", multiSelect: true, options: [{ label: "x" }] }),
    ]);
    expect(values).toEqual({ a: "", b: [] });
  });

  it("keys by the question's own header, not by position or question text", () => {
    const values = initialQuestionValues([
      question({ header: "Response", question: "Choose one" }),
      question({ header: "Comment", question: "Choose one" }),
    ]);
    expect(Object.keys(values)).toEqual(["Response", "Comment"]);
  });

  it("is empty for a request with no questions", () => {
    expect(initialQuestionValues([])).toEqual({});
  });
});

describe("hasQuestionValue", () => {
  it("treats blank text, whitespace-only text and an empty selection as unanswered", () => {
    expect(hasQuestionValue(undefined)).toBe(false);
    expect(hasQuestionValue("")).toBe(false);
    expect(hasQuestionValue("   ")).toBe(false);
    expect(hasQuestionValue([])).toBe(false);
  });

  it("treats any non-blank text or at least one chosen option as answered", () => {
    expect(hasQuestionValue("main")).toBe(true);
    expect(hasQuestionValue(["main"])).toBe(true);
  });
});

describe("submit gating (plan.md §12.3: no submit until every required question is answered)", () => {
  it("leaves Submit blocked while a required text question is blank, and names what is missing", () => {
    const questions = [question({ header: "Response" })];
    const values = initialQuestionValues(questions);
    expect(isQuestionAnswered(questions[0]!, values.Response)).toBe(false);
    expect(canSubmitQuestionAnswers(questions, values)).toBe(false);
    expect(unansweredQuestionHeaders(questions, values)).toEqual(["Response"]);
    expect(explainQuestionSubmitBlock(questions, values)).toBe(
      "Answer the remaining question before submitting.",
    );
  });

  it("counts every still-blank required question in the explanation", () => {
    const questions = [question({ header: "a" }), question({ header: "b" })];
    const values = initialQuestionValues(questions);
    expect(explainQuestionSubmitBlock(questions, values)).toBe(
      "Answer the remaining 2 questions before submitting.",
    );
  });

  it("lets an allowEmpty question stay blank — the combined ask_user dialog's optional comment — and clears the explanation", () => {
    const values: ApprovalQuestionValues = {
      ...initialQuestionValues(COMBINED_ASK_USER),
      Response: "staging",
    };
    expect(isQuestionAnswered(COMBINED_ASK_USER[1]!, values.Comment)).toBe(true);
    expect(unansweredQuestionHeaders(COMBINED_ASK_USER, values)).toEqual([]);
    expect(canSubmitQuestionAnswers(COMBINED_ASK_USER, values)).toBe(true);
    expect(explainQuestionSubmitBlock(COMBINED_ASK_USER, values)).toBeNull();
  });

  it("keeps Submit blocked for a blank required select and for an empty multiSelect, and unblocks each once answered", () => {
    const select = [question({ header: "branch", options: [{ label: "main" }] })];
    expect(canSubmitQuestionAnswers(select, { branch: "" })).toBe(false);
    expect(canSubmitQuestionAnswers(select, { branch: "main" })).toBe(true);

    const multi = [
      question({ header: "tags", multiSelect: true, options: [{ label: "a" }, { label: "b" }] }),
    ];
    expect(canSubmitQuestionAnswers(multi, { tags: [] })).toBe(false);
    expect(canSubmitQuestionAnswers(multi, { tags: ["a"] })).toBe(true);
  });

  it("does not gate a request with no questions at all (the Dismiss-only fallback is resolved before this module sees it)", () => {
    expect(canSubmitQuestionAnswers([], {})).toBe(true);
    expect(explainQuestionSubmitBlock([], {})).toBeNull();
  });
});

describe("the response Submit sends", () => {
  it("keys a single choice by the question's own header, exactly as the web panel does", () => {
    const questions = [
      question({
        header: "Response",
        options: [{ label: "staging" }, { label: "production" }],
      }),
    ];
    expect(buildQuestionAnswers(questions, { Response: "production" })).toEqual({
      Response: "production",
    });
    expect(buildQuestionSubmitResponse(questions, { Response: "production" })).toEqual({
      behavior: "allow",
      updatedInput: { answers: { Response: "production" } },
    });
  });

  it("joins a multiSelect answer with ', '", () => {
    const questions = [
      question({ header: "tags", multiSelect: true, options: [{ label: "a" }, { label: "b" }] }),
    ];
    expect(buildQuestionSubmitResponse(questions, { tags: ["a", "b"] })).toEqual({
      behavior: "allow",
      updatedInput: { answers: { tags: "a, b" } },
    });
  });

  it("sends an empty string for an unanswered optional question rather than dropping its header", () => {
    const values: ApprovalQuestionValues = {
      ...initialQuestionValues(COMBINED_ASK_USER),
      Response: "staging",
    };
    expect(buildQuestionSubmitResponse(COMBINED_ASK_USER, values)).toEqual({
      behavior: "allow",
      updatedInput: { answers: { Response: "staging", Comment: "" } },
    });
  });

  it("answers every question of a two-question ask_user dialog in one response, including a free-text override", () => {
    const values = { Response: "a custom branch", Comment: "because" };
    expect(buildQuestionSubmitResponse(COMBINED_ASK_USER, values)).toEqual({
      behavior: "allow",
      updatedInput: { answers: { Response: "a custom branch", Comment: "because" } },
    });
  });
});

describe("toggleMultiSelectQuestionValue", () => {
  it("adds an option that is not selected and removes one that is", () => {
    expect(toggleMultiSelectQuestionValue([], "a")).toEqual(["a"]);
    expect(toggleMultiSelectQuestionValue(["a"], "b")).toEqual(["a", "b"]);
    expect(toggleMultiSelectQuestionValue(["a", "b"], "a")).toEqual(["b"]);
  });

  it("treats a non-array draft (an untouched single-select value) as an empty selection rather than throwing", () => {
    expect(toggleMultiSelectQuestionValue("main", "main")).toEqual(["main"]);
    expect(toggleMultiSelectQuestionValue(undefined, "main")).toEqual(["main"]);
  });
});

describe("questionOptionGlyph", () => {
  it("is two distinct marks, not one tint — the non-colour state signal (plan.md §10.5)", () => {
    expect(questionOptionGlyph(true)).toBe("✓");
    expect(questionOptionGlyph(false)).toBe("○");
    expect(questionOptionGlyph(true)).not.toBe(questionOptionGlyph(false));
  });
});

describe("describeQuestionOptionLabel", () => {
  it("appends a description to the label, matching the web panel's own option text", () => {
    expect(describeQuestionOptionLabel({ label: "main" })).toBe("main");
    expect(describeQuestionOptionLabel({ label: "main", description: "the default branch" })).toBe(
      "main — the default branch",
    );
  });
});

describe("explainQuestionPanelDetail / questionPanelDismissLabel", () => {
  function view(
    overrides: Partial<permissions.PermissionDialogViewModel>,
  ): permissions.PermissionDialogViewModel {
    return {
      requestId: "req_1",
      agentId: "agt_1",
      provider: "pi",
      name: "Pi select",
      kind: "question",
      presentation: "select",
      extensionUiMethod: "select",
      actions: [],
      questions: [],
      metadata: {},
      raw: { id: "req_1", provider: "pi", name: "Pi select", kind: "question" },
      ...overrides,
    };
  }

  it("is the first question's own text when there is one", () => {
    expect(explainQuestionPanelDetail(view({ questions: COMBINED_ASK_USER }))).toBe(
      "Choose an environment",
    );
  });

  it("falls back to the description, then the title, then the name", () => {
    expect(explainQuestionPanelDetail(view({ description: "A description" }))).toBe(
      "A description",
    );
    expect(explainQuestionPanelDetail(view({ title: "A title" }))).toBe("A title");
    expect(explainQuestionPanelDetail(view({ name: "Pi select" }))).toBe("Pi select");
  });

  it("defaults the dismiss wording to Cancel and honours the first daemon-supplied dismissLabel", () => {
    expect(questionPanelDismissLabel(view({ questions: COMBINED_ASK_USER }))).toBe("Cancel");
    expect(
      questionPanelDismissLabel(
        view({
          questions: [
            question({ header: "Response", allowEmpty: true, dismissLabel: "Skip" }),
            question({ header: "Comment", dismissLabel: "Later" }),
          ],
        }),
      ),
    ).toBe("Skip");
  });
});
