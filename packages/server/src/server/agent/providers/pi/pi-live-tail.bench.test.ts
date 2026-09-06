import { appendFileSync, closeSync, mkdtempSync, openSync, rmSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import pino from "pino";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, describe, expect, test } from "vitest";

import type { AgentManager, ManagedAgent } from "../../agent-manager.js";
import type { AgentTimelineItem } from "../../agent-sdk-types.js";
import { PiLiveTailWatcher } from "./pi-live-tail.js";

/**
 * plan.md §13 benchmark: "Add long-session and duplicate-import tests for
 * the watcher/live tail. A 100,000-entry synthetic session must read work
 * proportional to appended bytes; warm append processing should stay below
 * 250 ms p95 and 50 MiB additional peak memory on the reference laptop."
 *
 * This is opt-in (skipped by default, including in the plain `npm test`
 * run) because building + bootstrapping a 100,000-entry session is much
 * heavier than a unit test. Run it one-shot with:
 *
 *   npm run bench:pi-live-tail --workspace packages/server
 *
 * which sets RUN_LIVE_TAIL_BENCH=1 and --expose-gc for an accurate heap
 * delta measurement.
 */
const RUN_BENCH = process.env.RUN_LIVE_TAIL_BENCH === "1";
const ENTRY_COUNT = 100_000;
const WARM_SAMPLES = 30;

function jsonlLine(message: Record<string, unknown>): string {
  return `${JSON.stringify({ type: "message", message })}\n`;
}

function userLine(text: string): string {
  return jsonlLine({ role: "user", content: text });
}

function assistantLine(text: string, responseId: string): string {
  return jsonlLine({
    role: "assistant",
    content: [{ type: "text", text }],
    responseId,
  });
}

interface FakeAgentManager extends AgentManager {
  appendedItems: AgentTimelineItem[];
}

function createFakeAgentManager(agent: ManagedAgent): FakeAgentManager {
  const timeline: AgentTimelineItem[] = [];
  const appendedItems: AgentTimelineItem[] = [];

  return {
    listAgents: () => [agent],
    subscribe: () => () => {},
    getAgent: (id: string) => (id === agent.id ? agent : null),
    getTimeline: () => timeline.slice(),
    appendTimelineItem: async (_agentId: string, item: AgentTimelineItem) => {
      timeline.push(item);
      appendedItems.push(item);
    },
    appendedItems,
  } as unknown as FakeAgentManager;
}

function fakeAgent(filePath: string, id: string): ManagedAgent {
  return {
    id,
    provider: "pi",
    persistence: { provider: "pi", sessionId: filePath, nativeHandle: filePath },
  } as unknown as ManagedAgent;
}

async function waitFor(predicate: () => boolean, timeoutMs = 10000, stepMs = 10): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await delay(stepMs);
  }
  if (!predicate()) {
    throw new Error(`waitFor: condition not met within ${timeoutMs}ms`);
  }
}

const tempDirs: string[] = [];

function makeSessionFile(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "pi-live-tail-bench-"));
  tempDirs.push(dir);
  return path.join(dir, "session.jsonl");
}

/** Writes `entryCount` alternating user/assistant JSONL entries in chunks. */
function writeSyntheticSession(filePath: string, entryCount: number): void {
  const fd = openSync(filePath, "w");
  try {
    let buffer = "";
    for (let i = 0; i < entryCount; i++) {
      buffer +=
        i % 2 === 0
          ? userLine(`synthetic user message #${i}`)
          : assistantLine(`synthetic assistant reply #${i}`, `resp-${i}`);
      if (buffer.length > 1_000_000) {
        writeSync(fd, buffer);
        buffer = "";
      }
    }
    if (buffer) writeSync(fd, buffer);
  } finally {
    closeSync(fd);
  }
}

function percentile(samples: readonly number[], p: number): number {
  const sorted = [...samples].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx] ?? 0;
}

function heapUsedMb(): number {
  const gc = (global as unknown as { gc?: () => void }).gc;
  if (typeof gc === "function") gc();
  return process.memoryUsage().heapUsed / (1024 * 1024);
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe.skipIf(!RUN_BENCH)("PiLiveTailWatcher live-tail benchmark (plan §13, opt-in)", () => {
  test(`warm append processing on a ${ENTRY_COUNT}-entry session stays under the p95/memory budget`, async () => {
    const filePath = makeSessionFile();
    writeSyntheticSession(filePath, ENTRY_COUNT);

    const agent = fakeAgent(filePath, "agent-bench");
    const agentManager = createFakeAgentManager(agent);
    const watcher = new PiLiveTailWatcher({
      logger: pino({ level: "silent" }),
      agentManager,
      debounceMs: 5,
      pollIntervalMs: 250,
    });

    // One-time bootstrap pass (unmeasured against the warm-path budget:
    // the plan explicitly scopes the 250ms/50MiB target to warm appends).
    const bootstrapStart = Date.now();
    watcher.start();
    await waitFor(() => agentManager.appendedItems.length >= ENTRY_COUNT, 120_000, 25);
    const bootstrapMs = Date.now() - bootstrapStart;
    // eslint-disable-next-line no-console
    console.log(`[bench] bootstrap of ${ENTRY_COUNT} entries took ${bootstrapMs}ms`);

    // Warm phase: append one small entry at a time and measure wall-clock
    // latency from write to the corresponding timeline append. Work here
    // must be proportional to the appended bytes, not the file's total
    // size (that's what the byte-offset checkpoint from T09A buys us).
    const latenciesMs: number[] = [];
    const memBefore = heapUsedMb();

    for (let i = 0; i < WARM_SAMPLES; i++) {
      const before = agentManager.appendedItems.length;
      const start = Date.now();
      appendFileSync(filePath, userLine(`warm append #${i}`));
      await waitFor(() => agentManager.appendedItems.length > before, 5000, 2);
      latenciesMs.push(Date.now() - start);
    }

    const memAfter = heapUsedMb();
    watcher.stop();

    const p95 = percentile(latenciesMs, 95);
    const heapDeltaMb = memAfter - memBefore;
    // eslint-disable-next-line no-console
    console.log(
      `[bench] warm append p95=${p95.toFixed(1)}ms heapDelta=${heapDeltaMb.toFixed(2)}MiB ` +
        `samples=${JSON.stringify(latenciesMs)}`,
    );

    expect(agentManager.appendedItems).toHaveLength(ENTRY_COUNT + WARM_SAMPLES);
    expect(p95).toBeLessThan(250);
    expect(heapDeltaMb).toBeLessThan(50);
  }, 180_000);

  test("warm append latency stays proportional to appended bytes, not total file size", async () => {
    // Small-file baseline.
    const smallPath = makeSessionFile();
    writeSyntheticSession(smallPath, 50);
    const smallAgent = fakeAgent(smallPath, "agent-small");
    const smallManager = createFakeAgentManager(smallAgent);
    const smallWatcher = new PiLiveTailWatcher({
      logger: pino({ level: "silent" }),
      agentManager: smallManager,
      debounceMs: 5,
      pollIntervalMs: 250,
    });
    smallWatcher.start();
    await waitFor(() => smallManager.appendedItems.length >= 50);

    const smallStart = Date.now();
    appendFileSync(smallPath, userLine("small warm append"));
    await waitFor(() => smallManager.appendedItems.length >= 51);
    const smallLatencyMs = Date.now() - smallStart;
    smallWatcher.stop();

    // Large-file case: same single-entry append, on top of a 100,000-entry
    // session that has already been bootstrapped once.
    const bigPath = makeSessionFile();
    writeSyntheticSession(bigPath, ENTRY_COUNT);
    const bigAgent = fakeAgent(bigPath, "agent-big");
    const bigManager = createFakeAgentManager(bigAgent);
    const bigWatcher = new PiLiveTailWatcher({
      logger: pino({ level: "silent" }),
      agentManager: bigManager,
      debounceMs: 5,
      pollIntervalMs: 250,
    });
    bigWatcher.start();
    await waitFor(() => bigManager.appendedItems.length >= ENTRY_COUNT, 120_000, 25);

    const bigStart = Date.now();
    appendFileSync(bigPath, userLine("big warm append"));
    await waitFor(() => bigManager.appendedItems.length >= ENTRY_COUNT + 1);
    const bigLatencyMs = Date.now() - bigStart;
    bigWatcher.stop();

    // eslint-disable-next-line no-console
    console.log(`[bench] proportionality: small=${smallLatencyMs}ms big=${bigLatencyMs}ms`);

    // A whole-file reread/remap on every change (the behavior T09A
    // replaced with a byte-offset checkpoint) would make the big-file
    // append orders of magnitude slower than the small-file one. Allow
    // generous headroom for scheduling noise while still catching a
    // regression back to O(file size) behavior.
    expect(bigLatencyMs).toBeLessThan(Math.max(250, smallLatencyMs * 10 + 200));
  }, 180_000);
});
