import { describe, expect, test } from "vitest";

import type { PermissionAnsweredBy } from "@picompanion/protocol/messages";
import { createTestLogger } from "../../test-utils/test-logger.js";
import type {
  AgentPromptInput,
  AgentPermissionResult,
  AgentRunOptions,
  AgentPermissionResponse,
} from "./agent-sdk-types.js";
import type { AgentStreamEvent } from "../messages.js";
import type { ManagedAgent } from "./agent-manager.js";
import { respondToAgentPermission } from "./permission-response.js";

class FakePermissionAgentManager {
  permissionResult: AgentPermissionResult | void;
  hasRunInFlight = false;
  outOfBandHandled = false;
  permissionResponses: Array<{
    agentId: string;
    requestId: string;
    response: AgentPermissionResponse;
    answeredBy?: PermissionAnsweredBy;
  }> = [];
  streamRuns: Array<{ agentId: string; prompt: AgentPromptInput; options?: AgentRunOptions }> = [];
  replacementRuns: Array<{ agentId: string; prompt: AgentPromptInput; options?: AgentRunOptions }> =
    [];

  async respondToPermission(
    agentId: string,
    requestId: string,
    response: AgentPermissionResponse,
    answeredBy?: PermissionAnsweredBy,
  ): Promise<AgentPermissionResult | void> {
    this.permissionResponses.push({ agentId, requestId, response, answeredBy });
    return this.permissionResult;
  }

  tryRunOutOfBand(): boolean {
    return this.outOfBandHandled;
  }

  getAgent(): ManagedAgent | null {
    return null;
  }

  hasInFlightRun(): boolean {
    return this.hasRunInFlight;
  }

  streamAgent(
    agentId: string,
    prompt: AgentPromptInput,
    options?: AgentRunOptions,
  ): AsyncGenerator<AgentStreamEvent> {
    this.streamRuns.push({ agentId, prompt, options });
    return emptyAgentStream();
  }

  async replaceAgentRun(
    agentId: string,
    prompt: AgentPromptInput,
    options?: AgentRunOptions,
  ): Promise<AsyncGenerator<AgentStreamEvent>> {
    this.replacementRuns.push({ agentId, prompt, options });
    return emptyAgentStream();
  }
}

async function* emptyAgentStream(): AsyncGenerator<AgentStreamEvent> {}

describe("respondToAgentPermission", () => {
  const logger = createTestLogger();

  test("starts a follow-up run returned by the provider permission response", async () => {
    const agentManager = new FakePermissionAgentManager();
    agentManager.permissionResult = { followUpPrompt: "implement the approved plan" };

    await respondToAgentPermission({
      agentManager,
      agentId: "agent-1",
      requestId: "permission-1",
      response: { behavior: "allow" },
      logger,
    });

    expect(agentManager.permissionResponses).toEqual([
      {
        agentId: "agent-1",
        requestId: "permission-1",
        response: { behavior: "allow" },
      },
    ]);
    expect(agentManager.streamRuns).toEqual([
      {
        agentId: "agent-1",
        prompt: "implement the approved plan",
      },
    ]);
    expect(agentManager.replacementRuns).toEqual([]);
  });

  test("does not start a run when the permission response has no follow-up prompt", async () => {
    const agentManager = new FakePermissionAgentManager();

    await respondToAgentPermission({
      agentManager,
      agentId: "agent-1",
      requestId: "permission-1",
      response: { behavior: "deny", message: "not now" },
      logger,
    });

    expect(agentManager.permissionResponses).toEqual([
      {
        agentId: "agent-1",
        requestId: "permission-1",
        response: { behavior: "deny", message: "not now" },
      },
    ]);
    expect(agentManager.streamRuns).toEqual([]);
    expect(agentManager.replacementRuns).toEqual([]);
  });

  test("replaces an in-flight run for follow-up prompts", async () => {
    const agentManager = new FakePermissionAgentManager();
    agentManager.hasRunInFlight = true;
    agentManager.permissionResult = { followUpPrompt: "continue after approval" };

    await respondToAgentPermission({
      agentManager,
      agentId: "agent-1",
      requestId: "permission-1",
      response: { behavior: "allow" },
      logger,
    });

    expect(agentManager.streamRuns).toEqual([]);
    expect(agentManager.replacementRuns).toEqual([
      {
        agentId: "agent-1",
        prompt: "continue after approval",
      },
    ]);
  });

  test("forwards the answering client's identity to the agent manager (T111)", async () => {
    const agentManager = new FakePermissionAgentManager();

    await respondToAgentPermission({
      agentManager,
      agentId: "agent-1",
      requestId: "permission-1",
      response: { behavior: "allow" },
      answeredBy: { clientId: "clid_web_0001" },
      logger,
    });

    expect(agentManager.permissionResponses).toEqual([
      {
        agentId: "agent-1",
        requestId: "permission-1",
        response: { behavior: "allow" },
        answeredBy: { clientId: "clid_web_0001" },
      },
    ]);
  });

  test("omitting answeredBy forwards no identity, matching pre-T111 behavior", async () => {
    const agentManager = new FakePermissionAgentManager();

    await respondToAgentPermission({
      agentManager,
      agentId: "agent-1",
      requestId: "permission-1",
      response: { behavior: "allow" },
      logger,
    });

    expect(agentManager.permissionResponses[0]?.answeredBy).toBeUndefined();
  });
});
