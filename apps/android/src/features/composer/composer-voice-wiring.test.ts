import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * T70 source-level wiring checks for `Composer.tsx`'s mic action — the
 * same treatment `attachment-wiring.test.ts` gives the attachment/mic
 * *permission* flow, extended to the actual recording toggle this task
 * adds. Same VITEST LIMITATION reason as that file: no `react-native`
 * render under this workspace's plain `vitest` setup.
 *
 * This file exists because "registration is not receipt" (repeated from
 * `attachment-wiring.test.ts`'s own header, and this task's brief): a
 * `voiceCapture` prop existing and type-checking is not the same as the
 * mic press actually driving it. Every assertion below reads through
 * `readCode` (comments stripped) and matches a full call expression
 * naming real identifiers from this file, not a bare one satisfied by an
 * import line or this file's own doc comments — see the five catalogued
 * defect classes this repository's `CLAUDE.md` names, and
 * `attachment-wiring.test.ts`'s header on why `[\s\S]*?` spans are
 * avoided here for the same reason.
 *
 * Every assertion here was mutation-checked against `Composer.tsx`: the
 * real call was deleted (comments and imports left intact), the
 * corresponding `it` was confirmed to fail, and the file was restored
 * byte-for-byte before this suite was left green — see this task's
 * report for the exact mutation and result recorded per case.
 *
 * What this file does NOT re-prove: that a `"drafted"` outcome's text is
 * cleaned/produced correctly, or that `{ kind: "audio" }` is transcribed
 * (or honestly reports `"transcription-unavailable"` without one) — that
 * is `../voice/voice-model.test.ts`'s job (T36D/T277). This file proves
 * only that `Composer.tsx`'s mic action is the thing that calls into that
 * already-proven controller, and that a `"drafted"` outcome is actually
 * applied to `state.draft` — the "real entry point" this task's brief
 * requires.
 *
 * **T277 corrected this file**: `createVoiceCaptureController` is no
 * longer built over `outbox`/`sessionId`/`onSubmit` — see
 * `../voice/voice-model.ts`'s header for the full behaviour-change
 * writeup (a finished transcript is now applied to the draft, never
 * sent).
 *
 * T83: `handleMicPress`'s start/stop toggle moved out of `Composer.tsx`
 * into `mic-press-model.ts` (RN-free, so it can be behaviourally
 * counted-fake tested — see that module's own test). This file's
 * source-text assertions now split across both files accordingly; the
 * counting-fake proof that permission resolves EXACTLY ONCE per press
 * lives in `mic-press-model.test.ts`, not here.
 */

function readSource(): string {
  return readFileSync(fileURLToPath(new URL("./Composer.tsx", import.meta.url)), "utf8");
}

function readCode(): string {
  return readSource()
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

function readMicPressModelCode(): string {
  return readFileSync(fileURLToPath(new URL("./mic-press-model.ts", import.meta.url)), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

describe("Composer.tsx really drives a real VoiceCaptureController from the mic action (T70)", () => {
  const code = readCode();

  it("T277: builds voiceController from createVoiceCaptureController over resolvedVoiceCapture — no outbox/sessionId/onSubmit any more", () => {
    expect(code).toMatch(/createVoiceCaptureController\(\{\s*port:\s*resolvedVoiceCapture,/);
    // The pre-T277 send machinery must be GONE from this call, not just
    // absent from the regex above (which would also pass if the whole
    // call were deleted) — assert directly on the identifiers that used
    // to appear inside it.
    const callStart = code.indexOf("createVoiceCaptureController({");
    expect(callStart).toBeGreaterThan(-1);
    const callEnd = code.indexOf("}),", callStart);
    const call = code.slice(callStart, callEnd);
    expect(call).not.toMatch(/\boutbox\b/);
    expect(call).not.toMatch(/\bsessionId:\s*resolvedSessionId\b/);
    expect(call).not.toMatch(/\bsubmitPrompt\b/);
  });

  it("T277: a 'drafted' voice outcome is applied to state.draft via applyTranscriptToDraft — never sent", () => {
    expect(code).toMatch(
      /result\.voiceOutcome\.outcome === "drafted"\)\s*\{\s*const transcript = result\.voiceOutcome\.text;\s*setState\(\(current\) => \(\{\s*\.\.\.current,\s*draft:\s*applyTranscriptToDraft\(current\.draft,\s*transcript\),/,
    );
  });

  it("T276: resolvedVoiceCapture now defaults to createExpoAudioVoiceCapturePort(), the real recorder — no longer the unavailable stub", () => {
    expect(code).toMatch(
      /resolvedVoiceCapture\s*=\s*useMemo\(\s*\(\)\s*=>\s*voiceCapture\s*\?\?\s*createExpoAudioVoiceCapturePort\(\)/,
    );
  });

  it("handleMicPress still fires the host's own onMicPress() first (T33B1 contract preserved)", () => {
    expect(code).toMatch(/const handleMicPress = useCallback\(\(\) => \{\s*onMicPress\(\);/);
  });

  // T83: the start/stop toggle itself moved to `mic-press-model.ts` (an
  // RN-free module a counting-fake test can actually exercise — see
  // that file's own test for why `Composer.tsx` can't be, the
  // RN-in-vitest limitation). `handleMicPress` now only ever calls
  // `runMicPress(voiceController)` — the two tests below replace the
  // pre-T83 ones that matched `voiceController.requestStop()`/
  // `requestStart()` literally inside `Composer.tsx`, which is no
  // longer where that text lives.
  it("handleMicPress delegates the whole press to runMicPress(voiceController) — not a second, inline permission/start/stop sequence", () => {
    expect(code).toMatch(
      /const result = await runMicPress\(voiceController\);\s*setVoiceState\(result\.voiceState\);/,
    );
  });

  it("mic-press-model.ts's runMicPress calls voiceController.requestStop() when a recording is already running, and requestStart() to begin a new one — not just a permission check", () => {
    const micPressCode = readMicPressModelCode();
    expect(micPressCode).toMatch(
      /voiceController\.getState\(\)\.status === "recording"\)\s*\{\s*const outcome = await voiceController\.requestStop\(\);/,
    );
    expect(micPressCode).toMatch(/const startOutcome = await voiceController\.requestStart\(\);/);
  });

  it("a permission-denied start outcome is surfaced through the SAME micPermissionState notice the precheck used to use", () => {
    const micPressCode = readMicPressModelCode();
    expect(micPressCode).toMatch(
      /micPermissionState:\s*startOutcome\.outcome === "permission-denied" \? startOutcome\.state : null,/,
    );
    expect(code).toMatch(
      /if \(result\.micPermissionState !== null\)\s*\{\s*setMicPermissionState\(result\.micPermissionState\);/,
    );
  });

  it("a running recording can be discarded via voiceController.requestCancel(), not just stopped-and-sent", () => {
    expect(code).toMatch(
      /const handleVoiceCancel = useCallback\(\(\) => \{[\s\S]{0,120}?voiceController\.requestCancel\(\)/,
    );
  });

  it("the voice status row is real UI, gated on a real computed display value — not permanently hidden or permanently shown", () => {
    expect(code).toMatch(/voiceStatusDisplay !== null \? \(/);
    expect(code).toMatch(/<StatusIndicator[\s\S]{0,120}?statusText=\{voiceStatusDisplay\.text\}/);
  });

  // T276: a settled outcome (idle, something to report) still renders
  // through `StatusIndicator` — proven above — but an ACTIVE capture
  // ("recording"/"processing") no longer does. This is the mic control's
  // waveform-only requirement: proven here as "the branch exists and
  // mounts the real component", with `voice-capture-indicator.test.ts`
  // owning the glyph's own visual/accessibility contract.
  it("T276: an active capture (recording/processing) renders VoiceCaptureIndicator instead of StatusIndicator text", () => {
    expect(code).toMatch(
      /voiceStatusDisplay\.kind === "indicator" \? \(\s*<VoiceCaptureIndicator\s+status=\{voiceStatusDisplay\.status\}/,
    );
  });

  it("the Cancel control only renders while actually recording, not while idle/processing", () => {
    const rowStart = code.indexOf("voiceStatusDisplay !== null ? (");
    expect(rowStart).toBeGreaterThan(-1);
    const rowEnd = code.indexOf(") : null}", rowStart);
    const row = code.slice(rowStart, rowEnd);
    expect(row).toMatch(/voiceState\.status === "recording" \? \(/);
    expect(row).toMatch(/onPress=\{handleVoiceCancel\}/);
  });
});
