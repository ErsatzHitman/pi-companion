import assert from "node:assert/strict";
import test from "node:test";
import { findWaveSelfReverts } from "./guard-no-wave-self-revert.mjs";

const FILE = "apps/android/e2e/flows/background-kill-restore.contract.test.ts";

// The exact lines from the real P5-W22 history: `acacff2` (T75) deleted the
// pre-T75 `it(...)` and its single `toMatch` regex and added a comment plus
// a renamed `it(...)` with two `toMatch` regexes; `9ac1184` (T32S15) then
// deleted T75's additions and re-added the pre-T75 lines verbatim.
const PRE_T75_IT_LINE =
  '    it("a plain send (no attachments) settles through Promise.resolve().then(onSubmit) straight to markEntryFailed on rejection", () => {';
const PRE_T75_MATCH_LINE =
  "        /const handleSend = useCallback\\(\\(\\) => \\{[\\s\\S]*?attachmentsToSend\\.length > 0[\\s\\S]*?Promise\\.resolve\\(\\)\\.then\\(\\(\\) => onSubmit\\(entryText\\)\\);/,";
const T75_IT_LINE =
  "    it('a plain send (no attachments) reaches sendWithOutbox, which settles a rejected onSubmit(text) to markEntryFailed via \"Not connected to a daemon\"', () => {";
const T75_MATCH_LINE_1 =
  "        /const handleSend = useCallback\\(\\(\\) => \\{[\\s\\S]*?void sendWithOutbox\\(entry\\.id, entry\\.text, attachmentsToSend\\);\\s*\\}, \\[state, generateId, sendWithOutbox\\]\\);/,";
const T75_MATCH_LINE_2 =
  "        /const sendWithOutbox = useCallback\\(\\s*async \\([\\s\\S]*?await onSubmit\\(text\\);/,";
const T75_COMMENT_LINE =
  "    // T75: a plain send now reaches sendWithOutbox instead of settling locally.";

test("flags the real P5-W22 case: 9ac1184 reintroduces the exact lines acacff2 deleted from the same file, naming both commits and the file", () => {
  const commits = [
    {
      sha: "acacff2",
      message:
        "T75: route text-only composer sends through the real OutboxController; fix handleRetry orphaning",
      files: [
        {
          path: FILE,
          removedLines: [PRE_T75_IT_LINE, PRE_T75_MATCH_LINE],
          addedLines: [T75_COMMENT_LINE, T75_IT_LINE, T75_MATCH_LINE_1, T75_MATCH_LINE_2],
        },
      ],
    },
    {
      sha: "9ac1184",
      message:
        "T32S15: mount /share's disclosed auto-navigation gap; confirm the rest of the graph",
      files: [
        {
          path: FILE,
          removedLines: [T75_COMMENT_LINE, T75_IT_LINE, T75_MATCH_LINE_1, T75_MATCH_LINE_2],
          addedLines: [PRE_T75_IT_LINE, PRE_T75_MATCH_LINE],
        },
      ],
    },
  ];

  const violations = findWaveSelfReverts(commits);

  assert.equal(violations.length, 2);
  for (const violation of violations) {
    assert.equal(violation.path, FILE);
    assert.equal(violation.deletedBySha, "acacff2");
    assert.equal(violation.reintroducedBySha, "9ac1184");
  }
  assert.deepEqual(
    violations.map((v) => v.line).sort(),
    [PRE_T75_IT_LINE, PRE_T75_MATCH_LINE].sort(),
  );
});

test("does not flag a deliberate revert whose message says so (the real 2162ce1 'un-revert T75' shape)", () => {
  const commits = [
    {
      sha: "acacff2",
      message: "T75: route text-only composer sends through the real OutboxController",
      files: [{ path: FILE, removedLines: [PRE_T75_IT_LINE], addedLines: [T75_IT_LINE] }],
    },
    {
      sha: "9ac1184",
      message: "T32S15: mount /share's disclosed auto-navigation gap",
      files: [{ path: FILE, removedLines: [T75_IT_LINE], addedLines: [PRE_T75_IT_LINE] }],
    },
    {
      sha: "2162ce1",
      message:
        "P5-W22: merge-gate fixes — stop a download reporting success into nothing, un-revert T75",
      files: [{ path: FILE, removedLines: [PRE_T75_IT_LINE], addedLines: [T75_IT_LINE] }],
    },
  ];

  const violations = findWaveSelfReverts(commits);

  // 9ac1184 -> acacff2 revert is still flagged (its own message says
  // nothing about reverting); only 2162ce1's reintroduction is exempted by
  // its own message.
  assert.equal(violations.length, 1);
  assert.equal(violations[0].reintroducedBySha, "9ac1184");
});

test("still flags a commit whose BODY happens to mention an unrelated revert — only the message's SUBJECT LINE exempts a commit (the real 9ac1184 false-negative this guard was caught producing while it was built)", () => {
  // 9ac1184's real, full commit message body describes its OWN unrelated
  // mutation-testing methodology and happens to contain the word
  // "reverted" ("... each independently fail a real assertion ...;
  // reverted byte-identical afterward"). A full-body match against
  // REVERT_MESSAGE_PATTERN would have wrongly exempted this exact commit —
  // the real silent self-revert this guard exists to catch.
  const bodyMentioningUnrelatedRevert = [
    "T32S15: mount /share's disclosed auto-navigation gap; confirm the rest of the graph",
    "",
    "- Both mounts proven by mutation, not registration: breaking",
    "  hasInitialShare's derivation ... each independently fail a real",
    "  assertion; reverted byte-identical afterward (diff stat matches",
    "  pre-mutation exactly).",
  ].join("\n");

  const commits = [
    {
      sha: "acacff2",
      message: "T75: route text-only composer sends through the real OutboxController",
      files: [{ path: FILE, removedLines: [PRE_T75_IT_LINE], addedLines: [T75_IT_LINE] }],
    },
    {
      sha: "9ac1184",
      message: bodyMentioningUnrelatedRevert,
      files: [{ path: FILE, removedLines: [T75_IT_LINE], addedLines: [PRE_T75_IT_LINE] }],
    },
  ];

  const violations = findWaveSelfReverts(commits);
  assert.equal(violations.length, 1);
  assert.equal(violations[0].reintroducedBySha, "9ac1184");
});

test("does not flag an unrelated edit that restores similar-but-not-identical text elsewhere in the file", () => {
  const commits = [
    {
      sha: "c1",
      message: "T1: remove the old timeout guard",
      files: [
        {
          path: FILE,
          removedLines: ["    const timeoutMs = computeRetryTimeoutMs(attempt, baseDelayMs);"],
          addedLines: [],
        },
      ],
    },
    {
      sha: "c2",
      message: "T2: add a similar-looking but distinct timeout guard elsewhere in the same file",
      files: [
        {
          path: FILE,
          removedLines: [],
          addedLines: ["    const timeoutMs = computeRetryTimeoutMs(attempt, maxDelayMs);"],
        },
      ],
    },
  ];

  assert.deepEqual(findWaveSelfReverts(commits), []);
});

test("does not flag a line deleted and re-added within the SAME commit", () => {
  const commits = [
    {
      sha: "c1",
      message: "T1: reformat a block, no semantic change",
      files: [
        {
          path: FILE,
          removedLines: ["    const handleSend = useCallback(() => {"],
          addedLines: ["    const handleSend = useCallback(() => {"],
        },
      ],
    },
    {
      sha: "c2",
      message: "T2: unrelated later commit that happens to add the same line back",
      files: [
        {
          path: FILE,
          removedLines: [],
          addedLines: ["    const handleSend = useCallback(() => {"],
        },
      ],
    },
  ];

  // c1's deletion was net-neutral (added back in the same commit), so it
  // was never tracked as a deletion — c2's addition has nothing to match.
  assert.deepEqual(findWaveSelfReverts(commits), []);
});

test("does not flag trivial short/punctuation-only lines even inside an otherwise-real swap (isolates isMeaningfulLine from the swap-signature check — a hollow-check trap: the swap signature alone would otherwise let this pass for the unrelated reason that the trivial line has no companion to swap against)", () => {
  const commits = [
    {
      sha: "c1",
      message: "T1: remove a closing brace and a real statement, add a real replacement",
      files: [
        {
          path: FILE,
          removedLines: ["}", PRE_T75_MATCH_LINE],
          addedLines: [T75_MATCH_LINE_1],
        },
      ],
    },
    {
      sha: "c2",
      message: "T2: swap T1's real addition back out, reintroducing both lines it deleted",
      files: [
        {
          path: FILE,
          removedLines: [T75_MATCH_LINE_1],
          addedLines: ["}", PRE_T75_MATCH_LINE],
        },
      ],
    },
  ];

  // The full swap signature is present for BOTH deleted lines (c2 deletes
  // T1's own addition either way) — only isMeaningfulLine's length/word-
  // content floor keeps the bare "}" out of the result; the real
  // PRE_T75_MATCH_LINE is still correctly flagged.
  const violations = findWaveSelfReverts(commits);
  assert.deepEqual(
    violations.map((v) => v.line),
    [PRE_T75_MATCH_LINE],
  );
});

test("does not flag a reintroduction in a DIFFERENT file even when the deleting commit touched a same-named file elsewhere", () => {
  const otherFile = "apps/android/src/features/composer/Composer.tsx";
  const commits = [
    {
      sha: "c1",
      message: "T1: delete a line from file A",
      files: [{ path: FILE, removedLines: [PRE_T75_IT_LINE], addedLines: [] }],
    },
    {
      sha: "c2",
      message: "T2: add the same line to a different file B — not a self-revert of A",
      files: [{ path: otherFile, removedLines: [], addedLines: [PRE_T75_IT_LINE] }],
    },
  ];

  assert.deepEqual(findWaveSelfReverts(commits), []);
});

test("does not flag when the reintroducing commit comes BEFORE the deleting commit in the given order", () => {
  // findWaveSelfReverts trusts the caller's chronological (oldest-first)
  // ordering; a line added first and deleted second is an ordinary
  // deletion, not a self-revert, and must not be flagged.
  const commits = [
    {
      sha: "c1",
      message: "T1: add a line",
      files: [{ path: FILE, removedLines: [], addedLines: [PRE_T75_IT_LINE] }],
    },
    {
      sha: "c2",
      message: "T2: delete that same line later — ordinary deletion",
      files: [{ path: FILE, removedLines: [PRE_T75_IT_LINE], addedLines: [] }],
    },
  ];

  assert.deepEqual(findWaveSelfReverts(commits), []);
});

test("does not report the same (deletion, reintroduction) pair twice even if the line appears duplicated in both diffs", () => {
  const commits = [
    {
      sha: "c1",
      // A duplicated removedLines entry (git diff output does not
      // deduplicate) alongside a real net addition, so this commit still
      // carries the swap signature the guard requires.
      message: "T1: delete a duplicated line twice in one file",
      files: [
        {
          path: FILE,
          removedLines: [PRE_T75_IT_LINE, PRE_T75_IT_LINE],
          addedLines: [T75_IT_LINE],
        },
      ],
    },
    {
      sha: "c2",
      message: "T2: reintroduce it, undoing c1's own addition",
      files: [{ path: FILE, removedLines: [T75_IT_LINE], addedLines: [PRE_T75_IT_LINE] }],
    },
  ];

  const violations = findWaveSelfReverts(commits);
  assert.equal(violations.length, 1);
});

test("requires the swap signature: a bare single-line reintroduction with NO accompanying delete of the earlier commit's own addition is not flagged (models the real route-tree.test.tsx false positive this signature closes)", () => {
  const commits = [
    {
      sha: "f00edd4",
      message: "T30A2: build the xterm terminal route",
      files: [
        {
          path: "apps/web/src/routes/route-tree.test.tsx",
          removedLines: ["    const router = createRouter({"],
          // f00edd4 adds unrelated new setup lines of its own — nothing
          // that the later commit will delete.
          addedLines: ["    const terminalRoute = createRoute({"],
        },
      ],
    },
    {
      sha: "1c3819d",
      message: "T27A1: fix oxfmt formatting regressions in connect form and route tests",
      files: [
        {
          path: "apps/web/src/routes/route-tree.test.tsx",
          // A pure reformat: reintroduces the old router-construction line
          // (coincidence — it happens to match byte-for-byte) but never
          // deletes `terminalRoute`, f00edd4's own addition.
          removedLines: [],
          addedLines: ["    const router = createRouter({"],
        },
      ],
    },
  ];

  assert.deepEqual(findWaveSelfReverts(commits), []);
});
