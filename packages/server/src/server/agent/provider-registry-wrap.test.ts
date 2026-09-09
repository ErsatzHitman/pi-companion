import { describe, expect, test } from "vitest";

import type { QueueMode } from "@picompanion/protocol/messages";

import type {
  AgentCapabilityFlags,
  AgentClient,
  AgentPromptInput,
  AgentSession,
  AgentStreamEvent,
  AgentRuntimeInfo,
} from "./agent-sdk-types.js";
import {
  createResolvedProviderClient,
  wrapSessionProvider,
  type ResolvedProvider,
} from "./provider-registry.js";

/**
 * T304: this file used to carry its own second, independent copy of
 * `provider-registry.ts`'s optional-method exhaustiveness check — a
 * `type OptionalAgentSessionMethodName` computed from `AgentSession` plus a
 * hand-maintained name list, asserted exhaustive via
 * `_allOptionalAgentSessionMethodsAreCovered: MissingOptionalAgentSessionMethod
 * extends never ? true : never = true`. T296 (see `provider-registry.ts`'s
 * own `AgentSessionOptionalMethodKey`/`SESSION_OPTIONAL_METHOD_KEYS` doc
 * comments) had already moved the real, load-bearing version of this check
 * into production source, where `npm run typecheck` polices it with no
 * ceiling to hide behind — proven at the P9-S gate in both directions (a
 * 15th optional method added to `AgentSession` fails `TS2741`; making
 * `setModel` required fails `TS2353`). The copy here was never read by
 * anything at runtime (nothing in this file iterated
 * `OPTIONAL_AGENT_SESSION_METHOD_NAMES`; the "forwards every optional
 * AgentSession method" test below hardcodes its own call list), so once the
 * production copy existed this one was a pure `TS6133` "declared but never
 * read" — invisible to `npm run typecheck --workspace=@picompanion/server`
 * (this file is a `*.test.ts`, excluded by `tsconfig.server.typecheck.json`)
 * and tolerated only by `guard-server-test-typecheck-ceiling.mjs`'s
 * `TYPECHECK_ERROR_CEILING`, at zero headroom. T304 deleted it outright
 * rather than `void`-referencing it to silence the warning: keeping a
 * second copy of an exhaustiveness check in a file the production typecheck
 * cannot see buys nothing the production check does not already give, and
 * removing it lowered the ceiling instead of spending it forever on an inert
 * duplicate. `TYPECHECK_ERROR_CEILING` was lowered by the measured delta in
 * the same commit.
 */

const CAPABILITIES: AgentCapabilityFlags = {
  supportsStreaming: true,
  supportsSessionPersistence: true,
  supportsDynamicModes: true,
  supportsMcpServers: true,
  supportsReasoningStream: true,
  supportsToolInvocations: true,
  supportsRewindConversation: true,
  supportsRewindFiles: true,
  supportsRewindBoth: true,
};

const RUNTIME_INFO: AgentRuntimeInfo = {
  provider: "claude",
  sessionId: "session-1",
};

class FakeSession implements AgentSession {
  readonly provider = "claude";
  readonly id = "session-1";
  readonly capabilities = CAPABILITIES;
  readonly features = [];
  readonly recordedCalls: string[] = [];

  async run() {
    this.recordedCalls.push("run");
    return { sessionId: "session-1", finalText: "", timeline: [] };
  }

  async startTurn() {
    this.recordedCalls.push("startTurn");
    return { turnId: "turn-1" };
  }

  subscribe(_callback: (event: AgentStreamEvent) => void) {
    this.recordedCalls.push("subscribe");
    return () => {};
  }

  async *streamHistory() {
    this.recordedCalls.push("streamHistory");
    yield* emptyHistory();
  }

  async getRuntimeInfo() {
    this.recordedCalls.push("getRuntimeInfo");
    return RUNTIME_INFO;
  }

  async getAvailableModes() {
    this.recordedCalls.push("getAvailableModes");
    return [];
  }

  async getCurrentMode() {
    this.recordedCalls.push("getCurrentMode");
    return null;
  }

  async setMode(_modeId: string) {
    this.recordedCalls.push("setMode");
  }

  getPendingPermissions() {
    this.recordedCalls.push("getPendingPermissions");
    return [];
  }

  async respondToPermission() {
    this.recordedCalls.push("respondToPermission");
  }

  describePersistence() {
    this.recordedCalls.push("describePersistence");
    return null;
  }

  async interrupt() {
    this.recordedCalls.push("interrupt");
  }

  async close() {
    this.recordedCalls.push("close");
  }

  async listCommands() {
    this.recordedCalls.push("listCommands");
    return [];
  }

  async setModel() {
    this.recordedCalls.push("setModel");
  }

  async setThinkingOption() {
    this.recordedCalls.push("setThinkingOption");
  }

  async setFeature() {
    this.recordedCalls.push("setFeature");
  }

  async setSteeringMode(_mode: QueueMode) {
    this.recordedCalls.push("setSteeringMode");
  }

  async setFollowUpMode(_mode: QueueMode) {
    this.recordedCalls.push("setFollowUpMode");
  }

  async getQueueModes() {
    this.recordedCalls.push("getQueueModes");
    return { steeringMode: null, followUpMode: null };
  }

  respondToEditorTextRequest(_requestId: string, _text: string) {
    this.recordedCalls.push("respondToEditorTextRequest");
  }

  async setAutoCompaction(_enabled: boolean) {
    this.recordedCalls.push("setAutoCompaction");
  }

  async getAutoCompaction() {
    this.recordedCalls.push("getAutoCompaction");
    return null;
  }

  async revertConversation() {
    this.recordedCalls.push("revertConversation");
  }

  async revertFiles() {
    this.recordedCalls.push("revertFiles");
  }

  async revertBoth() {
    this.recordedCalls.push("revertBoth");
  }

  tryHandleOutOfBand(_prompt: AgentPromptInput) {
    this.recordedCalls.push("tryHandleOutOfBand");
    return {
      run: async () => {
        this.recordedCalls.push("tryHandleOutOfBand.run");
      },
    };
  }
}

async function* emptyHistory(): AsyncGenerator<AgentStreamEvent> {
  for (const event of [] as AgentStreamEvent[]) {
    yield event;
  }
}

describe("wrapSessionProvider", () => {
  test("forwards every optional AgentSession method", async () => {
    const session = new FakeSession();
    const wrapped = wrapSessionProvider("custom-claude", session);

    await wrapped.listCommands?.();
    await wrapped.setModel?.("sonnet");
    await wrapped.setThinkingOption?.("high");
    await wrapped.setFeature?.("feature-1", true);
    await wrapped.setSteeringMode?.("all");
    await wrapped.setFollowUpMode?.("one-at-a-time");
    await wrapped.getQueueModes?.();
    wrapped.respondToEditorTextRequest?.("request-1", "draft text");
    await wrapped.setAutoCompaction?.(true);
    await wrapped.getAutoCompaction?.();
    await wrapped.revertConversation?.({ messageId: "message-1" });
    await wrapped.revertFiles?.({ messageId: "message-1" });
    await wrapped.revertBoth?.({ messageId: "message-1" });
    const handler = wrapped.tryHandleOutOfBand?.("/compact");
    await handler?.run({ emit: () => {} });

    expect(session.recordedCalls).toEqual([
      "listCommands",
      "setModel",
      "setThinkingOption",
      "setFeature",
      "setSteeringMode",
      "setFollowUpMode",
      "getQueueModes",
      "respondToEditorTextRequest",
      "setAutoCompaction",
      "getAutoCompaction",
      "revertConversation",
      "revertFiles",
      "revertBoth",
      "tryHandleOutOfBand",
      "tryHandleOutOfBand.run",
    ]);
  });

  /**
   * Added at the P9-S merge gate. `forwardOptionalSessionMethods`' guard
   * (`typeof method === "function"`) had only its TRUE branch covered: the
   * `FakeSession` above implements all 14 optional methods, so no test
   * constructed an inner session that LACKS one. That left the mechanism
   * this task chose over a `Proxy` free to regress into the exact behaviour
   * it was chosen to avoid — measured at the gate by mutating the guard to
   * `typeof method === "function" ? method.bind(inner) : () => undefined`,
   * which left the suite at 3/3 green. Under that mutation the five real
   * `if (!agent.session.setSteeringMode)`-shaped capability checks in
   * `agent-manager.ts` would report a capability present and call a stub
   * that silently does nothing — the same class of silent inertness T296
   * exists to remove. The exhaustiveness check in `provider-registry.ts`
   * cannot catch it: that polices the key LIST, not the binding behaviour.
   */
  test("omits, rather than fabricates, an optional method the inner session does not implement", async () => {
    const session = new FakeSession();
    // Shadowed on the instance rather than deleted from the prototype: this
    // is what a provider implementing only part of the optional surface
    // actually looks like at runtime.
    Object.defineProperty(session, "setSteeringMode", { value: undefined, configurable: true });
    Object.defineProperty(session, "getQueueModes", { value: undefined, configurable: true });

    const wrapped = wrapSessionProvider("custom-claude", session);

    // The capability-check shape `agent-manager.ts` really uses must stay
    // honest: absent means absent, not a stub.
    expect(wrapped.setSteeringMode).toBeUndefined();
    expect(wrapped.getQueueModes).toBeUndefined();
    expect("setSteeringMode" in wrapped).toBe(false);
    expect("getQueueModes" in wrapped).toBe(false);

    // ...while every method the inner session DOES implement is still bound.
    expect(typeof wrapped.setAutoCompaction).toBe("function");
    expect(typeof wrapped.respondToEditorTextRequest).toBe("function");
    await wrapped.setAutoCompaction?.(true);
    expect(session.recordedCalls).toEqual(["setAutoCompaction"]);
  });
});

describe("createResolvedProviderClient", () => {
  function fakeResolvedProvider(
    session: FakeSession,
    overrides: Partial<ResolvedProvider> = {},
  ): ResolvedProvider {
    const client: AgentClient = {
      provider: "pi",
      capabilities: CAPABILITIES,
      createSession: async () => session,
      resumeSession: async () => session,
      fetchCatalog: async () => ({ models: [], modes: [] }),
      isAvailable: async () => true,
    };

    return {
      definition: {} as ResolvedProvider["definition"],
      profileModels: [],
      additionalModels: [],
      profileModelsAreAdditive: false,
      enabled: true,
      derivedFromProviderId: null,
      createBaseClient: () => client,
      ...overrides,
    };
  }

  test("the plain builtin case (no model overrides) returns the inner client unwrapped", async () => {
    // This is the fast path T296's brief names: `inner.provider === provider
    // && !hasModelOverrides`. An unwrapped client's session is `inner`
    // itself, so every optional method is trivially present — this test
    // exists to pin that the fast path really is taken here, not to prove
    // forwarding (there is nothing to forward).
    const session = new FakeSession();
    const resolved = fakeResolvedProvider(session);
    const client = createResolvedProviderClient({} as never, "pi", resolved);

    const createdSession = await client.createSession({} as never);
    expect(createdSession).toBe(session);
    expect(typeof createdSession.respondToEditorTextRequest).toBe("function");
  });

  test("a provider profile carrying model overrides wraps the session, and every optional method survives", async () => {
    // T296's actual escape: a provider profile with model overrides (or an
    // aliased/derived provider whose base client reports a different
    // `.provider`) fails `inner.provider === provider && !hasModelOverrides`
    // and goes through `wrapClientProvider` -> `wrapSessionProvider`. Before
    // this task, six optional AgentSession methods — including T293's
    // `respondToEditorTextRequest` — were silently dropped on exactly this
    // path.
    const session = new FakeSession();
    const resolved = fakeResolvedProvider(session, {
      profileModels: [{ id: "custom-model", label: "Custom Model" }],
    });
    const client = createResolvedProviderClient({} as never, "pi", resolved);

    const createdSession = await client.createSession({} as never);
    expect(createdSession).not.toBe(session);

    await createdSession.getQueueModes?.();
    createdSession.respondToEditorTextRequest?.("request-1", "draft text");
    await createdSession.setAutoCompaction?.(true);

    expect(session.recordedCalls).toEqual([
      "getQueueModes",
      "respondToEditorTextRequest",
      "setAutoCompaction",
    ]);
  });
});
