import { describe, expect, onTestFinished, test } from "vitest";
import pino from "pino";

import { PiRpcAgentClient, PiRpcAgentSession } from "./agent.js";
import { FakePi } from "./test-utils/fake-pi.js";
import type { AgentSessionConfig } from "../../agent-sdk-types.js";

function createConfig(overrides: Partial<AgentSessionConfig> = {}): AgentSessionConfig {
  return {
    provider: "pi",
    cwd: "/tmp/paseo-pi-fork-test",
    ...overrides,
  };
}

function createClient(pi = new FakePi()): PiRpcAgentClient {
  return new PiRpcAgentClient({
    logger: pino({ level: "silent" }),
    runtime: pi,
  });
}

async function createSession(pi = new FakePi()): Promise<{
  pi: FakePi;
  session: PiRpcAgentSession;
}> {
  const client = createClient(pi);
  const session = (await client.createSession(createConfig())) as PiRpcAgentSession;
  onTestFinished(() => session.close().catch(() => undefined));
  return { pi, session };
}

describe("PiRpcAgentSession.fork", () => {
  test("sends the mirrored fork command with the given entry id", async () => {
    const { pi, session } = await createSession();
    const fakeSession = pi.latestSession();
    fakeSession.forkResponse = { text: "forked", cancelled: false };

    const result = await session.fork("entry-42");

    expect(fakeSession.forkRequests).toEqual(["entry-42"]);
    expect(result).toEqual({ text: "forked", cancelled: false });
  });

  test("refuses while a turn is active with the same error as revertConversation", async () => {
    const { pi, session } = await createSession();
    await session.startTurn("hello while active");

    const forkError = await session.fork("entry-1").then(
      () => null,
      (error: unknown) => error,
    );
    const revertError = await session.revertConversation({ messageId: "entry-1" }).then(
      () => null,
      (error: unknown) => error,
    );

    expect(forkError).toBeInstanceOf(Error);
    expect(revertError).toBeInstanceOf(Error);
    expect((forkError as Error).message).toBe((revertError as Error).message);
    expect((forkError as Error).message).toBe(
      "Cannot rewind the Pi conversation while a turn is active",
    );
    expect(pi.latestSession().forkRequests).toEqual([]);

    await session.interrupt().catch(() => undefined);
  });

  test("propagates a fork command failure without swallowing it", async () => {
    const { pi, session } = await createSession();
    pi.latestSession().forkError = new Error("Invalid entry ID for forking");

    await expect(session.fork("entry-missing")).rejects.toThrow("Invalid entry ID for forking");
    expect(pi.latestSession().forkRequests).toEqual(["entry-missing"]);
  });

  test("applies a name via the mirrored set_session_name command", async () => {
    const { pi, session } = await createSession();

    await session.setSessionName("explored branch");

    expect(pi.latestSession().sessionNameRequests).toEqual(["explored branch"]);
  });
});
