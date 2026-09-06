// T89: CI guard — over a commit range, flag any later commit that
// re-introduces text an EARLIER commit in that same range deleted from the
// same file.
//
// This is the exact failure P5-W22's gate caught by hand: `9ac1184`
// ("T32S15: mount /share's disclosed auto-navigation gap; confirm the rest
// of the graph") reconstructed
// `apps/android/e2e/flows/background-kill-restore.contract.test.ts` from a
// stale baseline via git plumbing and silently deleted the exact lines
// `acacff2` ("T75: route text-only composer sends through the real
// OutboxController; fix handleRetry orphaning") had added 4.5 minutes
// earlier, re-adding the pre-T75 `it(...)`/`toMatch(...)` lines verbatim.
// `9ac1184`'s own commit message asserted the reverted hunk was
// "not-yet-committed", which was false at commit time — nothing in the
// pipeline caught it until a human re-read the diff. See
// `guard-no-wave-self-revert.test.mjs`'s "flags the real P5-W22 case" test
// for the exact two SHAs and file, reproduced from `git log`.
//
// The check is deliberately EXACT-LINE, not fuzzy: a later commit's added
// line only counts as a candidate "self-revert" of an earlier commit's
// deleted line when the two are byte-identical (after stripping a trailing
// `\r`). A later edit that merely restores SIMILAR text -- same words,
// different line, different call site, a paraphrase -- does not match and
// is not flagged; see the "does not flag ... restores similar-but-not-
// identical text" test. A very short or punctuation-only line (a bare `}`,
// a blank line) is excluded by `isMeaningfulLine` -- those recur constantly
// across unrelated hunks and would otherwise drown real findings in noise.
//
// Exact-line reintroduction alone is still too weak a signal on this
// repository's real history, though: a dry run of `run-guard-no-wave-self-
// revert.mjs` (no range given, so the whole history) over every commit ever
// made here throws dozens of single-line false positives -- common
// boilerplate (`const client = new FakeAgentTurnClient();`, `useEffect(() =>
// {`, a shared tsconfig `"include"` array entry) that legitimately recurs,
// byte-identical, across unrelated commits touching the same file weeks
// apart. So this guard requires a SECOND, independent signal before it
// flags anything: the reintroducing commit must ALSO delete, from the same
// file, at least one line the SAME earlier commit had added. That is the
// actual shape of "reconstructed a shared file from a stale baseline" -- the
// later commit doesn't just happen to add old text back, it swaps the
// earlier commit's contribution OUT while putting the pre-earlier-commit
// text back IN. The real P5-W22 pair has this shape exactly: `9ac1184`
// both re-added `acacff2`'s two deleted lines AND deleted the four lines
// `acacff2` had added in their place. See `findWaveSelfReverts`'s "does not
// flag a single-line coincidental reintroduction with no accompanying
// delete of the earlier commit's own addition" test for the real false
// positive this closes (`route-tree.test.tsx`'s `const router =
// createRouter({` line, reintroduced by an unrelated oxfmt-formatting
// commit that never deleted anything else the earlier deleting commit had
// added to that file).
//
// A commit whose own message says it is a deliberate revert is never
// flagged for reintroducing text -- see the "does not flag a deliberate
// revert whose message says so" test, modeled on the real `2162ce1`
// ("P5-W22: merge-gate fixes ... un-revert T75") commit that restored
// `acacff2`'s lines a second time, on purpose, after `9ac1184`'s silent
// revert.
//
// That check (`REVERT_MESSAGE_PATTERN`) is deliberately scoped to the
// message's SUBJECT LINE ONLY (its first line), not the full body. Full-
// body matching produced a real false negative against this repository's
// own history while this guard was being built: `9ac1184` -- the actual
// silent-revert commit -- is a long, careful commit message whose body
// happens to describe its OWN, unrelated mutation-testing methodology
// ("... each independently fail a real assertion ...; reverted byte-
// identical afterward"), and `/\brevert(s|ed|ing)?\b/i` matched "reverted"
// there and would have exempted the very commit this guard exists to
// catch. The subject line is the part of a message a human (or `git
// revert`) actually uses to declare intent; see "does not flag a
// deliberate revert whose message says so" for the positive case and "still
// flags a commit whose BODY happens to mention an unrelated revert" for the
// regression this scoping fixes.
//
// Pure, dependency-free check function only. `run-guard-no-wave-self-
// revert.mjs` is the CLI entry point that shells out to git and calls this;
// this module stays import-safe so `guard-no-wave-self-revert.test.mjs` can
// seed synthetic commit histories without touching the real repository or
// spawning git.

/** Lines shorter than this (after trim) are never treated as meaningful -- a bare `}`, `});`, or blank line recurs across unrelated hunks constantly and would drown real findings in noise. */
const MIN_MEANINGFUL_LENGTH = 12;

/** A meaningful line must contain at least one identifier-shaped run of 4+ characters -- excludes pure-punctuation/whitespace lines even if they happen to be long (e.g. a divider comment of dashes). */
const WORD_CONTENT_PATTERN = /[A-Za-z_$][A-Za-z0-9_$]{3,}/;

/** Matches a commit message that says, in its own words, that it is a revert -- "Revert ...", "reverts ...", "reverted ...", "un-revert ..." all match (the hyphen in "un-revert" is a non-word character, so `\brevert\b` still finds "revert" inside it). Applied to the SUBJECT LINE ONLY -- see the module header comment on why. A commit matching this is never flagged for reintroducing text some earlier commit in the range deleted. */
const REVERT_MESSAGE_PATTERN = /\brevert(s|ed|ing)?\b/i;

function normalizeLine(rawLine) {
  return rawLine.replace(/\r$/, "");
}

function isMeaningfulLine(line) {
  const trimmed = line.trim();
  if (trimmed.length < MIN_MEANINGFUL_LENGTH) return false;
  return WORD_CONTENT_PATTERN.test(trimmed);
}

/**
 * @typedef {{ path: string, addedLines: string[], removedLines: string[] }} FileDiff
 * @typedef {{ sha: string, message: string, files: FileDiff[] }} Commit
 * @typedef {{ path: string, line: string, deletedBySha: string, deletedByMessage: string, reintroducedBySha: string, reintroducedByMessage: string }} SelfRevertViolation
 */

/**
 * @param {Commit[]} commits in chronological order, OLDEST first -- the
 *   order a `git rev-list --reverse <range>` walk produces. Each commit
 *   carries the files it touched in that one commit, with the lines it
 *   added and removed from each (order within a file does not matter).
 * @returns {SelfRevertViolation[]} every (deletion, reintroduction) pair
 *   found, in the order the reintroducing commit was encountered. A pair is
 *   only reported when the later commit BOTH reintroduces a line the
 *   earlier commit deleted AND deletes, from the same file, a line the SAME
 *   earlier commit had added -- see the module header comment for why a
 *   bare reintroduction alone is too weak a signal on this repository's
 *   real history.
 */
export function findWaveSelfReverts(commits) {
  /** @type {Map<string, Map<string, { sha: string, message: string, netAddedLines: Set<string> }>>} */
  const deletionsByFile = new Map();
  const violations = [];
  const reportedKeys = new Set();

  for (const commit of commits) {
    const subjectLine = commit.message.split("\n")[0];
    const isDeliberateRevert = REVERT_MESSAGE_PATTERN.test(subjectLine);

    for (const file of commit.files) {
      let deletions = deletionsByFile.get(file.path);
      if (!deletions) {
        deletions = new Map();
        deletionsByFile.set(file.path, deletions);
      }

      // This commit's own NET contribution to the file: a line touched by
      // both a `+` and a `-` within this one commit (e.g. pure
      // reformatting) is net-neutral and counts as neither an addition nor
      // a deletion from the range's point of view.
      const rawAdded = new Set(file.addedLines.map(normalizeLine));
      const rawRemoved = new Set(file.removedLines.map(normalizeLine));
      const netAddedThisCommit = new Set(
        [...rawAdded].filter((line) => isMeaningfulLine(line) && !rawRemoved.has(line)),
      );
      const netRemovedThisCommit = new Set(
        [...rawRemoved].filter((line) => isMeaningfulLine(line) && !rawAdded.has(line)),
      );

      // Check this commit's additions against deletions tracked from
      // STRICTLY EARLIER commits, before this commit's own deletions are
      // folded in below -- a commit can never "self-revert" its own hunk.
      // Reintroducing the line is necessary but not sufficient: this
      // commit must ALSO net-delete, from this same file, at least one
      // line the deleting commit itself had net-added -- the stale-
      // baseline "swap" signature described in the module header.
      if (!isDeliberateRevert) {
        for (const line of netAddedThisCommit) {
          const deletion = deletions.get(line);
          if (!deletion) continue;

          const alsoUndidTheSameCommitsAddition = [...deletion.netAddedLines].some((added) =>
            netRemovedThisCommit.has(added),
          );
          if (!alsoUndidTheSameCommitsAddition) continue;

          const key = `${file.path} ${deletion.sha} ${commit.sha} ${line}`;
          if (reportedKeys.has(key)) continue;
          reportedKeys.add(key);

          violations.push({
            path: file.path,
            line,
            deletedBySha: deletion.sha,
            deletedByMessage: deletion.message,
            reintroducedBySha: commit.sha,
            reintroducedByMessage: commit.message,
          });
        }
      }

      // Fold this commit's own net deletions into the tracker, each
      // stamped with everything this same commit net-added to the file (so
      // a later commit's reintroduction can be checked against it above).
      for (const line of netRemovedThisCommit) {
        deletions.set(line, {
          sha: commit.sha,
          message: commit.message,
          netAddedLines: netAddedThisCommit,
        });
      }
    }
  }

  return violations;
}
