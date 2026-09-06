/**
 * Deterministic fake **`pi`** provider `AgentClient`/`AgentSession` for
 * the isolated E2E daemon (`daemon.ts`).
 *
 * **Why this exists, instead of reusing `packages/server`'s own
 * `test-utils/fake-agent-client.ts`.** That file is real, already-tested
 * backend test infrastructure, but two things rule out importing it
 * from here: (1) `packages/server/tsconfig.server.json` explicitly
 * excludes every `src/server/**\/test-utils/**` path from the build
 * (`dist/` never contains it), and `@picompanion/server`'s
 * `package.json` `"exports"` map has no subpath for it either -- there
 * is no way to reach it from a different workspace without either
 * changing that package's build/export surface (outside every file this
 * task, T31B, owns -- `apps/web/e2e/` only) or a source-relative
 * cross-workspace import (the repository invariant this project's
 * `CLAUDE.md` forbids: "never source-relative cross-workspace paths").
 * (2) Even if it were reachable, it only registers **`claude`/`codex`/
 * `opencode`** fake clients (`createTestAgentClients`) -- Paseo-era
 * provider ids. This product is Pi-only
 * (`packages/protocol/src/provider-manifest.ts`'s `AGENT_PROVIDER_DEFINITIONS`
 * lists exactly one provider, `"pi"`; plan.md §2.3 "non-goals": "non-Pi
 * agent providers"), so `packages/server/src/server/agent/
 * provider-snapshot-manager.ts`'s `buildRegistry()` only merges an
 * `extraClients` override onto a provider id that already has a
 * registry `definition` -- passing a `claude`/`codex` fake client (as
 * this suite's first draft did) surfaces as `createAgent` rejecting
 * with "Provider claude is not configured", proven empirically against
 * this exact isolated daemon before this file existed.
 *
 * This is therefore a small, independent, T31B-owned implementation of
 * the same `AgentClient`/`AgentSession` *shape*
 * (`packages/server/src/server/agent/agent-sdk-types.ts`, read-only
 * reference -- never imported) for the one provider id this product
 * actually has, covering exactly what T31B's scenarios need and no
 * more: a plain deterministic reply, a real ~300ms interruptible tool
 * delay (steer/follow-up timing), a generic/unknown-detail tool call
 * (`tool-call-row.tsx`'s `UnknownToolCard`, "open tool details"), and an
 * edit-family tool call carrying a real `unifiedDiff` ("...and diff").
 *
 * T31C1 (`apps/web/e2e/approvals.spec.ts`) additionally teaches this
 * fake session two deterministic prompts -- `/request permission/i` and
 * `/request dangerous permission/i` -- that emit a real
 * `permission_requested` stream event (a `Bash` tool call carrying a
 * two-action allow/deny `AgentPermissionRequest`, the dangerous variant
 * flagging its `deny` action `variant: "danger"`, matching the recorded
 * `permission-dialog.json` fixture's own convention) and block the turn
 * on `respondToPermission` actually resolving it, exactly the way a real
 * Pi tool-approval gate would. A second, stale `respondToPermission`
 * call for an already-resolved `requestId` (the losing side of two
 * clients racing to answer the same request, plan.md §12.3's "single-
 * answer semantics") is a deliberate no-op here, not a throw -- see
 * `respondToPermission`'s own doc comment.
 *
 * T31C2 (the Pi extension bridge scenarios) additionally teaches this
 * fake session two deterministic prompts -- `/emit ui widget element/i`
 * and `/emit ui malformed element/i` -- that emit a real `pi_ui_state`
 * `AgentStreamEvent` carrying one pinned `PiUiElement`, via
 * `emitUiElement`. Unlike the rest of this file's `Fake*` types, the
 * `pi_ui_state` event's own `PiUiElement`/`PiUiState` payload is imported
 * directly from `@picompanion/protocol/pi-ui-bridge/schema` rather than
 * locally mirrored: that module is `@picompanion/protocol`'s own public
 * export (unlike `agent-sdk-types.ts`, which belongs to
 * `@picompanion/server` and is read-only reference per this module's
 * first paragraph), so there is no package-boundary reason to hand-copy
 * it here the way the rest of `FakeAgentStreamEvent` is hand-copied.
 */
import { randomUUID } from "node:crypto";
import type { PiUiElement, PiUiState } from "@picompanion/protocol/pi-ui-bridge/schema";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function buildRepeatedDiffPayload(bytes: number): string {
  const line = `diff ${"x".repeat(96)}\n`;
  let output = "";
  while (output.length < bytes) {
    output += line;
  }
  return output.slice(0, bytes);
}

/** `parseDiffPrompt("emit 3072 byte diff agent stream payload")` -> `3072`. */
function parseDiffPrompt(prompt: string): number | null {
  const match = /emit\s+(\d+)\s+byte diff agent stream payload/i.exec(prompt);
  if (!match) return null;
  const bytes = Number(match[1]);
  return Number.isFinite(bytes) && bytes > 0 ? Math.min(bytes, 200_000) : null;
}

/**
 * `"request dangerous permission"` before `"request permission"` since
 * the former is also a substring match of the latter's pattern --
 * order matters here. Returns `null` for every other prompt, matching
 * `parseDiffPrompt`'s own "no match, fall through to the rest of
 * `runTurn`" convention.
 */
function parsePermissionPrompt(prompt: string): { dangerous: boolean } | null {
  if (/request dangerous permission/i.test(prompt)) return { dangerous: true };
  if (/request permission/i.test(prompt)) return { dangerous: false };
  return null;
}

type UiElementPromptKind = "widget" | "malformed";

/**
 * `parseUiElementPrompt("emit ui malformed element")` -> `"malformed"`.
 * Neither pattern is a substring of the other (unlike
 * `parsePermissionPrompt`'s pair), so check order is not load-bearing
 * here -- kept in the same "more specific first" shape as that function
 * only for consistency.
 */
function parseUiElementPrompt(prompt: string): UiElementPromptKind | null {
  if (/emit ui malformed element/i.test(prompt)) return "malformed";
  if (/emit ui widget element/i.test(prompt)) return "widget";
  return null;
}

/**
 * Locally mirrors just the `AgentStreamEvent` variants this fake
 * session actually emits (`agent-sdk-types.ts`'s discriminated union,
 * read-only reference — never imported: it is not part of
 * `@picompanion/server`'s public `exports.ts`, and this module's own
 * doc comment already explains why importing across that boundary is
 * off the table). Every field here matches its real counterpart
 * field-for-field so this type is a genuine structural subtype of the
 * real `AgentStreamEvent`/`AgentTimelineItem` — the same property
 * `daemon.ts`'s `agentClients: { pi: new FakePiAgentClient() }` needs
 * to type-check against the real `AgentClient`/`AgentSession`
 * interfaces, not merely something cast past the compiler.
 */
interface FakeThreadStartedEvent {
  type: "thread_started";
  sessionId: string;
  provider: "pi";
}
interface FakeTurnStartedEvent {
  type: "turn_started";
  provider: "pi";
  turnId?: string;
}
interface FakeUsage {
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  totalCostUsd?: number;
  contextWindowMaxTokens?: number;
  contextWindowUsedTokens?: number;
}
interface FakeTurnCompletedEvent {
  type: "turn_completed";
  provider: "pi";
  usage?: FakeUsage;
  turnId?: string;
}
interface FakeTurnCanceledEvent {
  type: "turn_canceled";
  provider: "pi";
  reason: string;
  turnId?: string;
}
type FakeToolCallDetail =
  | { type: "unknown"; input: unknown; output: unknown }
  | {
      type: "edit";
      filePath: string;
      oldString?: string;
      newString?: string;
      unifiedDiff?: string;
      edits?: Array<{ oldString: string; newString: string }>;
    };
interface FakeToolCallItemBase {
  [key: string]: unknown;
  type: "tool_call";
  callId: string;
  name: string;
  detail: FakeToolCallDetail;
}
type FakeToolCallItem =
  | (FakeToolCallItemBase & { status: "running"; error: null })
  | (FakeToolCallItemBase & { status: "completed"; error: null })
  | (FakeToolCallItemBase & { status: "canceled"; error: null });
interface FakeAssistantMessageItem {
  type: "assistant_message";
  text: string;
}
type FakeTimelineItem = FakeAssistantMessageItem | FakeToolCallItem;
interface FakeTimelineEvent {
  type: "timeline";
  item: FakeTimelineItem;
  provider: "pi";
  turnId?: string;
  timestamp?: string;
}
/**
 * Structural subtype of `AgentPermissionAction`/`AgentPermissionRequest`/
 * `AgentPermissionResponse` (`agent-sdk-types.ts`, read-only reference —
 * never imported, per this module's doc comment) narrowed to exactly
 * the shape `approvals.spec.ts` (T31C1) needs: a two-action allow/deny
 * `"tool"`-kind request, optionally flagging its `deny` action
 * `variant: "danger"` — the same signal `PermissionDialog.tsx`'s
 * `isDangerousRequest` reads, and the same shape the recorded
 * `permission-dialog.json` fixture's own `deny` action carries.
 */
interface FakePermissionAction {
  id: string;
  label: string;
  behavior: "allow" | "deny";
  variant?: "primary" | "secondary" | "danger";
}
interface FakePermissionRequest {
  id: string;
  provider: "pi";
  name: string;
  kind: "tool";
  title?: string;
  description?: string;
  input?: Record<string, unknown>;
  actions?: FakePermissionAction[];
}
type FakePermissionResponse =
  | { behavior: "allow"; selectedActionId?: string }
  | { behavior: "deny"; selectedActionId?: string; message?: string };
interface FakePermissionRequestedEvent {
  type: "permission_requested";
  provider: "pi";
  request: FakePermissionRequest;
}
interface FakePermissionResolvedEvent {
  type: "permission_resolved";
  provider: "pi";
  requestId: string;
  resolution: FakePermissionResponse;
}
/**
 * Structural match for `AgentStreamEventPayloadSchema`'s `pi_ui_state`
 * variant (`packages/protocol/src/messages.ts`) -- `state` is the real,
 * imported `PiUiState`, not a locally mirrored type, per this module's
 * doc comment.
 */
interface FakePiUiStateEvent {
  type: "pi_ui_state";
  provider: "pi";
  state: PiUiState;
}
type FakeAgentStreamEvent =
  | FakeThreadStartedEvent
  | FakeTurnStartedEvent
  | FakeTurnCompletedEvent
  | FakeTurnCanceledEvent
  | FakeTimelineEvent
  | FakePermissionRequestedEvent
  | FakePermissionResolvedEvent
  | FakePiUiStateEvent;

class FakePiAgentSession {
  readonly capabilities = {
    supportsStreaming: true,
    supportsSessionPersistence: true,
    supportsDynamicModes: true,
    supportsMcpServers: false,
    supportsReasoningStream: true,
    supportsToolInvocations: true,
    supportsRewindConversation: false,
    supportsRewindFiles: false,
    supportsRewindBoth: false,
  };
  readonly id: string;
  private modeId: string | null;
  private readonly cwd: string;
  /**
   * The daemon-assigned agent id (`AgentLaunchContext.agentId`), captured
   * from `FakePiAgentClient.createSession`'s second parameter -- distinct
   * from `this.id`, this session's own persistence `sessionId`. `emitUiElement`
   * keys its `pi_ui_state.state.agentId` off this field, never `this.id`,
   * because that is the field `PiUiElementStore.ingestFullState`
   * (`packages/frontend-core/src/extensions/state.ts`) and the web UI's
   * route-`agentId`-filtered subscription (`root-route.tsx`'s
   * `ExtensionRailContent`) both actually key off. `null` when this fake is
   * exercised outside a real daemon-driven `createSession` call (e.g. a
   * future direct unit test), in which case `emitUiElement` throws rather
   * than silently emitting under the wrong key.
   */
  private readonly daemonAgentId: string | null;
  private readonly subscribers = new Set<(event: FakeAgentStreamEvent) => void>();
  private interruptSignal = createDeferred<void>();
  private activeTurnId: string | null = null;
  private readonly pendingPermissions = new Map<string, FakePermissionRequest>();
  private readonly permissionResolvers = new Map<
    string,
    (response: FakePermissionResponse) => void
  >();

  constructor(options: {
    sessionId?: string;
    cwd: string;
    modeId?: string | null;
    daemonAgentId?: string | null;
  }) {
    this.id = options.sessionId ?? randomUUID();
    this.cwd = options.cwd;
    this.modeId = options.modeId ?? null;
    this.daemonAgentId = options.daemonAgentId ?? null;
  }

  get provider() {
    return "pi";
  }

  get features() {
    return [];
  }

  private emit(event: FakeAgentStreamEvent): void {
    const tagged: FakeAgentStreamEvent =
      this.activeTurnId && "turnId" in event ? { ...event, turnId: this.activeTurnId } : event;
    for (const subscriber of this.subscribers) {
      try {
        subscriber(tagged);
      } catch {
        // Error isolation, matching every other fake provider session's precedent.
      }
    }
  }

  subscribe(callback: (event: FakeAgentStreamEvent) => void): () => void {
    this.subscribers.add(callback);
    return () => {
      this.subscribers.delete(callback);
    };
  }

  /**
   * Never actually called: `AgentManager` (`agent-manager.ts`) always
   * drives an interactive turn through `startTurn` + `subscribe`, never
   * this method directly — see that file's own `streamAgent`. Still a
   * required `AgentSession` member, typed precisely enough (the
   * `timeline` entry's `type` field kept as the literal
   * `"assistant_message"`, matching `AgentTimelineItem`'s discriminated
   * union) to stay structurally assignable without importing that type
   * across the package boundary (see this module's doc comment).
   */
  async run(prompt: unknown): Promise<{
    sessionId: string;
    finalText: string;
    timeline: Array<{ type: "assistant_message"; text: string }>;
  }> {
    const text = this.replyFor(typeof prompt === "string" ? prompt : JSON.stringify(prompt));
    return {
      sessionId: this.id,
      finalText: text,
      timeline: [{ type: "assistant_message", text }],
    };
  }

  async startTurn(prompt: unknown): Promise<{ turnId: string }> {
    if (this.activeTurnId) {
      throw new Error("A foreground turn is already active");
    }
    const turnId = `e2e-turn-${randomUUID()}`;
    this.activeTurnId = turnId;
    void this.runTurn(typeof prompt === "string" ? prompt : JSON.stringify(prompt));
    return { turnId };
  }

  private replyFor(prompt: string): string {
    const exactMatch = /respond with exactly:\s*(.+)$/i.exec(prompt.trim());
    if (exactMatch) return exactMatch[1]!.trim();
    const sayMatch = /\bsay\s+['“]([^'”]+)['”]/i.exec(prompt);
    if (sayMatch) return sayMatch[1]!.trim();
    return "Hello world";
  }

  private async runTurn(prompt: string): Promise<void> {
    this.interruptSignal = createDeferred<void>();
    try {
      this.emit({ type: "thread_started", provider: "pi", sessionId: this.id });
      this.emit({ type: "turn_started", provider: "pi" });

      const diffBytes = parseDiffPrompt(prompt);
      if (diffBytes !== null) {
        await this.runDiffTool(diffBytes);
        this.emit({
          type: "turn_completed",
          provider: "pi",
          usage: { inputTokens: 1, outputTokens: diffBytes },
        });
        return;
      }

      const permissionSpec = parsePermissionPrompt(prompt);
      if (permissionSpec !== null) {
        await this.runPermissionTool(permissionSpec);
        this.emit({
          type: "turn_completed",
          provider: "pi",
          usage: { inputTokens: 1, outputTokens: 1 },
        });
        return;
      }

      const uiElementKind = parseUiElementPrompt(prompt);
      if (uiElementKind !== null) {
        this.emitUiElement(uiElementKind);
        this.emit({
          type: "turn_completed",
          provider: "pi",
          usage: { inputTokens: 1, outputTokens: 1 },
        });
        return;
      }

      if (/echo hello/i.test(prompt)) {
        await this.runShellTool("echo hello", { stdout: "hello\n" });
      } else if (/sleep/i.test(prompt)) {
        const interrupted = await this.runSleepTool();
        if (interrupted) {
          this.emit({ type: "turn_canceled", provider: "pi", reason: "interrupted" });
          return;
        }
      }

      const replyText = this.replyFor(prompt);
      const firstChunk = replyText.slice(0, Math.ceil(replyText.length / 2)) || replyText;
      const secondChunk = replyText.slice(firstChunk.length);
      this.emit({
        type: "timeline",
        provider: "pi",
        item: { type: "assistant_message", text: firstChunk },
      });
      if (secondChunk) {
        this.emit({
          type: "timeline",
          provider: "pi",
          item: { type: "assistant_message", text: secondChunk },
        });
      }
      this.emit({
        type: "turn_completed",
        provider: "pi",
        usage: { inputTokens: 1, outputTokens: 1 },
      });
    } finally {
      this.activeTurnId = null;
    }
  }

  private async runShellTool(command: string, output: Record<string, unknown>): Promise<void> {
    const callId = randomUUID();
    this.emit({
      type: "timeline",
      provider: "pi",
      item: {
        type: "tool_call",
        name: "Bash",
        callId,
        status: "running",
        detail: { type: "unknown", input: { command }, output: null },
        error: null,
      },
    });
    this.emit({
      type: "timeline",
      provider: "pi",
      item: {
        type: "tool_call",
        name: "Bash",
        callId,
        status: "completed",
        detail: { type: "unknown", input: { command }, output },
        error: null,
      },
    });
  }

  /** Returns `true` if `interrupt()` won the race (the caller should stop the turn there). */
  private async runSleepTool(): Promise<boolean> {
    const callId = randomUUID();
    this.emit({
      type: "timeline",
      provider: "pi",
      item: {
        type: "tool_call",
        name: "Bash",
        callId,
        status: "running",
        detail: { type: "unknown", input: { command: "sleep 30" }, output: null },
        error: null,
      },
    });

    const interrupted = await Promise.race([
      this.interruptSignal.promise.then(() => true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 300)),
    ]);

    this.emit({
      type: "timeline",
      provider: "pi",
      item: {
        type: "tool_call",
        name: "Bash",
        callId,
        status: interrupted ? "canceled" : "completed",
        detail: {
          type: "unknown",
          input: { command: "sleep 30" },
          output: interrupted ? null : { ok: true },
        },
        error: null,
      },
    });
    return interrupted;
  }

  /**
   * Emits a real `permission_requested` for a `Bash` tool call and
   * blocks the turn on `respondToPermission` actually resolving it —
   * see this module's doc comment. The running `tool_call` timeline item
   * emitted first (before the request) mirrors the real Pi provider's
   * own order (`providers/pi/agent.ts`: the tool call starts running,
   * *then* the permission gate blocks it), so `approvals.spec.ts` can
   * assert the transcript shows the pending command before the dialog
   * resolves it one way or the other.
   */
  private async runPermissionTool(spec: { dangerous: boolean }): Promise<void> {
    const callId = randomUUID();
    const requestId = `perm-${randomUUID()}`;
    const command = spec.dangerous ? "rm -rf ./build" : "echo ok";

    this.emit({
      type: "timeline",
      provider: "pi",
      item: {
        type: "tool_call",
        name: "Bash",
        callId,
        status: "running",
        detail: { type: "unknown", input: { command }, output: null },
        error: null,
      },
    });

    const actions: FakePermissionAction[] = [
      { id: "allow", label: "Allow", behavior: "allow", variant: "primary" },
      {
        id: "deny",
        label: "Deny",
        behavior: "deny",
        variant: spec.dangerous ? "danger" : "secondary",
      },
    ];
    const request: FakePermissionRequest = {
      id: requestId,
      provider: "pi",
      name: "bash",
      kind: "tool",
      title: "Run shell command",
      description: command,
      input: { command },
      actions,
    };

    const answer = createDeferred<FakePermissionResponse>();
    this.pendingPermissions.set(requestId, request);
    this.permissionResolvers.set(requestId, answer.resolve);
    this.emit({ type: "permission_requested", provider: "pi", request });

    const response = await answer.promise;
    const allowed = response.behavior === "allow";

    this.emit({
      type: "timeline",
      provider: "pi",
      item: {
        type: "tool_call",
        name: "Bash",
        callId,
        status: allowed ? "completed" : "canceled",
        detail: {
          type: "unknown",
          input: { command },
          output: allowed ? { ok: true } : null,
        },
        error: null,
      },
    });
  }

  /**
   * Emits a pinned `pi_ui_state` carrying one `PiUiElement`, keyed to the
   * real daemon-assigned agent id (`this.daemonAgentId`) -- see that
   * field's own doc comment for why, never `this.id`.
   *
   * `"widget"` builds an element with a canonical `payload` a real Pi
   * helper negotiating `piUiPayloadV2` would send: valid `widget` rows,
   * matching `PiUiWidgetPayloadSchema` (`packages/protocol/src/
   * pi-ui-bridge/payload.ts`).
   *
   * `"malformed"` instead builds an element with a **top-level legacy**
   * `rows` field (no `payload` at all) whose entries are plain strings,
   * not row objects. `PiUiElementSchema.rows` (`packages/protocol/src/
   * pi-ui-bridge/schema.ts`) is the loose `z.array(z.unknown())`, so this
   * still passes the wire schema unchanged -- but frontend-core's
   * `normalizePiUiElement` (`packages/frontend-core/src/extensions/
   * normalize.ts`) lifts that `rows` field into a `widget` payload
   * candidate and validates it against `PiUiWidgetPayloadSchema`, whose
   * `rows` requires row *objects*; that parse fails, normalization
   * returns the element with no `payload` attached, and
   * `apps/web/src/features/extensions/registry-view.tsx` renders
   * "Element payload could not be validated" for it.
   */
  private emitUiElement(kind: UiElementPromptKind): void {
    if (!this.daemonAgentId) {
      throw new Error(
        "FakePiAgentSession.emitUiElement requires a daemon-assigned agentId " +
          "(FakePiAgentClient.createSession's launchContext.agentId) -- this fake " +
          "session was constructed without one",
      );
    }

    const element: PiUiElement =
      kind === "malformed"
        ? {
            ns: "e2e",
            id: "demo-malformed",
            kind: "widget",
            placement: "pinned",
            title: "E2E Malformed Widget",
            // Legacy top-level field, deliberately shaped wrong -- see this
            // method's own doc comment.
            rows: ["not-an-object"],
          }
        : {
            ns: "e2e",
            id: "demo",
            kind: "widget",
            placement: "pinned",
            title: "E2E Demo Widget",
            payload: {
              kind: "widget",
              text: "Widget from the fake Pi provider",
              rows: [{ id: "row-1", label: "Status", value: "ready" }],
            },
            actions: [{ id: "ack", label: "Acknowledge" }],
          };

    this.emit({
      type: "pi_ui_state",
      provider: "pi",
      state: {
        agentId: this.daemonAgentId,
        revision: 1,
        elements: [element],
        updatedAt: new Date().toISOString(),
      },
    });
  }

  private async runDiffTool(bytes: number): Promise<void> {
    const callId = randomUUID();
    const payload = buildRepeatedDiffPayload(bytes);
    this.emit({
      type: "timeline",
      provider: "pi",
      item: {
        type: "tool_call",
        name: "apply_patch",
        callId,
        status: "completed",
        detail: {
          type: "edit",
          filePath: "src/large-diff.ts",
          unifiedDiff: `diff --git a/src/large-diff.ts b/src/large-diff.ts\n${payload}`,
        },
        error: null,
      },
    });
  }

  async getRuntimeInfo() {
    return { provider: "pi", sessionId: this.id, model: null, modeId: this.modeId };
  }

  async getAvailableModes() {
    return [
      { id: "default", label: "Default", description: "Ask for permissions" },
      { id: "bypassPermissions", label: "Bypass", description: "No permissions" },
    ];
  }

  async getCurrentMode(): Promise<string | null> {
    return this.modeId;
  }

  async setMode(modeId: string): Promise<void> {
    this.modeId = modeId;
  }

  async setFeature(): Promise<void> {
    // No features exposed by this fake session.
  }

  getPendingPermissions(): FakePermissionRequest[] {
    return Array.from(this.pendingPermissions.values());
  }

  /**
   * Resolves the deferred `runPermissionTool` is blocked on and emits
   * the matching `permission_resolved` stream event, which
   * `AgentManager` (`agent-manager.ts`'s `onStreamPermissionResolved`)
   * broadcasts to every connected client watching this session — not
   * only the one that answered — exactly the multi-client fan-out
   * `approvals.spec.ts`'s "superseded for the other" scenario exercises.
   *
   * A `requestId` this session no longer has a resolver for (already
   * answered, e.g. by a second client racing the first) is a deliberate
   * no-op, matching plan.md §12.3's "single-answer semantics": the
   * daemon's own `AgentManager.respondToPermission` still resolves
   * normally either way, so a losing client never sees a thrown RPC
   * error — only never observes its own answer take effect, and instead
   * observes the winner's `agent_permission_resolved` broadcast close its
   * dialog first.
   */
  async respondToPermission(requestId: string, response: FakePermissionResponse): Promise<void> {
    const resolve = this.permissionResolvers.get(requestId);
    if (!resolve) {
      return;
    }
    this.permissionResolvers.delete(requestId);
    this.pendingPermissions.delete(requestId);
    resolve(response);
    this.emit({ type: "permission_resolved", provider: "pi", requestId, resolution: response });
  }

  describePersistence() {
    return { provider: "pi", sessionId: this.id };
  }

  async interrupt(): Promise<void> {
    this.interruptSignal.resolve();
  }

  async close(): Promise<void> {
    // No external resources to release.
  }

  async listCommands() {
    return [
      { name: "help", description: "Help", argumentHint: "" },
      { name: "context", description: "Context", argumentHint: "" },
    ];
  }

  // eslint-disable-next-line require-yield -- deliberately empty: see this module's doc comment (no import-session scenario in T31B).
  async *streamHistory(): AsyncGenerator<FakeAgentStreamEvent> {
    // This fake session is always daemon-created (never imported), and
    // `AgentManager` persists committed timeline items itself as
    // `subscribe()` events stream in -- see this module's doc comment.
  }

  get cwdPath(): string {
    return this.cwd;
  }
}

export class FakePiAgentClient {
  readonly provider = "pi";
  readonly capabilities = {
    supportsStreaming: true,
    supportsSessionPersistence: true,
    supportsDynamicModes: true,
    supportsMcpServers: false,
    supportsReasoningStream: true,
    supportsToolInvocations: true,
    supportsRewindConversation: false,
    supportsRewindFiles: false,
    supportsRewindBoth: false,
  };

  /**
   * `launchContext` is the real `AgentClient.createSession`'s second
   * parameter (`AgentLaunchContext`, `packages/server/src/server/agent/
   * agent-sdk-types.ts`, read-only reference -- never imported, per this
   * module's doc comment); only `agentId` is read here -- the
   * daemon-assigned id `AgentManager.buildLaunchContext` always sets,
   * forwarded to `FakePiAgentSession` so `emitUiElement` can key its
   * `pi_ui_state` under the same id the real UI subscribes by. See
   * `FakePiAgentSession.daemonAgentId`'s own doc comment.
   */
  async createSession(
    config: { cwd: string; modeId?: string | null },
    launchContext?: { agentId?: string },
  ): Promise<FakePiAgentSession> {
    return new FakePiAgentSession({
      cwd: config.cwd,
      modeId: config.modeId ?? null,
      daemonAgentId: launchContext?.agentId ?? null,
    });
  }

  async resumeSession(
    handle: { sessionId: string },
    overrides?: { cwd?: string; modeId?: string | null },
  ): Promise<FakePiAgentSession> {
    return new FakePiAgentSession({
      sessionId: handle.sessionId,
      cwd: overrides?.cwd ?? process.cwd(),
      modeId: overrides?.modeId ?? null,
    });
  }

  async fetchCatalog(): Promise<{
    models: Array<{ provider: string; id: string; label: string; isDefault: boolean }>;
    modes: Array<{ id: string; label: string; description?: string }>;
  }> {
    return {
      models: [{ provider: "pi", id: "e2e-fake-model", label: "E2E Fake Model", isDefault: true }],
      modes: [
        { id: "default", label: "Default", description: "Ask for permissions" },
        { id: "bypassPermissions", label: "Bypass", description: "No permissions" },
      ],
    };
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }
}
