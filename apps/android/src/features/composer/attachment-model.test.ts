import { describe, expect, it } from "vitest";

import {
  DEFAULT_ATTACHMENT_LIMITS,
  EMPTY_ATTACHMENTS_STATE,
  clearAttachments,
  describeAttachmentLimits,
  evaluateAttachmentCandidate,
  formatAttachmentBytes,
  hasPendingUploads,
  hasSendableAttachments,
  markAttachmentError,
  markAttachmentUploaded,
  removeAttachment,
  stageAttachment,
  totalStagedBytes,
  uploadedAttachmentRefs,
  attachmentStatusLabel,
  type AttachmentLimits,
  type AttachmentsState,
  type ComposerUploadedAttachment,
} from "./attachment-model";

const LIMITS: AttachmentLimits = { maxCount: 2, maxBytesPerFile: 100, maxTotalBytes: 150 };

function uploaded(id: string, size = 10): ComposerUploadedAttachment {
  return {
    type: "uploaded_file",
    id,
    fileName: `${id}.txt`,
    mimeType: "text/plain",
    size,
    path: `/u/${id}`,
  };
}

describe("evaluateAttachmentCandidate — boundaries exactly at each limit", () => {
  it("accepts a file exactly at maxBytesPerFile, rejects one byte over", () => {
    const atLimit = evaluateAttachmentCandidate(
      EMPTY_ATTACHMENTS_STATE,
      { name: "a.txt", mimeType: "text/plain", size: 100 },
      LIMITS,
    );
    expect(atLimit).toEqual({ accepted: true });

    const overLimit = evaluateAttachmentCandidate(
      EMPTY_ATTACHMENTS_STATE,
      { name: "a.txt", mimeType: "text/plain", size: 101 },
      LIMITS,
    );
    expect(overLimit.accepted).toBe(false);
    if (!overLimit.accepted) {
      expect(overLimit.reason).toBe("file-too-large");
      expect(overLimit.message).toContain("100 B");
    }
  });

  it("accepts a batch that lands exactly at maxTotalBytes, rejects one byte over", () => {
    const staged: AttachmentsState = {
      entries: [{ id: "1", name: "a.txt", mimeType: "text/plain", size: 100, status: "uploaded" }],
    };
    const atTotal = evaluateAttachmentCandidate(
      staged,
      { name: "b.txt", mimeType: "text/plain", size: 50 },
      LIMITS,
    );
    expect(atTotal).toEqual({ accepted: true });

    const overTotal = evaluateAttachmentCandidate(
      staged,
      { name: "b.txt", mimeType: "text/plain", size: 51 },
      LIMITS,
    );
    expect(overTotal.accepted).toBe(false);
    if (!overTotal.accepted) expect(overTotal.reason).toBe("total-limit");
  });

  it("accepts the maxCount-th file, rejects the (maxCount+1)-th", () => {
    const oneStaged: AttachmentsState = {
      entries: [{ id: "1", name: "a.txt", mimeType: "text/plain", size: 1, status: "uploaded" }],
    };
    const secondFile = evaluateAttachmentCandidate(
      oneStaged,
      { name: "b.txt", mimeType: "text/plain", size: 1 },
      LIMITS,
    );
    expect(secondFile).toEqual({ accepted: true });

    const twoStaged: AttachmentsState = {
      entries: [
        { id: "1", name: "a.txt", mimeType: "text/plain", size: 1, status: "uploaded" },
        { id: "2", name: "b.txt", mimeType: "text/plain", size: 1, status: "uploaded" },
      ],
    };
    const thirdFile = evaluateAttachmentCandidate(
      twoStaged,
      { name: "c.txt", mimeType: "text/plain", size: 1 },
      LIMITS,
    );
    expect(thirdFile.accepted).toBe(false);
    if (!thirdFile.accepted) expect(thirdFile.reason).toBe("count-limit");
  });

  it("count limit is checked before per-file size, so a full batch rejects even a tiny file as count-limit", () => {
    const twoStaged: AttachmentsState = {
      entries: [
        { id: "1", name: "a.txt", mimeType: "text/plain", size: 1, status: "uploaded" },
        { id: "2", name: "b.txt", mimeType: "text/plain", size: 1, status: "uploaded" },
      ],
    };
    const result = evaluateAttachmentCandidate(
      twoStaged,
      { name: "tiny.txt", mimeType: "text/plain", size: 1 },
      LIMITS,
    );
    expect(result.accepted).toBe(false);
    if (!result.accepted) expect(result.reason).toBe("count-limit");
  });
});

describe("describeAttachmentLimits — surfaced before the picker, not after a failure", () => {
  it("names count, per-file, and total limits in one sentence", () => {
    const text = describeAttachmentLimits(DEFAULT_ATTACHMENT_LIMITS);
    expect(text).toContain(`${DEFAULT_ATTACHMENT_LIMITS.maxCount} files`);
    expect(text).toContain(formatAttachmentBytes(DEFAULT_ATTACHMENT_LIMITS.maxBytesPerFile));
    expect(text).toContain(formatAttachmentBytes(DEFAULT_ATTACHMENT_LIMITS.maxTotalBytes));
  });
});

describe("formatAttachmentBytes", () => {
  it("formats bytes, kilobytes, and megabytes", () => {
    expect(formatAttachmentBytes(340)).toBe("340 B");
    expect(formatAttachmentBytes(1024)).toBe("1.0 KB");
    expect(formatAttachmentBytes(25 * 1024 * 1024)).toBe("25 MB");
  });
});

describe("staging lifecycle", () => {
  it("stages a candidate as uploading, then transitions to uploaded", () => {
    let state = EMPTY_ATTACHMENTS_STATE;
    state = stageAttachment(state, "s1", { name: "a.txt", mimeType: "text/plain", size: 10 });
    expect(state.entries).toHaveLength(1);
    expect(state.entries[0]?.status).toBe("uploading");
    expect(hasPendingUploads(state)).toBe(true);
    expect(hasSendableAttachments(state)).toBe(false);

    state = markAttachmentUploaded(state, "s1", uploaded("s1"));
    expect(state.entries[0]?.status).toBe("uploaded");
    expect(hasPendingUploads(state)).toBe(false);
    expect(hasSendableAttachments(state)).toBe(true);
    expect(uploadedAttachmentRefs(state)).toEqual([uploaded("s1")]);
  });

  it("transitions a staged file to error, preserving an explanation", () => {
    let state = stageAttachment(EMPTY_ATTACHMENTS_STATE, "s1", {
      name: "a.txt",
      mimeType: "text/plain",
      size: 10,
    });
    state = markAttachmentError(state, "s1", "network error");
    expect(state.entries[0]?.status).toBe("error");
    expect(state.entries[0]?.error).toBe("network error");
    expect(uploadedAttachmentRefs(state)).toEqual([]);
  });

  it("is a no-op for an unknown id", () => {
    const state = stageAttachment(EMPTY_ATTACHMENTS_STATE, "s1", {
      name: "a.txt",
      mimeType: "text/plain",
      size: 10,
    });
    expect(markAttachmentUploaded(state, "unknown", uploaded("x"))).toEqual(state);
    expect(markAttachmentError(state, "unknown", "x")).toEqual(state);
    expect(removeAttachment(state, "unknown")).toEqual(state);
  });

  it("removes a staged attachment regardless of status", () => {
    let state = stageAttachment(EMPTY_ATTACHMENTS_STATE, "s1", {
      name: "a.txt",
      mimeType: "text/plain",
      size: 10,
    });
    state = removeAttachment(state, "s1");
    expect(state.entries).toHaveLength(0);
  });

  it("clearAttachments always returns the shared empty state", () => {
    const state = stageAttachment(EMPTY_ATTACHMENTS_STATE, "s1", {
      name: "a.txt",
      mimeType: "text/plain",
      size: 10,
    });
    expect(clearAttachments()).toBe(EMPTY_ATTACHMENTS_STATE);
    expect(clearAttachments()).not.toBe(state);
  });

  it("totalStagedBytes sums every entry regardless of status", () => {
    let state = stageAttachment(EMPTY_ATTACHMENTS_STATE, "s1", {
      name: "a.txt",
      mimeType: "text/plain",
      size: 10,
    });
    state = stageAttachment(state, "s2", { name: "b.txt", mimeType: "text/plain", size: 5 });
    expect(totalStagedBytes(state)).toBe(15);
  });

  it("attachmentStatusLabel gives every status a distinct, visible word", () => {
    expect(attachmentStatusLabel("uploading")).toBe("Uploading…");
    expect(attachmentStatusLabel("uploaded")).toBe("Uploaded");
    expect(attachmentStatusLabel("error")).toBe("Failed");
  });
});
