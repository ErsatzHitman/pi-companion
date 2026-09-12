import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Source-level contract for `ApprovalsQuestionForm.tsx` and the
 * `ApprovalsHost.tsx` branch that mounts it.
 *
 * The form imports `react-native`, so it cannot render under this
 * workspace's plain `vitest` — the same limitation `../../ui/recipes/
 * BashBlock.test.ts` documents. What a render would check is instead
 * asserted against the source with comments stripped first, so a claim
 * made only in a doc comment can never satisfy an assertion. The
 * decisions the form renders (which questions are satisfied, when
 * Submit is live, what Submit and Dismiss send) are proven by execution
 * in `approvals-question-model.test.ts`; this file proves only the
 * composition and the wiring `ApprovalsHost` owes it.
 */
function readCode(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

const FORM = "./ApprovalsQuestionForm.tsx";
const HOST = "./ApprovalsHost.tsx";

describe("ApprovalsQuestionForm composition", () => {
  it("renders Dismiss before Submit, and keeps Submit disabled until every required question is answered", () => {
    const code = readCode(FORM);
    expect(code).toMatch(/label=\{panel\.dismissLabel\}/);
    expect(code).toMatch(/onPress=\{\(\) => onAnswer\(panel\.denyResponse\)\}/);
    expect(code).toMatch(/label="Submit"/);
    expect(code).toMatch(/disabled=\{!canSubmit\}/);
    expect(code).toMatch(/const canSubmit = canSubmitQuestionAnswers\(panel\.questions, values\);/);
    // Deny-side first, so nothing defaults a TalkBack user onto Submit.
    expect(code.indexOf("panel.dismissLabel")).toBeLessThan(code.indexOf('label="Submit"'));
  });

  it("prints why Submit is blocked, so the disabled button is never inert without an explanation", () => {
    const code = readCode(FORM);
    expect(code).toMatch(
      /const blockedReason = explainQuestionSubmitBlock\(panel\.questions, values\);/,
    );
    expect(code).toMatch(/\{blockedReason \? \(/);
    expect(code).toMatch(/testID=\{`\$\{formTestId\}-submit-block`\}/);
  });

  it("keys every field by the question's own header, under the same testId vocabulary the web panel uses", () => {
    const code = readCode(FORM);
    expect(code).toMatch(/const formTestId = testId \?\? "approvals-question";/);
    expect(code).toMatch(/testId=\{`\$\{formTestId\}-field-\$\{question\.header\}`\}/);
  });

  it("composes a Select for a single choice, a checkbox row per option for multiSelect, a TextArea for editor and a TextField otherwise", () => {
    const code = readCode(FORM);
    expect(code).toMatch(/if \(question\.options\.length > 0\) \{/);
    expect(code).toMatch(/if \(question\.multiSelect\) \{/);
    expect(code).toMatch(/<MultiSelectField\b/);
    expect(code).toMatch(/<Select\b/);
    expect(code).toMatch(/if \(presentation === "editor"\) \{[\s\S]{0,120}?<TextArea\b/);
    expect(code).toMatch(/<TextField\b/);
  });

  it("adds the free-text override the daemon's allowOther asks for, under `${testId}-other`", () => {
    const code = readCode(FORM);
    expect(code).toMatch(/question\.allowOther \? \(/);
    expect(code).toMatch(/label="Or type your own answer"/);
    expect(code).toMatch(/testId=\{`\$\{testId\}-other`\}/);
  });

  it("gives a multiSelect row a checkbox role, a checked state and a glyph — never a tint alone (plan.md §10.5)", () => {
    const code = readCode(FORM);
    expect(code).toMatch(/accessibilityRole="checkbox"/);
    expect(code).toMatch(/accessibilityState=\{\{ checked \}\}/);
    expect(code).toMatch(/questionOptionGlyph\(checked\)/);
  });

  it("reads every colour, spacing and typography value from useTheme, never a raw hex literal", () => {
    const code = readCode(FORM);
    expect(code).toMatch(/const \{ theme \} = useTheme\(\);/);
    expect(code).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});

describe("ApprovalsHost mounts the question form", () => {
  it("renders ApprovalsQuestionForm for a question panel, keyed by requestId under `${sheetTestId}-question`", () => {
    const host = readCode(HOST);
    expect(host).toMatch(/panel\?\.kind === "question"/);
    expect(host).toMatch(
      /<ApprovalsQuestionForm\s+key=\{current\?\.requestId\}\s+panel=\{panel\}\s+onAnswer=\{onAnswer\}\s+testId=\{`\$\{sheetTestId\}-question`\}/,
    );
  });
});
