/**
 * T37E8 — proves every testId/label `../../maestro/offline-cache-
 * outbox.yaml` names still exists in the real source it targets, and
 * proves two disclosed gaps directly against real, RN-free code — this
 * flow's only proof today, since there is no emulator, device, or
 * Maestro binary in this wave (see that flow file's own header
 * comment).
 *
 * Three proof strategies, chosen per module, same split
 * `pairing.contract.test.ts`/`notification-approval.contract.test.ts`
 * already document for this directory:
 *
 * - `composer-model.ts` and `@picompanion/frontend-core`'s
 *   `composer.OutboxController` are RN-free, so this file imports both
 *   directly and drives them against scripted in-memory doubles — no
 *   source-text match needed for that half.
 * - `Composer.tsx` and `session/[agentId]/index.tsx` both reach
 *   `react-native` and cannot be imported under this workspace's plain
 *   `vitest` (`CLAUDE.md`'s "RN-in-vitest limitation" note), so those
 *   are proven with `readCode()` — comment-stripped source matched
 *   against a full JSX/statement expression, never a bare identifier
 *   (`CLAUDE.md`'s "source-text assertions" rules). Every match below
 *   is anchored to a literal, unique start and end specific to the one
 *   function/JSX block it proves, so it cannot bridge into an unrelated
 *   sibling or be satisfied by this file's own doc comments.
 * - A small recursive directory walk (also `readCode()`-based) proves
 *   the "nothing outside `platform/offline/` calls
 *   `restoreCachedTimeline`" claim across the whole `apps/android/src`
 *   feature/app/app-shell tree, not just the one file the flow reads —
 *   `grep -rn` would find the same thing; this is that check, pinned as
 *   a test so a future wire-up is a visible, expected test change
 *   rather than a silently stale doc comment.
 *
 * Mutation-checked by hand (documented per assertion below) rather than
 * with an automated harness — see each `it`'s own comment for the exact
 * construct that would need deleting to falsify it, since none of these
 * are eligible for `readComponentCode`/`readFunctionCode` (both anchor
 * to `export function <Name>(` / `export function` declarations;
 * `Composer.tsx`'s functions of interest are `const x = useCallback(...)`
 * closures and a non-exported nested component, neither of that shape —
 * see `readCallbackCode`/`readNestedFunctionCode` below).
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { composer as coreComposer } from "@picompanion/frontend-core";

import {
  EMPTY_COMPOSER_STATE,
  entryStatusLabel,
  markEntryFailed,
  recoverFailedDraft,
  submitDraft,
  type ComposerState,
} from "../../src/features/composer/composer-model.js";
import {
  createInMemoryStructuredStorage,
  createSystemClock,
} from "../../src/features/composer/in-memory-outbox-runtime.js";

import { OFFLINE_CACHE_OUTBOX_FLOW } from "./offline-cache-outbox-contract.js";
import { PRODUCTION_DAEMON_PORT } from "../harness/production-daemon-port.js";
import { assertVisibleTextsAfterEachTap, parseMaestroSteps } from "./maestro-yaml.js";

function readSource(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

function readCode(relativePath: string): string {
  return readSource(relativePath)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

/**
 * `readCode()` sliced from a literal `startMarker` to the first
 * `endMarker` that appears after it — the same "anchor on real,
 * specific source text, not a bare identifier" convention every other
 * `read*Code` helper in this directory uses, adapted for
 * `Composer.tsx`'s `const x = useCallback(...)` closures, which
 * `readFunctionCode`'s `export function <Name>(` pattern does not
 * match. Both markers are copied verbatim from the real file below, so
 * a rename or a restructure fails this loudly (`toBeDefined`) rather
 * than silently matching the wrong span.
 */
function readSlice(relativePath: string, startMarker: string, endMarker: string): string {
  const code = readCode(relativePath);
  const startIndex = code.indexOf(startMarker);
  expect(
    startIndex,
    `${relativePath} should contain ${JSON.stringify(startMarker)}`,
  ).toBeGreaterThanOrEqual(0);
  const endIndex = code.indexOf(endMarker, startIndex);
  expect(
    endIndex,
    `${relativePath} should contain ${JSON.stringify(endMarker)} after the start marker`,
  ).toBeGreaterThan(startIndex);
  return code.slice(startIndex, endIndex + endMarker.length);
}

// ---------------------------------------------------------------------
// Composer.tsx: the two branches of handleSend, and handleRetry.
// ---------------------------------------------------------------------

describe("Composer.tsx source (what this build's one live input mode actually wires)", () => {
  // T75: this used to be gated on `attachmentsToSend.length > 0`, so a
  // text-only send — the most common send in the app — bypassed the
  // real `OutboxController` entirely. Every send now reaches
  // `sendWithOutbox` unconditionally.
  it("handleSend routes every send — text-only or attachment-bearing — to sendWithOutbox, with no attachment-count gate in front of the call", () => {
    const slice = readSlice(
      "../../src/features/composer/Composer.tsx",
      "const handleSend = useCallback(() => {",
      "}, [state, generateId, sendWithOutbox]);",
    );
    // Real mutation check: reintroducing
    // `if (attachmentsToSend.length > 0) { ... return; }` around the
    // call below (the pre-T75 shape) would make this assertion fail,
    // since the call would then sit inside a conditional this regex
    // does not match unconditionally. Removing the gate again restores
    // the pass.
    expect(slice).not.toMatch(/attachmentsToSend\.length > 0\) \{[\s\S]*return;\s*\}/);
    expect(slice).toMatch(/void sendWithOutbox\(entry\.id, entry\.text, attachmentsToSend\);/);
  });

  it("handleSend's attachment-bearing branch still carries attachment refs onto the entry before sendWithOutbox is called", () => {
    const slice = readSlice(
      "../../src/features/composer/Composer.tsx",
      "const handleSend = useCallback(() => {",
      "}, [state, generateId, sendWithOutbox]);",
    );
    expect(slice).toMatch(/if \(attachmentsToSend\.length > 0\) \{/);
    expect(slice).toMatch(/entry = \{ \.\.\.result\.entry, attachments: attachmentsToSend \};/);
  });

  it("sendWithOutbox's failure path calls outbox.markFailed with no idempotencyVerified option — the entry is parked awaiting-confirmation, per outbox.ts's own contract, for every send now (text-only included)", () => {
    const slice = readSlice(
      "../../src/features/composer/Composer.tsx",
      "const sendWithOutbox = useCallback(",
      "[outbox, resolvedSessionId, onSubmit],\n  );",
    );
    expect(slice).toMatch(
      /await outbox\.markFailed\(outboxEntryId, message\)\.catch\(\(\) => undefined\);/,
    );
  });

  it("handleRetry reconciles the failed entry's outbox record via outbox.remove before restoring its text to the draft — T75 fix", () => {
    const slice = readSlice(
      "../../src/features/composer/Composer.tsx",
      "const handleRetry = useCallback(",
      "[outbox],\n  );",
    );
    // Real mutation check: deleting the `outbox.remove(outboxEntryId)`
    // call below (reverting to the pre-T75 body) makes this assertion
    // fail; restoring it makes it pass again.
    expect(slice).toMatch(/void outbox\.remove\(outboxEntryId\)\.catch\(\(\) => undefined\);/);
    expect(slice).toMatch(/setState\(\(current\) => recoverFailedDraft\(current, id\)\.state\);/);
  });

  it('composer-entries only renders while state.entries.length > 0 — an all-recovered composer shows no stale "Failed" row', () => {
    const code = readCode("../../src/features/composer/Composer.tsx");
    expect(code).toMatch(
      /\{state\.entries\.length > 0 \? \(\s*<View[\s\S]{0,200}?testID=\{`\$\{composerTestId\}-entries`\}/,
    );
  });

  it('ComposerEntryRow renders a Retry button under `${testId}-retry` only when entry.status === "failed"', () => {
    const slice = readSlice(
      "../../src/features/composer/Composer.tsx",
      "function ComposerEntryRow({",
      "  );\n}\n\nfunction StagedAttachmentRow({",
    );
    expect(slice).toMatch(
      /\{entry\.status === "failed" \? \(\s*<Button\s+kind="secondary"\s+label="Retry"\s+onPress=\{\(\) => onRetry\(entry\.id\)\}\s+testId=\{`\$\{testId\}-retry`\}/,
    );
    expect(OFFLINE_CACHE_OUTBOX_FLOW.composerEntryRetryButtonSuffix).toBe("-retry");
  });
});

// ---------------------------------------------------------------------
// session/[agentId]/index.tsx: the staleness banner's real, always-
// empty-today wiring.
// ---------------------------------------------------------------------

describe("session/[agentId]/index.tsx source (the offline-cache read half)", () => {
  it("SessionTranscript derives staleness from batcher.getState() via describeTimelineStaleness, and renders it under the flow's fixed testId only when non-null", () => {
    const code = readCode("../../src/app/h/[serverId]/session/[agentId]/index.tsx");
    expect(code).toMatch(
      /const readStaleness = \(\): StalenessAnnouncement \| null => \{\s*const state = batcher\.getState\(\);\s*return describeTimelineStaleness\(\{ stale: state\.stale, gap: state\.gap \}\);\s*\};/,
    );
    expect(code).toMatch(
      /\{staleness \? \(\s*<Banner tone="info" message=\{staleness\.text\} testId="session-transcript-staleness" \/>\s*\) : null\}/,
    );
    expect(OFFLINE_CACHE_OUTBOX_FLOW.timelineStalenessBannerTestId).toBe(
      "session-transcript-staleness",
    );
  });
});

// ---------------------------------------------------------------------
// Whole-tree proof: nothing outside platform/offline/ calls
// restoreCachedTimeline (the reducer entry that would ever flip
// state.stale to true for this route's batcher). platform/offline/
// itself is excluded — that is where the real (and already-tested)
// definition and its own `restoreTimelineTail` wrapper legitimately
// live; T68's job is threading a real cache read INTO one of the
// directories this walk DOES cover.
// ---------------------------------------------------------------------

const ANDROID_SRC_ROOT = fileURLToPath(new URL("../../src/", import.meta.url));
const WALK_DIRS = ["app", "app-shell", "features"];
const CALL_PATTERN = /\brestoreCachedTimeline\(|\brestoreTimelineTail\(/;

function listSourceFiles(root: string): string[] {
  const out: string[] = [];
  function walk(dir: string): void {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(entry)) continue;
      if (/\.test\.(ts|tsx)$/.test(entry)) continue;
      out.push(full);
    }
  }
  walk(root);
  return out;
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

describe("apps/android/src (excluding platform/offline/): the offline-cache read gap, walked whole-tree", () => {
  it("no app/app-shell/features file calls restoreCachedTimeline or restoreTimelineTail — the exact seam T68 (or whoever wires SessionTranscript to a real cache read) must close", () => {
    const offenders: string[] = [];
    for (const dirName of WALK_DIRS) {
      const dir = path.join(ANDROID_SRC_ROOT, dirName);
      for (const file of listSourceFiles(dir)) {
        const code = stripComments(readFileSync(file, "utf8"));
        if (CALL_PATTERN.test(code)) {
          offenders.push(path.relative(ANDROID_SRC_ROOT, file));
        }
      }
    }
    // Real mutation check: temporarily adding a call to
    // `coreTimeline.restoreCachedTimeline(...)` anywhere under
    // `app/`, `app-shell/`, or `features/` (verified by hand against
    // `session/[agentId]/index.tsx` itself) makes `offenders`
    // non-empty and this assertion fail. Removing it again restores
    // the pass. When a real caller IS added (T68's construction plus
    // whatever route wiring threads it through), this test is
    // EXPECTED to start failing — that failure is the trigger to
    // delete this whole `describe` block and enable the commented
    // `assertVisible` steps in `../../maestro/offline-cache-
    // outbox.yaml`, not a regression to chase.
    expect(
      offenders,
      `unexpected caller(s) of restoreCachedTimeline/restoreTimelineTail: ${offenders.join(", ")}`,
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------
// Real behaviour, RN-free: the composer-model entry lifecycle this
// flow's retry cycle drives (proves the yaml's assertions are grounded
// in real function behaviour, not just that the JSX exists), plus the
// real OutboxController's own contract for what "a safe outbox item"
// means at that layer, and the concrete orphaning this task found.
// ---------------------------------------------------------------------

describe("composer-model.ts: the retry cycle this flow drives, proven against real state transitions", () => {
  function send(state: ComposerState, text: string, id: string): ComposerState {
    const result = submitDraft({ ...state, draft: text }, { generateId: () => id, now: () => 0 });
    expect(result.entry).toBeDefined();
    return result.state;
  }

  it("a failed entry's text survives a retry unmodified — recoverFailedDraft restores it to draft and drops the entry, never discarding the text", () => {
    let state = send(EMPTY_COMPOSER_STATE, "Offline outbox flush attempt one", "entry-1");
    state = markEntryFailed(state, "entry-1");
    expect(state.entries).toHaveLength(1);
    expect(entryStatusLabel(state.entries[0]!.status)).toBe(
      OFFLINE_CACHE_OUTBOX_FLOW.entryFailedLabel,
    );

    const recovered = recoverFailedDraft(state, "entry-1");
    expect(recovered.recovered).toBe(true);
    expect(recovered.state.entries).toHaveLength(0);
    expect(recovered.state.draft).toBe("Offline outbox flush attempt one");
  });

  it("retrying, resending, and failing again never duplicates the entry — exactly one failed row exists after the full cycle, matching the flow's own assertions", () => {
    let state = send(EMPTY_COMPOSER_STATE, "Offline outbox flush attempt one", "entry-1");
    state = markEntryFailed(state, "entry-1");
    const recovered = recoverFailedDraft(state, "entry-1");
    state = send(recovered.state, recovered.state.draft, "entry-2");
    state = markEntryFailed(state, "entry-2");

    expect(state.entries).toHaveLength(1);
    expect(state.entries[0]!.id).toBe("entry-2");
    expect(state.entries[0]!.text).toBe("Offline outbox flush attempt one");
    expect(state.entries[0]!.status).toBe("failed");
  });

  it("recoverFailedDraft is a no-op for an id that is not currently failed — retry can never resurrect a sent or in-flight entry", () => {
    let state = send(EMPTY_COMPOSER_STATE, "still sending", "entry-3");
    // entry-3 is "pending" here, not "failed".
    const attempt = recoverFailedDraft(state, "entry-3");
    expect(attempt.recovered).toBe(false);
    expect(attempt.state).toBe(state);
  });
});

describe("the real OutboxController's own contract for 'a safe outbox item', and T75's fix for the orphan this task originally found", () => {
  it("markFailed with no idempotencyVerified option parks an entry awaiting-confirmation, excluded from getAutoResendCandidates — never auto-resent, matching sendWithOutbox's real call shape (proven above, now for every send)", async () => {
    const storage = createInMemoryStructuredStorage();
    const clock = createSystemClock();
    const outbox = new coreComposer.OutboxController(storage, clock);

    const entry = await outbox.enqueue({
      sessionId: "session-1",
      kind: "prompt",
      payload: { text: "hi" },
    });
    await outbox.markSending(entry.id);
    await outbox.markFailed(entry.id, "Not connected to a daemon");

    const reloaded = await outbox.load(entry.id);
    expect(reloaded?.status).toBe("awaiting-confirmation");
    expect(await outbox.getAutoResendCandidates("session-1")).toEqual([]);
  });

  it("T75: Composer's own handleRetry (proven above to call outbox.remove before recoverFailedDraft) reconciles a failed entry's outbox record — a resend's fresh stable id leaves no orphan behind, unlike the pre-T75 shape this suite used to document", async () => {
    const storage = createInMemoryStructuredStorage();
    const clock = createSystemClock();
    const outbox = new coreComposer.OutboxController(storage, clock);

    // Simulates sendWithOutbox's real sequence for one send (every send,
    // since T75 — proven above): enqueue, markSending, then markFailed
    // on rejection.
    const first = await outbox.enqueue({
      sessionId: "session-1",
      kind: "prompt",
      payload: { text: "hi" },
    });
    await outbox.markSending(first.id);
    await outbox.markFailed(first.id, "Not connected to a daemon");

    // handleRetry runs: it looks up the outbox id it recorded for this
    // entry (Composer.tsx's `outboxEntryIdRef`) and removes it — proven
    // above by source-text; simulated here as the real `outbox.remove`
    // call handleRetry actually makes.
    await outbox.remove(first.id);

    // The orphan this task originally found and disclosed is now gone
    // BEFORE the resend even happens — this is the "assert the orphan
    // is gone, not merely that the new one exists" half of T75's brief.
    expect(await outbox.load(first.id)).toBeNull();

    // The user taps Send again; sendWithOutbox enqueues a second entry,
    // exactly as before — a fresh stable id for a fresh logical send is
    // fine on its own; what T75 fixed is that the first one no longer
    // lingers forever alongside it.
    const second = await outbox.enqueue({
      sessionId: "session-1",
      kind: "prompt",
      payload: { text: "hi" },
    });
    expect(second.id).not.toBe(first.id);

    const all = await outbox.loadAll("session-1");
    expect(all.map((candidate) => candidate.id)).toEqual([second.id]);
  });
});

// T72: every describe block above proves real source matches
// `offline-cache-outbox-contract.ts`'s hand-typed restatement — none of
// them ever open `offline-cache-outbox.yaml` itself. That is the same
// gap that let `composer-inputs.yaml` drift into asserting
// `text: "Sent"` (see `composer-inputs.contract.test.ts`'s header
// comment); this flow asserts the identical `entryStatusLabel("failed")`
// premise TWICE (initial send, then again after Retry) and was equally
// exposed both times. This block closes that gap using the same shared
// parser (`./maestro-yaml.ts`).
describe("offline-cache-outbox.yaml itself, read from disk", () => {
  const OFFLINE_CACHE_OUTBOX_YAML = "../../maestro/offline-cache-outbox.yaml";
  const yamlText = readSource(OFFLINE_CACHE_OUTBOX_YAML);
  const steps = parseMaestroSteps(yamlText);

  it(
    'every send (initial, and again after tapping Retry) asserts entryStatusLabel("failed"), and none ever asserts ' +
      'entryStatusLabel("sent") — the exact drift T32S13 caused in composer-inputs.yaml, checked here too since this ' +
      "flow shares the identical unpaired-send premise, twice over",
    () => {
      const failedLabel = entryStatusLabel("failed");
      const sentLabel = entryStatusLabel("sent");
      const perSend = assertVisibleTextsAfterEachTap(
        steps,
        OFFLINE_CACHE_OUTBOX_FLOW.composerSendButton,
      );
      expect(
        perSend,
        `offline-cache-outbox.yaml should tap id="${OFFLINE_CACHE_OUTBOX_FLOW.composerSendButton}" exactly twice (initial send + resend after Retry)`,
      ).toHaveLength(2);
      for (const [index, texts] of perSend.entries()) {
        expect(
          texts,
          `offline-cache-outbox.yaml: send #${index + 1} (tapOn "${OFFLINE_CACHE_OUTBOX_FLOW.composerSendButton}") should assert entryStatusLabel("failed") ("${failedLabel}")`,
        ).toContain(failedLabel);
        expect(
          texts,
          `offline-cache-outbox.yaml: send #${index + 1} (tapOn "${OFFLINE_CACHE_OUTBOX_FLOW.composerSendButton}") asserts entryStatusLabel("sent") ("${sentLabel}") — a state this unpaired flow cannot reach`,
        ).not.toContain(sentLabel);
      }
    },
  );

  it("never names the production daemon's port, in any form including comments", () => {
    expect(
      yamlText.includes(String(PRODUCTION_DAEMON_PORT)),
      `offline-cache-outbox.yaml must never name the production daemon port ${PRODUCTION_DAEMON_PORT}, in any form`,
    ).toBe(false);
  });
});
