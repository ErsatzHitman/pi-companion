/**
 * T390 coverage for the real `createExpoSqliteDriverFactory` adapter.
 *
 * `expo-sqlite`'s native entry calls `requireNativeModule("ExpoSQLite")`
 * at module-evaluation time, which this workspace's plain `vitest` setup
 * cannot provide — so two proof strategies, mirroring
 * `../features/voice/expo-audio-voice-capture-port.test.ts`:
 *
 *  - Most of this suite injects a plain fake `ExpoSqliteBindings`
 *    directly, proving the adapter's own forwarding/mapping logic with
 *    no native module involved.
 *  - The last block proves `DEFAULT_BINDINGS` itself — the object that
 *    actually wires to `expo-sqlite` — by calling
 *    `createExpoSqliteDriverFactory(name)` with NO bindings argument and
 *    reading the mocked module's recorded calls.
 *
 * `expo-sqlite` is replaced with a controllable fixture via `vi.mock`,
 * hoisted to the top of this file, so the real native package is never
 * loaded here.
 */
import { describe, expect, it, vi } from "vitest";

import type { ExpoSqliteDatabase } from "./expo-sqlite-driver-factory.js";
import { createExpoSqliteDriverFactory } from "./expo-sqlite-driver-factory.js";

const sqliteFixture = vi.hoisted(() => {
  const state = {
    openedNames: [] as string[],
    database: null as unknown,
  };
  return {
    state,
    openDatabaseAsync: async (databaseName: string) => {
      state.openedNames.push(databaseName);
      return state.database;
    },
  };
});

vi.mock("expo-sqlite", () => ({
  openDatabaseAsync: sqliteFixture.openDatabaseAsync,
}));

interface RecordedCall {
  method: string;
  sql: string;
  params: readonly unknown[];
}

function createFakeDatabase(overrides: Partial<ExpoSqliteDatabase> = {}): {
  database: ExpoSqliteDatabase;
  calls: RecordedCall[];
  closeCalls: () => number;
} {
  const calls: RecordedCall[] = [];
  let closeCalls = 0;
  const database: ExpoSqliteDatabase = {
    async execAsync(source) {
      calls.push({ method: "execAsync", sql: source, params: [] });
    },
    async runAsync(source, params) {
      calls.push({ method: "runAsync", sql: source, params });
      return { changes: 3 };
    },
    async getAllAsync<Row>(source: string, params: readonly unknown[]) {
      calls.push({ method: "getAllAsync", sql: source, params });
      return [{ value: "row" }] as Row[];
    },
    async getFirstAsync<Row>(source: string, params: readonly unknown[]) {
      calls.push({ method: "getFirstAsync", sql: source, params });
      return { value: "first" } as unknown as Row;
    },
    async closeAsync() {
      closeCalls += 1;
    },
    ...overrides,
  };
  return { database, calls, closeCalls: () => closeCalls };
}

describe("createExpoSqliteDriverFactory", () => {
  it("opens exactly the database name it was constructed with", async () => {
    const openedNames: string[] = [];
    const { database } = createFakeDatabase();
    const factory = createExpoSqliteDriverFactory("cache.db", {
      async openDatabaseAsync(name) {
        openedNames.push(name);
        return database;
      },
    });

    await factory.open();

    expect(openedNames).toEqual(["cache.db"]);
  });

  it("forwards every SqliteDriver method to the opened database with the exact SQL and params", async () => {
    const { database, calls } = createFakeDatabase();
    const factory = createExpoSqliteDriverFactory("cache.db", {
      async openDatabaseAsync() {
        return database;
      },
    });
    const driver = await factory.open();

    await driver.execAsync("CREATE TABLE IF NOT EXISTS t (a TEXT)");
    const runResult = await driver.runAsync("INSERT INTO t VALUES (?)", ["a"]);
    const rows = await driver.getAllAsync("SELECT * FROM t WHERE a = ?", ["a"]);
    const first = await driver.getFirstAsync("SELECT * FROM t WHERE a = ?", ["a"]);

    expect(calls).toEqual([
      {
        method: "execAsync",
        sql: "CREATE TABLE IF NOT EXISTS t (a TEXT)",
        params: [],
      },
      { method: "runAsync", sql: "INSERT INTO t VALUES (?)", params: ["a"] },
      { method: "getAllAsync", sql: "SELECT * FROM t WHERE a = ?", params: ["a"] },
      { method: "getFirstAsync", sql: "SELECT * FROM t WHERE a = ?", params: ["a"] },
    ]);
    expect(runResult).toEqual({ changes: 3 });
    expect(rows).toEqual([{ value: "row" }]);
    expect(first).toEqual({ value: "first" });
  });

  it("passes an empty parameter list through unchanged (the schema-DDL and count-read shapes)", async () => {
    const { database, calls } = createFakeDatabase();
    const factory = createExpoSqliteDriverFactory("cache.db", {
      async openDatabaseAsync() {
        return database;
      },
    });
    const driver = await factory.open();

    await driver.getFirstAsync("SELECT COUNT(*) as count FROM t", []);

    expect(calls).toEqual([
      { method: "getFirstAsync", sql: "SELECT COUNT(*) as count FROM t", params: [] },
    ]);
  });

  it("delegates closeAsync to the database exactly once", async () => {
    const fake = createFakeDatabase();
    const factory = createExpoSqliteDriverFactory("cache.db", {
      async openDatabaseAsync() {
        return fake.database;
      },
    });
    const driver = await factory.open();

    await driver.closeAsync?.();

    expect(fake.closeCalls()).toBe(1);
  });

  it("rejects open() with a real Error naming the database and the underlying reason", async () => {
    const factory = createExpoSqliteDriverFactory("locked.db", {
      async openDatabaseAsync() {
        throw new Error("disk full");
      },
    });

    await expect(factory.open()).rejects.toThrow(
      'expo-sqlite could not open "locked.db": disk full',
    );
  });

  it("names a non-Error rejection reason without losing it", async () => {
    const factory = createExpoSqliteDriverFactory("locked.db", {
      async openDatabaseAsync() {
        throw "native failure";
      },
    });

    await expect(factory.open()).rejects.toThrow(
      'expo-sqlite could not open "locked.db": native failure',
    );
  });

  it("wires DEFAULT_BINDINGS to expo-sqlite's own openDatabaseAsync", async () => {
    const fake = createFakeDatabase();
    sqliteFixture.state.openedNames.length = 0;
    sqliteFixture.state.database = fake.database;

    const driver = await createExpoSqliteDriverFactory("default.db").open();
    await driver.execAsync("SELECT 1");

    expect(sqliteFixture.state.openedNames).toEqual(["default.db"]);
    expect(fake.calls).toEqual([{ method: "execAsync", sql: "SELECT 1", params: [] }]);
  });
});
