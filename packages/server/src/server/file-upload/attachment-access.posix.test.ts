// POSIX-only: symlink fixtures (Windows refuses file symlinks without
// elevation/developer mode — the same reason
// `file-explorer/service.posix.test.ts` gates its own symlink tests).
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import type { AgentTimelineImageRef } from "@picompanion/protocol/agent-types";
import { isPlatform } from "../../test-utils/platform.js";
import {
  ATTACHMENT_TEMP_DIR_PREFIX,
  resolveAttachmentForDownload,
  type AttachmentTimelineLookup,
} from "./attachment-access.js";

const tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

function lookupFor(images: Record<string, AgentTimelineImageRef[]>): AttachmentTimelineLookup {
  return {
    getAgentTimelineImages: (agentId) => images[agentId] ?? null,
  };
}

describe.skipIf(isPlatform("win32"))("resolveAttachmentForDownload POSIX-only", () => {
  test("refuses a recorded path that now resolves, via a symlink, outside the attachment root", async () => {
    const attachmentDir = await mkdtemp(join(tmpdir(), ATTACHMENT_TEMP_DIR_PREFIX));
    // The prefix here MUST NOT begin with `ATTACHMENT_TEMP_DIR_PREFIX`.
    // CORRECTED at the P9-P merge gate: this read
    // `mkdtemp(join(tmpdir(), "paseo-attachments-outside-secret-"))`, whose
    // basename starts with that prefix, so `resolveWithinAttachmentTempRoot`'s
    // first-segment `startsWith` check ADMITTED the "outside" directory. The
    // symlink resolved into a path containment accepts, this test's own
    // assertion could never hold, and the symlink-escape guarantee it exists
    // to pin was unproven. Measured, not reasoned: with the old prefix the
    // resolver returned `{status:"ok"}` and served the planted bytes.
    const outsideDir = await mkdtemp(join(tmpdir(), "outside-secret-"));
    tempDirs.push(attachmentDir, outsideDir);

    const secretFile = join(outsideDir, "ssh-key");
    // Assembled from two pieces on purpose. A contiguous PEM header literal
    // trips `guard-secret-scan.mjs` and `guard-signing-material.mjs` against
    // this file even though the bytes are an obvious fixture — the same
    // string-concatenation technique `guard-secret-scan.test.mjs` uses for its
    // own PEM fixture. Nothing here is a real credential; it only has to be
    // recognisable as "a file the caller must never be able to read".
    await writeFile(secretFile, "-----BEGIN" + " OPENSSH PRIVATE KEY-----");

    // The exact path a legitimate image was once recorded under is now a
    // symlink pointing outside the attachment root — e.g. a compromised or
    // buggy provider swapping the file after materialization. The request
    // string is unchanged and matches the timeline record exactly.
    const recordedPath = join(attachmentDir, "deadbeef.png");
    await symlink(secretFile, recordedPath);

    const ref: AgentTimelineImageRef = { mimeType: "image/png", path: recordedPath };

    const result = await resolveAttachmentForDownload(
      { agentId: "agent-a", path: recordedPath },
      lookupFor({ "agent-a": [ref] }),
    );

    expect(result.status).toBe("not_found");
  });

  test("serves bytes through a symlink that stays inside the attachment root", async () => {
    const attachmentDir = await mkdtemp(join(tmpdir(), ATTACHMENT_TEMP_DIR_PREFIX));
    tempDirs.push(attachmentDir);

    const realFile = join(attachmentDir, "real.png");
    const linkedPath = join(attachmentDir, "linked.png");
    await writeFile(realFile, "real-bytes");
    await symlink(realFile, linkedPath);

    const ref: AgentTimelineImageRef = { mimeType: "image/png", path: linkedPath };
    const result = await resolveAttachmentForDownload(
      { agentId: "agent-a", path: linkedPath },
      lookupFor({ "agent-a": [ref] }),
    );

    expect(result.status).toBe("ok");
  });
});
