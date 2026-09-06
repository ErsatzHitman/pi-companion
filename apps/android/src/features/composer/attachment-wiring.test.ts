import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * T33B7 source-level wiring checks for `Composer.tsx`'s attachment/mic
 * flow — the same treatment `composer-accessibility.test.ts` gives the
 * rest of this component, for the same VITEST LIMITATION reason (no
 * react-native render under this workspace's plain `vitest` setup).
 *
 * This file exists because "registration is not receipt" (this task's
 * brief, citing the `DiffRenderer` regression): it is not enough that
 * `attachmentSource`/`uploadClient`/`outbox` exist as props and pass
 * type-checking — each must actually be *called* from the real
 * pick/upload/send path. Every assertion below reads through `readCode`
 * (comments stripped) and matches a full call expression, never a bare
 * identifier — see this task's brief on why a bare-identifier match is
 * satisfied by the file's own import line, and why `[\s\S]*?` spans can
 * bridge across a doc comment.
 *
 * Every assertion here was mutation-checked: the real call was deleted
 * or restructured (comments and imports left intact), the corresponding
 * `it` was confirmed to fail, and the file was restored byte-for-byte
 * from a backup taken outside the repo (`diff` confirmed empty) before
 * this suite was left green. See this task's report for the exact
 * mutation and result recorded per case.
 */

function readSource(): string {
  return readFileSync(fileURLToPath(new URL("./Composer.tsx", import.meta.url)), "utf8");
}

function readCode(): string {
  return readSource()
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

describe("Composer.tsx really drives the injected attachment/mic ports (T33B7)", () => {
  const code = readCode();

  it("calls resolvedAttachmentSource.pickFiles(...) — not just declares the port", () => {
    expect(code).toMatch(/resolvedAttachmentSource\.pickFiles\(\{\s*multiple:\s*true\s*\}\)/);
  });

  it("calls uploadClient.uploadFile({ fileName, mimeType, bytes }) with a real file's bytes", () => {
    expect(code).toMatch(/uploadClient\.uploadFile\(\{\s*fileName:\s*file\.name/);
    expect(code).toMatch(/bytes,?\s*\}\)/);
  });

  it("stages a picked file with stageAttachment(...) before uploading it — a file is visible before it resolves", () => {
    expect(code).toMatch(/working\s*=\s*stageAttachment\(working,\s*id,/);
  });

  it("checks every picked file against evaluateAttachmentCandidate(...) before staging it as accepted", () => {
    expect(code).toMatch(
      /evaluateAttachmentCandidate\(\s*working,\s*\{\s*name:\s*file\.name,\s*mimeType,\s*size\s*\},\s*limits,?\s*\)/,
    );
  });

  it('enqueues an attachment-bearing send through outbox.enqueue with kind "prompt" and the attachment refs in the payload', () => {
    expect(code).toMatch(
      /outbox\.enqueue\(\{\s*sessionId:\s*resolvedSessionId,\s*kind:\s*"prompt",\s*payload:\s*\{\s*text,\s*attachments:\s*attachmentsToSend\s*\}/,
    );
  });

  it("drives markSending/markSent/markFailed on the same outbox entry around the real onSubmit(text) call", () => {
    expect(code).toMatch(/await outbox\.markSending\(outboxEntry\.id\)/);
    expect(code).toMatch(/await onSubmit\(text\)/);
    expect(code).toMatch(/await outbox\.markSent\(outboxEntry\.id\)/);
    expect(code).toMatch(/outbox\.markFailed\(outboxEntryId, message\)/);
  });

  it("resolves the attachment permission through resolvePermission(resolvedAttachmentSource)", () => {
    expect(code).toMatch(/resolvePermission\(resolvedAttachmentSource\)/);
  });

  // T83: the mic action used to resolve permission a SECOND time here,
  // via a separate `resolvedMicPermission` (`MicPermissionPort`) — see
  // `mic-press-model.ts`'s header for the double-OS-prompt bug that was.
  // `composer-voice-wiring.test.ts` proves the single call that replaced
  // it (`runMicPress(voiceController)`); this is the negative half of
  // that proof, anchored to `Composer.tsx`'s own top-level `Composer`
  // function so a sibling file's coincidental text can't satisfy it —
  // mutation-checked: reintroducing `resolvedMicPermission` (prop, memo,
  // and the extra `resolvePermission(resolvedMicPermission)` call) into
  // `Composer.tsx` was confirmed to fail this `it`, then reverted.
  it("never resolves mic permission through a second, separate MicPermissionPort — resolvedMicPermission is gone", () => {
    expect(code).not.toMatch(/resolvedMicPermission/);
    expect(code).not.toMatch(/MicPermissionPort/);
    expect(code).not.toMatch(/createUnavailableMicPermissionPort/);
  });

  it('mounts PermissionRecoveryNotice for both kind="photos" and kind="microphone", proving the affordance is reused, not duplicated', () => {
    expect(code).toMatch(/<PermissionRecoveryNotice[\s\S]{0,80}kind="photos"/);
    expect(code).toMatch(/<PermissionRecoveryNotice[\s\S]{0,80}kind="microphone"/);
  });

  it("routes the denied-permanently exit to a real OS call, Linking.openSettings(), not a stub", () => {
    expect(code).toMatch(/Linking\.openSettings\(\)/);
  });

  it("mic and attach still fire the host's own onMicPress()/onAttachPress() callbacks (T33B1 contract preserved)", () => {
    expect(code).toMatch(/const handleAttachPress = useCallback\(\(\) => \{\s*onAttachPress\(\);/);
    expect(code).toMatch(/const handleMicPress = useCallback\(\(\) => \{\s*onMicPress\(\);/);
  });

  it("an attachment-bearing entry carries its refs onto the rendered ComposerEntry, and ComposerEntryRow renders them", () => {
    expect(code).toMatch(/\.\.\.result\.entry,\s*attachments:\s*attachmentsToSend\s*\}/);
    expect(code).toMatch(/entry\.attachments\.map\(\(attachment\) => attachment\.fileName\)/);
  });
});
