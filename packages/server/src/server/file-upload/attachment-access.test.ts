import { createHash } from "node:crypto";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import type { AgentTimelineImageRef } from "@picompanion/protocol/agent-types";
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

async function makeAttachmentDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), ATTACHMENT_TEMP_DIR_PREFIX));
  tempDirs.push(dir);
  return dir;
}

function lookupFor(
  images: Record<string, AgentTimelineImageRef[] | null>,
): AttachmentTimelineLookup {
  return {
    getAgentTimelineImages: (agentId) => (agentId in images ? images[agentId] : null),
  };
}

async function writeMaterializedImage(
  dir: string,
  bytes: Buffer,
  mimeType = "image/png",
): Promise<AgentTimelineImageRef> {
  const hash = createHash("sha256").update(bytes).digest("hex");
  const filePath = join(dir, `${hash}.png`);
  await writeFile(filePath, bytes);
  return { mimeType, path: filePath, bytes: bytes.byteLength };
}

describe("resolveAttachmentForDownload", () => {
  test("serves bytes for an image recorded on the requesting agent's own timeline", async () => {
    const dir = await makeAttachmentDir();
    const bytes = Buffer.from("fake-png-bytes");
    const ref = await writeMaterializedImage(dir, bytes);

    const result = await resolveAttachmentForDownload(
      { agentId: "agent-a", path: ref.path },
      lookupFor({ "agent-a": [ref] }),
    );

    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("unreachable");
    // The served path is the REALPATH, not the string the caller sent. That is
    // deliberate and is a security property: handing back the client's own
    // string would defeat the containment check that produced it. Asserted
    // against `realpath(ref.path)` rather than `ref.path` because the two can
    // differ — GitHub's `windows-latest` runner exposes `os.tmpdir()` as an 8.3
    // short path (`C:\Users\RUNNER~1\...`) whose realpath is the long form
    // (`C:\Users\runneradmin\...`), so the original assertion passed on every
    // developer machine and failed only on CI.
    expect(result.file.absolutePath).toBe(await realpath(ref.path));
    expect(result.file.mimeType).toBe("image/png");
    expect(result.file.size).toBe(bytes.byteLength);

    // Served bytes equal the originally materialized bytes — checked by
    // digest, not by eyeballing a rendered image.
    const servedBytes = await (await import("node:fs/promises")).readFile(result.file.absolutePath);
    expect(createHash("sha256").update(servedBytes).digest("hex")).toBe(
      createHash("sha256").update(bytes).digest("hex"),
    );
  });

  test("refuses an attachment that belongs to a different agent's session", async () => {
    const dir = await makeAttachmentDir();
    const refA = await writeMaterializedImage(dir, Buffer.from("agent-a-bytes"));
    const refB = await writeMaterializedImage(dir, Buffer.from("agent-b-bytes"));

    const lookup = lookupFor({ "agent-a": [refA], "agent-b": [refB] });

    // agent-b asking for agent-a's own recorded path is a cross-tenant read
    // even though the path is a real, legitimate attachment path.
    const result = await resolveAttachmentForDownload(
      { agentId: "agent-b", path: refA.path },
      lookup,
    );

    expect(result.status).toBe("not_found");
  });

  test("refuses when the agent does not exist or cannot be loaded", async () => {
    const result = await resolveAttachmentForDownload(
      { agentId: "missing-agent", path: "/tmp/paseo-attachments-x/deadbeef.png" },
      lookupFor({}),
    );

    expect(result.status).toBe("not_found");
  });

  test("refuses a path that does not exactly match any recorded attachment (`..` traversal)", async () => {
    const dir = await makeAttachmentDir();
    const ref = await writeMaterializedImage(dir, Buffer.from("real-bytes"));
    const traversal = `${dir}/../../../../etc/passwd`;

    const result = await resolveAttachmentForDownload(
      { agentId: "agent-a", path: traversal },
      lookupFor({ "agent-a": [ref] }),
    );

    expect(result.status).toBe("not_found");
  });

  test("refuses via containment even when a malformed record claims to match (defense in depth)", async () => {
    // Simulates a future bug that recorded a path outside any attachment
    // root verbatim: even if the membership check is satisfied (the record
    // and the request agree byte-for-byte), the independent root-containment
    // layer below must still refuse it.
    const outside = await mkdtemp(join(tmpdir(), "not-an-attachment-dir-"));
    tempDirs.push(outside);
    const secret = join(outside, "secret.txt");
    await writeFile(secret, "top secret");

    const maliciousRef: AgentTimelineImageRef = { mimeType: "text/plain", path: secret };

    const result = await resolveAttachmentForDownload(
      { agentId: "agent-a", path: secret },
      lookupFor({ "agent-a": [maliciousRef] }),
    );

    expect(result.status).toBe("not_found");
  });

  test("refuses via containment when a `..`-laden recorded path resolves outside the attachment root", async () => {
    // Distinct from the plain traversal test above: there the requested path
    // never matches a record at all, so membership alone stops it. Here the
    // exact same `..`-laden string is BOTH the recorded ref and the request
    // (simulating a bug that stored a non-normalized path), so membership
    // matches — proving containment, not membership, is what refuses this
    // one. `fs.realpath` resolves the `..` segments away before the
    // containment check ever runs.
    const dir = await makeAttachmentDir();
    const outsideDir = await mkdtemp(join(tmpdir(), "not-an-attachment-dir-"));
    tempDirs.push(outsideDir);
    const secret = join(outsideDir, "secret.txt");
    await writeFile(secret, "top secret");

    // Built with a literal template rather than `path.join`/`path.resolve`,
    // both of which normalize `..` away at construction time — the point
    // here is that the *stored string itself* still contains `..` when
    // `resolveAttachmentForDownload` receives it.
    const dotDotPath = `${dir}/../${relative(tmpdir(), secret).split("\\").join("/")}`;
    expect(dotDotPath).toContain("..");
    const maliciousRef: AgentTimelineImageRef = { mimeType: "text/plain", path: dotDotPath };

    const result = await resolveAttachmentForDownload(
      { agentId: "agent-a", path: dotDotPath },
      lookupFor({ "agent-a": [maliciousRef] }),
    );

    expect(result.status).toBe("not_found");
  });

  test("refuses a path two levels deep inside the attachment temp root", async () => {
    // The allowed shape is exactly `<tmproot>/paseo-attachments-*/<file>` —
    // one directory, one file. A path claiming to be nested further must
    // still be refused even if it were (implausibly) recorded verbatim.
    const dir = await makeAttachmentDir();
    const nestedDir = join(dir, "nested");
    await mkdir(nestedDir);
    const nestedFile = join(nestedDir, "sneaky.png");
    await writeFile(nestedFile, "bytes");
    const nestedRef: AgentTimelineImageRef = { mimeType: "image/png", path: nestedFile };

    const result = await resolveAttachmentForDownload(
      { agentId: "agent-a", path: nestedFile },
      lookupFor({ "agent-a": [nestedRef] }),
    );

    expect(result.status).toBe("not_found");
  });
});
