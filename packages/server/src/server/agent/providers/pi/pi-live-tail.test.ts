import { mkdtempSync, rmSync, writeFileSync, appendFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import pino from "pino";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, describe, expect, test, vi } from "vitest";

import type { AgentManager, ManagedAgent } from "../../agent-manager.js";
import type { AgentTimelineItem } from "../../agent-sdk-types.js";
import { PiLiveTailWatcher } from "./pi-live-tail.js";

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

  // Only implements the AgentManager surface PiLiveTailWatcher actually calls.
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
  const dir = mkdtempSync(path.join(tmpdir(), "pi-live-tail-test-"));
  tempDirs.push(dir);
  return path.join(dir, "session.jsonl");
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
  vi.restoreAllMocks();
});

function fakeAgent(filePath: string, id = "agent-1"): ManagedAgent {
  return {
    id,
    provider: "pi",
    persistence: { provider: "pi", sessionId: filePath, nativeHandle: filePath },
  } as unknown as ManagedAgent;
}

describe("PiLiveTailWatcher incremental checkpoint", () => {
  test("emits only newly appended items and never rereads bytes already consumed", async () => {
    const filePath = makeSessionFile();
    writeFileSync(filePath, userLine("hello"));

    const agent = fakeAgent(filePath);
    const agentManager = createFakeAgentManager(agent);
    const logger = pino({ level: "silent" });
    const watcher = new PiLiveTailWatcher({
      logger,
      agentManager,
      debounceMs: 5,
      pollIntervalMs: 20,
    });

    watcher.start();
    await waitFor(() => agentManager.appendedItems.length >= 1);

    expect(agentManager.appendedItems).toHaveLength(1);
    expect(agentManager.appendedItems[0]).toMatchObject({ type: "user_message", text: "hello" });

    // Append more content and ensure only the new message is emitted.
    appendFileSync(filePath, assistantLine("world", "resp-1"));
    await waitFor(() => agentManager.appendedItems.length >= 2);

    expect(agentManager.appendedItems).toHaveLength(2);
    expect(agentManager.appendedItems[1]).toMatchObject({
      type: "assistant_message",
      text: "world",
    });

    watcher.stop();
  });

  test("readOffset only advances past complete lines, tolerating mid-write partial lines", async () => {
    const filePath = makeSessionFile();
    writeFileSync(filePath, userLine("first"));

    const agent = fakeAgent(filePath);
    const agentManager = createFakeAgentManager(agent);
    const logger = pino({ level: "silent" });
    const watcher = new PiLiveTailWatcher({
      logger,
      agentManager,
      debounceMs: 5,
      pollIntervalMs: 20,
    });

    watcher.start();
    await waitFor(() => agentManager.appendedItems.length >= 1);
    expect(agentManager.appendedItems).toHaveLength(1);

    // Simulate a writer flushing a partial JSON line (no trailing newline yet).
    const fullLine = userLine("second");
    const splitAt = Math.floor(fullLine.length / 2);
    appendFileSync(filePath, fullLine.slice(0, splitAt));
    // Nothing new should be emitted from a dangling partial line; give it a
    // generous window to prove it stays put rather than racing a fixed delay.
    await delay(150);
    expect(agentManager.appendedItems).toHaveLength(1);

    // Complete the line; the tail should pick up the finished message.
    appendFileSync(filePath, fullLine.slice(splitAt));
    await waitFor(() => agentManager.appendedItems.length >= 2);

    watcher.stop();
    expect(agentManager.appendedItems).toHaveLength(2);
    expect(agentManager.appendedItems[1]).toMatchObject({ type: "user_message", text: "second" });
    expect(statSync(filePath).size).toBeGreaterThan(0);
  });

  test("resets the checkpoint safely when the file is truncated", async () => {
    const filePath = makeSessionFile();
    writeFileSync(filePath, userLine("hello") + assistantLine("world", "resp-1"));

    const agent = fakeAgent(filePath);
    const agentManager = createFakeAgentManager(agent);
    const logger = pino({ level: "silent" });
    const watcher = new PiLiveTailWatcher({
      logger,
      agentManager,
      debounceMs: 5,
      pollIntervalMs: 20,
    });

    watcher.start();
    await waitFor(() => agentManager.appendedItems.length >= 2);
    expect(agentManager.appendedItems).toHaveLength(2);

    // Truncate the file to simulate an unexpected rewrite.
    writeFileSync(filePath, userLine("after-truncate"));
    await waitFor(() => agentManager.appendedItems.length >= 3);

    watcher.stop();
    // Should not throw, should have re-bootstrapped without crashing, and the
    // new content after truncation must still show up (forward progress).
    expect(agentManager.appendedItems.length).toBeGreaterThanOrEqual(3);
    expect(agentManager.appendedItems.at(-1)).toMatchObject({
      type: "user_message",
      text: "after-truncate",
    });
  });
});
