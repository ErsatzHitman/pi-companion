/**
 * T42B1 — proves, against this task's own storage primitives, the four
 * properties `docs/frontend-data-migration.md` §3 commits T42 to
 * confirming. That document's §2 records the Phase 0 decision as
 * **RESET / RE-PAIR — no export utility is created**, and §3 opens
 * **"No import: T42 will not add an import path or schema migration
 * for legacy drafts/hosts/attachments."** This file is therefore
 * verification of shipped behaviour against that written decision, not
 * a migration implementation — it constructs no importer, no legacy
 * schema reader, and no export utility. See `docs/issues-from-plan.md`
 * T203 ("Edge 2") for why T42B1 depends only on T22 (the storage
 * interfaces it verifies), not on T42A3's diagnostics screen.
 *
 * Every fixture below is synthetic per plan.md §14.2 and this decision
 * document's own example envelope: no real host, daemon password, or
 * relay key ever appears in this file.
 *
 * The four properties, each with its own `describe` block below:
 *
 * 1. Fresh pairing succeeds and the host list starts empty then
 *    populates correctly — proven against `hosts.HostProfileStore`
 *    (`@picompanion/frontend-core`, generic over any `StructuredStorage`)
 *    backed by this task's own `SqliteStructuredStorage`, including
 *    across a simulated restart.
 * 2. Drafts survive a simulated restart via the new storage interface,
 *    and legacy drafts are not loaded — proven against
 *    `composer.DraftStore` the same way, plus a check that a row
 *    written directly into a differently-named collection (standing in
 *    for whatever a legacy export's shape might have been) is never
 *    surfaced by `DraftStore`, because it only ever reads the one
 *    collection it owns.
 * 3. The outbox refuses automatic resend when idempotency is
 *    unverified — proven against `./turn-outbox-owner.ts` +
 *    `./turn-recovery.ts`'s real cold-start recovery pass. This
 *    property was verified by mutation during T42B1's implementation:
 *    forcing `turn-recovery.ts`'s `isIdempotencyVerified` default to
 *    `true` made this file's "refuses automatic resend" test fail (and
 *    also failed `turn-outbox-owner.test.ts`'s own pre-existing
 *    coverage of the same guard); the change was reverted byte-for-byte
 *    before committing. See T42B1's task report for the exact commands
 *    and pass/fail counts observed.
 * 4. No daemon password or private relay key is imported unencrypted —
 *    proven structurally: `SqliteStructuredStorage.put` refuses any
 *    value with a secret-shaped field before it ever reaches the
 *    driver (already covered by `sqlite-structured-storage.test.ts`'s
 *    "secret exclusion" suite), so even a hypothetical future importer
 *    could not smuggle an unencrypted secret through this storage. This
 *    file adds one more case scoped to the migration decision's own
 *    wording: a synthetic host profile carrying a raw `password` field.
 *
 * Diagnostics redaction (§3's fourth verification bullet) is proven by
 * `packages/frontend-core/src/security/secret-shape.test.ts` (the
 * shared `security.isSecretShapedKey` detector this file's own guard
 * and every diagnostics exporter use) and `apps/web/src/features/
 * diagnostics/diagnostics-export.test.ts`. `apps/android/src/features/
 * diagnostics/` is T42A3's directory this same wave (P7-W7) and is not
 * touched here — see this task's report for the exact commands run
 * against those suites.
 */
import { describe, expect, it } from "vitest";
import type { Clock, SecureStorage } from "@picompanion/frontend-core";
import { composer as coreComposer, hosts as coreHosts } from "@picompanion/frontend-core";

import { InMemorySqliteDriver } from "./in-memory-sqlite-driver.js";
import { SqliteStructuredStorage } from "./sqlite-structured-storage.js";
import { createTurnOutboxOwner } from "./turn-outbox-owner.js";
import { createTurnOutbox } from "./turn-recovery.js";

/** Minimal, deterministic `Clock` double — same shape the sibling test files in this directory use. */
class FakeClock implements Clock {
  constructor(private currentMs: number) {}
  now(): number {
    return this.currentMs;
  }
  setTimeout(): never {
    throw new Error("FakeClock.setTimeout is not implemented; this test double is now-only.");
  }
  clearTimeout(): never {
    throw new Error("FakeClock.clearTimeout is not implemented; this test double is now-only.");
  }
  setInterval(): never {
    throw new Error("FakeClock.setInterval is not implemented; this test double is now-only.");
  }
  clearInterval(): never {
    throw new Error("FakeClock.clearInterval is not implemented; this test double is now-only.");
  }
}

/**
 * Minimal in-memory `SecureStorage` double. Real Android backs this
 * interface with Expo SecureStore (`../secure-storage.ts`, not this
 * task's grant) — this fake exists only so `HostProfileStore` (which
 * requires a `SecureStorage` even when a test never calls
 * `getPassword`/`setPassword`) can be constructed here without reaching
 * into another task's file.
 */
class InMemorySecureStorage implements SecureStorage {
  private readonly secrets = new Map<string, string>();
  async getSecret(key: string): Promise<string | null> {
    return this.secrets.get(key) ?? null;
  }
  async setSecret(key: string, value: string): Promise<void> {
    this.secrets.set(key, value);
  }
  async removeSecret(key: string): Promise<void> {
    this.secrets.delete(key);
  }
  async isAvailable(): Promise<boolean> {
    return true;
  }
}

describe("T42B1 property 1: fresh pairing — the host list starts empty then populates, and survives a simulated restart", () => {
  it("a brand-new SqliteStructuredStorage backs an empty host list until a profile is saved", async () => {
    const driver = new InMemorySqliteDriver();
    const storage = new SqliteStructuredStorage({ driver });
    const store = new coreHosts.HostProfileStore({
      storage,
      secrets: new InMemorySecureStorage(),
      clock: new FakeClock(1_000),
    });

    // Nothing pre-populates this list: no importer, no legacy reader,
    // no seed data. This is the "no import path" decision made
    // observable, not an accident of an empty fixture.
    await expect(store.list()).resolves.toEqual([]);

    const saved = await store.save({
      label: "synthetic-dev-laptop",
      direct: { endpoint: "10.0.2.2:9999", useTls: false },
    });

    const afterSave = await store.list();
    expect(afterSave).toHaveLength(1);
    expect(afterSave[0]?.id).toBe(saved.id);
    expect(afterSave[0]?.label).toBe("synthetic-dev-laptop");
  });

  it("the saved profile survives a simulated restart through a fresh HostProfileStore over a fresh driver sharing the same backing rows", async () => {
    const backing: ConstructorParameters<typeof InMemorySqliteDriver>[0] = [];
    const beforeRestartDriver = new InMemorySqliteDriver(backing);
    const beforeRestartStore = new coreHosts.HostProfileStore({
      storage: new SqliteStructuredStorage({ driver: beforeRestartDriver }),
      secrets: new InMemorySecureStorage(),
      clock: new FakeClock(1_000),
    });
    const saved = await beforeRestartStore.save({
      label: "synthetic-relay-profile",
      relay: {
        endpoint: "relay.example.invalid:443",
        useTls: true,
        serverId: "srv_synthetic",
        daemonPublicKeyB64: "c3ludGhldGljLXB1YmxpYy1rZXk=",
      },
    });

    // "Restart": a fresh HostProfileStore, over a fresh driver, sharing
    // only the backing rows array — the process is gone, the rows are
    // not (identical shape to this directory's other restart tests).
    const afterRestartDriver = new InMemorySqliteDriver(backing);
    const afterRestartStore = new coreHosts.HostProfileStore({
      storage: new SqliteStructuredStorage({ driver: afterRestartDriver }),
      secrets: new InMemorySecureStorage(),
      clock: new FakeClock(2_000),
    });

    const listed = await afterRestartStore.list();
    expect(listed).toEqual([saved]);
  });
});

describe("T42B1 property 2: drafts survive a simulated restart via the new storage interface, and legacy drafts are not loaded", () => {
  it("a saved draft survives a simulated restart through a fresh DraftStore over a fresh driver sharing the same backing rows", async () => {
    const backing: ConstructorParameters<typeof InMemorySqliteDriver>[0] = [];
    const beforeRestartDriver = new InMemorySqliteDriver(backing);
    const beforeRestartDrafts = new coreComposer.DraftStore(
      new SqliteStructuredStorage({ driver: beforeRestartDriver }),
      new FakeClock(1_000),
    );
    await beforeRestartDrafts.save("agt_synthetic_session", {
      text: "synthetic unsent draft text",
    });

    const afterRestartDriver = new InMemorySqliteDriver(backing);
    const afterRestartDrafts = new coreComposer.DraftStore(
      new SqliteStructuredStorage({ driver: afterRestartDriver }),
      new FakeClock(2_000),
    );

    const reloaded = await afterRestartDrafts.load("agt_synthetic_session");
    expect(reloaded?.text).toBe("synthetic unsent draft text");
  });

  it("a row sitting in a different, non-owned collection — standing in for a legacy export's shape — is never surfaced by DraftStore", async () => {
    const backing: ConstructorParameters<typeof InMemorySqliteDriver>[0] = [];
    const driver = new InMemorySqliteDriver(backing);
    const storage = new SqliteStructuredStorage({ driver });

    // Written directly through the storage interface, bypassing
    // DraftStore entirely, under a collection name DraftStore never
    // reads. This stands in for "whatever a legacy AsyncStorage export
    // might have looked like" without this repository containing any
    // actual legacy-format reader — there is none to exercise.
    await storage.put("legacy-export.drafts.v0", "old_session_1", {
      text: "a draft from a previously installed build",
    });

    const drafts = new coreComposer.DraftStore(storage, new FakeClock(1_000));
    await expect(drafts.listAll()).resolves.toEqual([]);
    await expect(drafts.load("old_session_1")).resolves.toBeNull();

    // The new storage interface itself is not blind to that row — it is
    // simply never asked for it by anything on the migration/draft path.
    await expect(storage.get("legacy-export.drafts.v0", "old_session_1")).resolves.toEqual({
      text: "a draft from a previously installed build",
    });
  });
});

describe("T42B1 property 3: the outbox refuses automatic resend when idempotency is unverified", () => {
  it("a row recovered from a simulated cold start while 'sending' is parked awaiting-confirmation, never returned by getAutoResendCandidates, unless the caller asserts idempotency", async () => {
    const backing: ConstructorParameters<typeof InMemorySqliteDriver>[0] = [];
    const beforeKillDriver = new InMemorySqliteDriver(backing);
    const outboxBeforeKill = createTurnOutbox(
      new SqliteStructuredStorage({ driver: beforeKillDriver }),
      new FakeClock(1_000),
    );
    const entry = await outboxBeforeKill.enqueue({
      sessionId: "agt_synthetic_outbox",
      kind: "prompt",
      payload: { text: "synthetic in-flight prompt" },
    });
    await outboxBeforeKill.markSending(entry.id);

    const afterKillDriver = new InMemorySqliteDriver(backing);
    const owner = createTurnOutboxOwner({
      driverFactory: { open: () => Promise.resolve(afterKillDriver) },
      clock: new FakeClock(2_000),
      // No `recovery.isIdempotencyVerified` override: this is the
      // production default, the "safe, conservative choice"
      // `turn-recovery.ts`'s own doc comment describes.
    });
    await owner.open();

    const candidates = await owner.getOutbox()?.getAutoResendCandidates();
    expect(candidates).toEqual([]);

    const reloaded = await owner.getOutbox()?.load(entry.id);
    expect(reloaded?.status).toBe("awaiting-confirmation");

    await owner.dispose();
  });

  it("the same row IS eligible for automatic resend once the caller positively asserts idempotency was verified", async () => {
    const backing: ConstructorParameters<typeof InMemorySqliteDriver>[0] = [];
    const beforeKillDriver = new InMemorySqliteDriver(backing);
    const outboxBeforeKill = createTurnOutbox(
      new SqliteStructuredStorage({ driver: beforeKillDriver }),
      new FakeClock(1_000),
    );
    const entry = await outboxBeforeKill.enqueue({
      sessionId: "agt_synthetic_outbox_2",
      kind: "prompt",
      payload: { text: "synthetic in-flight prompt, idempotency verified" },
    });
    await outboxBeforeKill.markSending(entry.id);

    const afterKillDriver = new InMemorySqliteDriver(backing);
    const owner = createTurnOutboxOwner({
      driverFactory: { open: () => Promise.resolve(afterKillDriver) },
      clock: new FakeClock(2_000),
      recovery: { isIdempotencyVerified: () => true },
    });
    await owner.open();

    const candidates = await owner.getOutbox()?.getAutoResendCandidates();
    expect(candidates?.map((c) => c.id)).toEqual([entry.id]);

    await owner.dispose();
  });
});

describe("T42B1 property 4: no daemon password or private relay key is imported unencrypted", () => {
  it("SqliteStructuredStorage refuses a host profile carrying a raw password field, so even a future importer could not smuggle one through here", async () => {
    const driver = new InMemorySqliteDriver();
    const storage = new SqliteStructuredStorage({ driver });

    await expect(
      storage.put("hosts.profiles", "host_synthetic", {
        label: "synthetic-host-with-leaked-secret",
        // A daemon password must never reach this plain offline cache —
        // it belongs only in SecureStorage, addressed by profile id, as
        // HostProfileStore.setPassword already does.
        password: "synthetic-plaintext-password-should-be-refused",
      }),
    ).rejects.toThrow(/secret-shaped field "password"/);

    // Refused before it ever reached the driver.
    expect(driver.totalRowCount).toBe(0);
  });

  it("SqliteStructuredStorage refuses a relay profile carrying a raw private relay key field", async () => {
    const driver = new InMemorySqliteDriver();
    const storage = new SqliteStructuredStorage({ driver });

    await expect(
      storage.put("hosts.profiles", "host_synthetic_relay", {
        label: "synthetic-relay-with-leaked-secret",
        relayPrivateKey: "synthetic-plaintext-relay-key-should-be-refused",
      }),
    ).rejects.toThrow(/secret-shaped field "relayPrivateKey"/);

    expect(driver.totalRowCount).toBe(0);
  });
});
