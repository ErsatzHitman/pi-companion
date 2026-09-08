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
    const outsideDir = await mkdtemp(join(tmpdir(), "paseo-attachments-outside-secret-"));
    tempDirs.push(attachmentDir, outsideDir);

    const secretFile = join(outsideDir, "ssh-key");
    await writeFile(secretFile, "-----BEGIN OPENSSH PRIVATE KEY-----");

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
