/**
 * T42B2 — "Test versioned-JSON import" against
 * `docs/issues-from-plan.md`'s three acceptance criteria:
 *
 *   1. "Versioned-JSON import is tested if applicable, or its absence
 *      is justified in writing."
 *   2. "A malformed import is rejected safely."
 *   3. "Import is idempotent."
 *
 * ## Criterion 1: absence, justified in writing
 *
 * `docs/frontend-data-migration.md` §2 records **"Overall Phase 0
 * decision: RESET / RE-PAIR — no export utility is created"**, and §3
 * opens **"No import: T42 will not add an import path or schema
 * migration for legacy drafts/hosts/attachments."** T42B1 (this
 * directory, last wave) executed exactly that decision and its own
 * `migration-decision.test.ts` proves the four properties §3 commits
 * T42 to confirming — including, in that file's "property 2" describe
 * block, that a row sitting under a collection name standing in for a
 * legacy export's shape is never surfaced by `DraftStore`.
 *
 * So: **there is no versioned-JSON importer in this repository, and
 * this file does not build one.** No legacy schema reader, no envelope
 * parser, no `hosts`/`drafts`/`attachments` deserializer keyed to
 * `docs/frontend-data-migration.md` §3's synthetic envelope shape
 * exists anywhere under `apps/android/src` or `packages/frontend-core/
 * src`, and this task does not add one — doing so would contradict the
 * written decision, plan.md §5's legacy-frontend exclusion boundary,
 * and `docs/frontend-data-migration.md` §3's own words: "the export
 * format would be versioned JSON... The utility would live in the
 * legacy checkout... never in `D:\pi-companion`." An import path
 * belongs beside that future export utility, not here, and only if one
 * is ever built.
 *
 * Given that, criteria 2 and 3 cannot be tested against an importer
 * that does not exist and must not be invented to give them something
 * to run against. What *does* exist, and *is* a real vector for
 * malformed or replayed structured data regardless of whether any
 * importer is ever built, is `SqliteStructuredStorage.put()` — the one
 * place any structured value (today's real callers: `HostProfileStore`,
 * `DraftStore`, the turn outbox, the timeline cache; potentially, in
 * the future, an importer) actually reaches this cache. This file tests
 * criteria 2 and 3 there, against production code, rather than against
 * a synthetic stand-in importer this file would otherwise have to
 * invent — which is exactly the "prove absence, then test the real
 * remaining vector" shape T42B2's own brief asks for.
 *
 * Every fixture below is synthetic per plan.md §14.2: no real host,
 * daemon password, or relay key ever appears in this file.
 */
import { describe, expect, it } from "vitest";

import { InMemorySqliteDriver } from "./in-memory-sqlite-driver.js";
import { SqliteStructuredStorage } from "./sqlite-structured-storage.js";

describe("T42B2 criterion 1: no versioned-JSON importer exists, and none is added here", () => {
  it("no collection in this directory's own storage recognizes docs/frontend-data-migration.md §3's synthetic envelope shape", async () => {
    const driver = new InMemorySqliteDriver();
    const storage = new SqliteStructuredStorage({ driver });

    // The §3 envelope's own top-level shape (version/exportedAt/hosts/
    // drafts/attachments/meta), written directly through the storage
    // interface the way a hypothetical future importer might — nothing
    // in this repository ever writes this shape today, and nothing
    // reads it back out as anything other than an opaque JSON blob.
    const envelope = {
      version: 1,
      exportedAt: "2026-08-31T00:00:00.000Z",
      hosts: [],
      drafts: [],
      attachments: [],
      meta: {
        source: "legacy pi-companion export utility (§5.3)",
        note: "passwords/keys encrypted or omitted; synthetic example",
      },
    };
    await storage.put("legacy-export.envelope.v1", "synthetic-envelope", envelope);

    // Round-trips as an ordinary opaque value — SqliteStructuredStorage
    // has no envelope-specific parsing, versioning, or migration logic
    // of any kind. This is the "no import path or schema migration"
    // decision made observable: there is no code path anywhere that
    // recognizes "version": 1 and does anything with it.
    await expect(storage.get("legacy-export.envelope.v1", "synthetic-envelope")).resolves.toEqual(
      envelope,
    );
  });
});

describe("T42B2 criterion 2: a malformed import is rejected safely (tested at SqliteStructuredStorage.put/get/list, the real ingestion boundary)", () => {
  it("put() rejects a value that cannot round-trip through JSON (a circular reference) and writes nothing", async () => {
    const driver = new InMemorySqliteDriver();
    const storage = new SqliteStructuredStorage({ driver });

    await storage.put("hosts.profiles", "host_ok", { label: "pre-existing, untouched" });

    // A hypothetical malformed import row: an object with a cycle.
    // Nothing in this codebase can ever construct one through ordinary
    // JSON parsing (JSON has no cycles), but a hypothetical importer
    // reconstructing object graphs from a legacy in-memory store could.
    const malformed: Record<string, unknown> = { label: "malformed-cyclic" };
    malformed.self = malformed;

    await expect(storage.put("hosts.profiles", "host_malformed", malformed)).rejects.toThrow(
      /circular reference/,
    );

    // Rejected before anything was written: the malformed row never
    // landed, and the pre-existing sibling row is completely untouched.
    await expect(storage.get("hosts.profiles", "host_malformed")).resolves.toBeNull();
    await expect(storage.get("hosts.profiles", "host_ok")).resolves.toEqual({
      label: "pre-existing, untouched",
    });
    expect(driver.totalRowCount).toBe(1);
  });

  it("put() still accepts a DAG that shares one nested object at two different paths — sharing a reference is not the same as a cycle", async () => {
    const driver = new InMemorySqliteDriver();
    const storage = new SqliteStructuredStorage({ driver });

    const shared = { note: "same object, referenced twice, no cycle" };
    await storage.put("hosts.profiles", "host_dag", { primary: shared, backup: shared });

    await expect(storage.get("hosts.profiles", "host_dag")).resolves.toEqual({
      primary: shared,
      backup: shared,
    });
  });

  it("get() treats a row whose stored bytes are not valid JSON as absent, rather than throwing or returning garbage", async () => {
    const backing: ConstructorParameters<typeof InMemorySqliteDriver>[0] = [];
    const driver = new InMemorySqliteDriver(backing);
    const storage = new SqliteStructuredStorage({ driver });

    // Simulates a row corrupted on disk, or written by some future
    // process outside SqliteStructuredStorage.put's own JSON.stringify
    // — the storage interface itself has no way to prevent bytes it did
    // not write from landing in its backing store.
    await storage.put("hosts.profiles", "host_corrupt", { label: "will be corrupted" });
    const row = backing.find(
      (r) => r.collection === "hosts.profiles" && r.row_id === "host_corrupt",
    );
    if (!row) {
      throw new Error("test setup failed: row not found in backing store");
    }
    row.value = "{ this is not valid JSON at all !!";

    await expect(storage.get("hosts.profiles", "host_corrupt")).resolves.toBeNull();
  });

  it("list() skips only the malformed row and still returns every readable sibling — a single corrupt row must not deny reads of an entire collection", async () => {
    const backing: ConstructorParameters<typeof InMemorySqliteDriver>[0] = [];
    const driver = new InMemorySqliteDriver(backing);
    const storage = new SqliteStructuredStorage({ driver });

    await storage.put("hosts.profiles", "host_a", { label: "a" });
    await storage.put("hosts.profiles", "host_b", { label: "b" });
    await storage.put("hosts.profiles", "host_c", { label: "c" });

    const corruptRow = backing.find(
      (r) => r.collection === "hosts.profiles" && r.row_id === "host_b",
    );
    if (!corruptRow) {
      throw new Error("test setup failed: row not found in backing store");
    }
    corruptRow.value = "not json";

    const listed = await storage.list<{ label: string }>("hosts.profiles");
    expect(listed.map((entry) => entry.label).sort()).toEqual(["a", "c"]);
  });
});

describe("T42B2 criterion 3: import is idempotent (tested at SqliteStructuredStorage.put, the real ingestion boundary)", () => {
  it("replaying the exact same row multiple times leaves exactly one row with the original content, not duplicates", async () => {
    const driver = new InMemorySqliteDriver();
    const storage = new SqliteStructuredStorage({ driver });

    const row = { label: "synthetic-host", direct: { endpoint: "10.0.2.2:9999" } };

    // A "replayed import" of the same (collection, id, value) triple —
    // e.g. a user re-running a hypothetical future importer twice
    // against the same envelope, or a retried write after an
    // ambiguous failure — must converge to one row, not accumulate one
    // per replay.
    await storage.put("hosts.profiles", "host_replayed", row);
    await storage.put("hosts.profiles", "host_replayed", row);
    await storage.put("hosts.profiles", "host_replayed", row);

    expect(driver.totalRowCount).toBe(1);
    await expect(storage.get("hosts.profiles", "host_replayed")).resolves.toEqual(row);

    const listed = await storage.list<typeof row>("hosts.profiles");
    expect(listed).toEqual([row]);
  });

  it("replaying rows across a full collection twice is idempotent: the second pass changes nothing observable", async () => {
    const driver = new InMemorySqliteDriver();
    const storage = new SqliteStructuredStorage({ driver });

    const rows: Array<[string, { label: string }]> = [
      ["host_1", { label: "one" }],
      ["host_2", { label: "two" }],
      ["host_3", { label: "three" }],
    ];

    for (const [id, value] of rows) {
      await storage.put("hosts.profiles", id, value);
    }
    const afterFirstPass = await storage.list<{ label: string }>("hosts.profiles");

    // Replay the identical import pass a second time.
    for (const [id, value] of rows) {
      await storage.put("hosts.profiles", id, value);
    }
    const afterSecondPass = await storage.list<{ label: string }>("hosts.profiles");

    expect(driver.totalRowCount).toBe(3);
    expect(afterSecondPass).toEqual(afterFirstPass);
  });
});
