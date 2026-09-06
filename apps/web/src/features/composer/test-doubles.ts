/**
 * Minimal in-memory `StructuredStorage`/`Clock` test doubles for this
 * feature's own tests only (never shipped behind a real code path).
 *
 * `frontend-core` keeps an equivalent pair local to its own `composer/`
 * domain rather than exporting it; per plan.md §3.3 apps depend on
 * package *exports*, never source-relative cross-workspace paths, so
 * this feature keeps its own tiny copy instead of reaching into
 * `packages/frontend-core/src`.
 */
import type {
  Clock,
  FilePickOptions,
  FilePicker,
  PickedFile,
  StructuredStorage,
  StructuredStorageListOptions,
  TimerHandle,
} from "@picompanion/frontend-core";

import type {
  AgentAvailableModels,
  AgentModelSnapshot,
  AgentProviderNotice,
  AgentQueueModes,
  AgentQueueUpdate,
  AgentSlashCommand,
  AgentTurnClient,
  AgentUploadedAttachment,
  QueueMode,
  SendAgentMessageOptions,
} from "./agent-turn-client.js";

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export class InMemoryStructuredStorage implements StructuredStorage {
  private readonly backing = new Map<string, unknown>();

  private key(collection: string, id: string): string {
    return `${collection}\u0000${id}`;
  }

  async get<T>(collection: string, id: string): Promise<T | null> {
    const value = this.backing.get(this.key(collection, id));
    return value === undefined ? null : (deepClone(value) as T);
  }

  async put<T>(collection: string, id: string, value: T): Promise<void> {
    this.backing.set(this.key(collection, id), deepClone(value));
  }

  async delete(collection: string, id: string): Promise<void> {
    this.backing.delete(this.key(collection, id));
  }

  async list<T>(collection: string, options?: StructuredStorageListOptions): Promise<T[]> {
    const prefix = `${collection}\u0000${options?.idPrefix ?? ""}`;
    const results: T[] = [];
    for (const [key, value] of this.backing.entries()) {
      if (key.startsWith(prefix)) {
        results.push(deepClone(value) as T);
        if (options?.limit !== undefined && results.length >= options.limit) break;
      }
    }
    return results;
  }

  async clear(collection: string): Promise<void> {
    const prefix = `${collection}\u0000`;
    for (const key of this.backing.keys()) {
      if (key.startsWith(prefix)) this.backing.delete(key);
    }
  }
}

/**
 * In-memory `AgentTurnClient` test double (T28B2, extended T28B3 with
 * `onQueueUpdate`). Records every call so tests can assert on
 * `agentId`/`text`/`options`, and lets a test script canned
 * resolutions/rejections per call via `sendAgentMessageImpl` /
 * `cancelAgentImpl` — defaulting to an immediate success, which is what
 * most tests want.
 */
export class FakeAgentTurnClient implements AgentTurnClient {
  readonly sentMessages: Array<{
    agentId: string;
    text: string;
    options?: SendAgentMessageOptions;
  }> = [];
  readonly canceledAgentIds: string[] = [];
  private readonly queueUpdateHandlers = new Map<string, Set<(update: AgentQueueUpdate) => void>>();

  sendAgentMessageImpl: (
    agentId: string,
    text: string,
    options?: SendAgentMessageOptions,
  ) => Promise<void> = async () => {};

  cancelAgentImpl: (agentId: string) => Promise<void> = async () => {};

  async sendAgentMessage(
    agentId: string,
    text: string,
    options?: SendAgentMessageOptions,
  ): Promise<void> {
    this.sentMessages.push({ agentId, text, options });
    await this.sendAgentMessageImpl(agentId, text, options);
  }

  async cancelAgent(agentId: string): Promise<void> {
    this.canceledAgentIds.push(agentId);
    await this.cancelAgentImpl(agentId);
  }

  onQueueUpdate(agentId: string, handler: (update: AgentQueueUpdate) => void): () => void {
    let handlers = this.queueUpdateHandlers.get(agentId);
    if (!handlers) {
      handlers = new Set();
      this.queueUpdateHandlers.set(agentId, handlers);
    }
    handlers.add(handler);
    return () => {
      handlers?.delete(handler);
    };
  }

  /** Test helper: simulates the daemon pushing a live `pi_queue_update` for `agentId`. */
  emitQueueUpdate(agentId: string, update: AgentQueueUpdate): void {
    for (const handler of this.queueUpdateHandlers.get(agentId) ?? []) {
      handler(update);
    }
  }

  /**
   * Canned `listCommands` result (T28B4). Defaults to an empty list, not
   * an omitted method — tests of the "no `listCommands` support" seam
   * omit the whole `client` prop instead, the same convention
   * `Composer.test.tsx`'s existing "without a client wired" abort tests
   * already use for `onQueueUpdate`.
   */
  commandsToReturn: readonly AgentSlashCommand[] = [];
  /** Canned `listCommands` failure (T28B4), checked before `commandsToReturn`. */
  listCommandsError: string | null = null;
  readonly listCommandsCalls: string[] = [];

  async listCommands(agentId: string): Promise<readonly AgentSlashCommand[]> {
    this.listCommandsCalls.push(agentId);
    if (this.listCommandsError) throw new Error(this.listCommandsError);
    return this.commandsToReturn;
  }

  // --- Model/thinking selection (T28B5) -----------------------------------

  /**
   * Canned `getAgentModelSnapshot` result; mutate freely between
   * assertions. Defaults to a model already selected (not the "no model
   * chosen yet" edge case) so tests unrelated to model/thinking
   * selection see a silent picker — no status text — by default, the
   * same way `commandsToReturn` defaults to `[]` rather than an error.
   */
  modelSnapshot: AgentModelSnapshot | null = {
    provider: "pi",
    modelId: "pi-default",
    thinkingOptionId: null,
    effectiveThinkingOptionId: null,
  };
  /** Canned `getAgentModelSnapshot` failure, checked before `modelSnapshot`. */
  getAgentModelSnapshotError: string | null = null;
  readonly getAgentModelSnapshotCalls: string[] = [];
  private readonly modelSnapshotHandlers = new Map<
    string,
    Set<(snapshot: AgentModelSnapshot) => void>
  >();

  /** Canned `listAvailableModels` result, keyed by provider. */
  availableModelsByProvider = new Map<string, AgentAvailableModels>();
  readonly listAvailableModelsCalls: string[] = [];

  /** Canned `setAgentThinkingOption` notice, returned on the next successful call. */
  thinkingNoticeToReturn: AgentProviderNotice | null = null;
  setAgentModelError: string | null = null;
  setAgentThinkingOptionError: string | null = null;
  readonly setAgentModelCalls: Array<{ agentId: string; modelId: string }> = [];
  readonly setAgentThinkingOptionCalls: Array<{
    agentId: string;
    thinkingOptionId: string | null;
  }> = [];

  async getAgentModelSnapshot(agentId: string): Promise<AgentModelSnapshot | null> {
    this.getAgentModelSnapshotCalls.push(agentId);
    if (this.getAgentModelSnapshotError) throw new Error(this.getAgentModelSnapshotError);
    return this.modelSnapshot;
  }

  onAgentModelSnapshotChange(
    agentId: string,
    handler: (snapshot: AgentModelSnapshot) => void,
  ): () => void {
    let handlers = this.modelSnapshotHandlers.get(agentId);
    if (!handlers) {
      handlers = new Set();
      this.modelSnapshotHandlers.set(agentId, handlers);
    }
    handlers.add(handler);
    return () => {
      handlers?.delete(handler);
    };
  }

  /** Test helper: simulates the daemon pushing a live `agent_update` for `agentId`. */
  emitAgentModelSnapshot(agentId: string, snapshot: AgentModelSnapshot): void {
    for (const handler of this.modelSnapshotHandlers.get(agentId) ?? []) {
      handler(snapshot);
    }
  }

  async listAvailableModels(provider: string): Promise<AgentAvailableModels> {
    this.listAvailableModelsCalls.push(provider);
    return this.availableModelsByProvider.get(provider) ?? { models: [], error: null };
  }

  async setAgentModel(agentId: string, modelId: string): Promise<void> {
    this.setAgentModelCalls.push({ agentId, modelId });
    if (this.setAgentModelError) throw new Error(this.setAgentModelError);
    if (this.modelSnapshot) {
      this.modelSnapshot = { ...this.modelSnapshot, modelId };
    }
  }

  async setAgentThinkingOption(
    agentId: string,
    thinkingOptionId: string | null,
  ): Promise<AgentProviderNotice | null> {
    this.setAgentThinkingOptionCalls.push({ agentId, thinkingOptionId });
    if (this.setAgentThinkingOptionError) throw new Error(this.setAgentThinkingOptionError);
    if (this.modelSnapshot) {
      this.modelSnapshot = {
        ...this.modelSnapshot,
        thinkingOptionId,
        effectiveThinkingOptionId: thinkingOptionId ?? this.modelSnapshot.effectiveThinkingOptionId,
      };
    }
    return this.thinkingNoticeToReturn;
  }

  // --- Attachments (T28B6) -------------------------------------------------

  /**
   * Canned `uploadFile` behavior. Defaults to a deterministic success
   * (`id`/`path` derived from the call count) so most tests can just
   * assert an upload eventually lands in the "uploaded" state; set to a
   * function that rejects to exercise the "clear error" and retry paths.
   */
  uploadFileImpl: (
    input: { fileName: string; mimeType: string; bytes: Uint8Array; modifiedAt?: string },
    callIndex: number,
  ) => Promise<AgentUploadedAttachment> = async (input, callIndex) => ({
    type: "uploaded_file",
    id: `upload-${callIndex}`,
    fileName: input.fileName,
    mimeType: input.mimeType,
    size: input.bytes.byteLength,
    path: `/uploads/upload-${callIndex}`,
  });
  readonly uploadFileCalls: Array<{
    fileName: string;
    mimeType: string;
    bytes: Uint8Array;
    modifiedAt?: string;
  }> = [];

  async uploadFile(input: {
    fileName: string;
    mimeType: string;
    bytes: Uint8Array;
    modifiedAt?: string;
  }): Promise<AgentUploadedAttachment> {
    this.uploadFileCalls.push(input);
    return this.uploadFileImpl(input, this.uploadFileCalls.length);
  }

  // --- Steer/follow-up mode control (T38B1a) ------------------------------

  /**
   * Canned `getQueueModes` result; mutate freely between assertions.
   * Defaults to both modes at Pi's own default (`"one-at-a-time"`), the
   * same "silent by default" convention `modelSnapshot` above uses.
   */
  queueModes: AgentQueueModes = { steeringMode: "one-at-a-time", followUpMode: "one-at-a-time" };
  /** Canned `getQueueModes` failure, checked before `queueModes`. */
  getQueueModesError: string | null = null;
  readonly getQueueModesCalls: string[] = [];
  private readonly queueModesHandlers = new Map<string, Set<(modes: AgentQueueModes) => void>>();

  setSteeringModeError: string | null = null;
  setFollowUpModeError: string | null = null;
  readonly setSteeringModeCalls: Array<{ agentId: string; mode: QueueMode }> = [];
  readonly setFollowUpModeCalls: Array<{ agentId: string; mode: QueueMode }> = [];
  /** Canned `setSteeringMode` notice (T127), returned on the next successful call. */
  steeringNoticeToReturn: AgentProviderNotice | null = null;
  /** Canned `setFollowUpMode` notice (T127), returned on the next successful call. */
  followUpNoticeToReturn: AgentProviderNotice | null = null;

  async getQueueModes(agentId: string): Promise<AgentQueueModes> {
    this.getQueueModesCalls.push(agentId);
    if (this.getQueueModesError) throw new Error(this.getQueueModesError);
    return this.queueModes;
  }

  async setSteeringMode(agentId: string, mode: QueueMode): Promise<AgentProviderNotice | null> {
    this.setSteeringModeCalls.push({ agentId, mode });
    if (this.setSteeringModeError) throw new Error(this.setSteeringModeError);
    this.queueModes = { ...this.queueModes, steeringMode: mode };
    return this.steeringNoticeToReturn;
  }

  async setFollowUpMode(agentId: string, mode: QueueMode): Promise<AgentProviderNotice | null> {
    this.setFollowUpModeCalls.push({ agentId, mode });
    if (this.setFollowUpModeError) throw new Error(this.setFollowUpModeError);
    this.queueModes = { ...this.queueModes, followUpMode: mode };
    return this.followUpNoticeToReturn;
  }

  onQueueModesChange(agentId: string, handler: (modes: AgentQueueModes) => void): () => void {
    let handlers = this.queueModesHandlers.get(agentId);
    if (!handlers) {
      handlers = new Set();
      this.queueModesHandlers.set(agentId, handlers);
    }
    handlers.add(handler);
    return () => {
      handlers?.delete(handler);
    };
  }

  /** Test helper: simulates a change to either queue mode made by a *different* connected client. */
  emitQueueModes(agentId: string, modes: AgentQueueModes): void {
    for (const handler of this.queueModesHandlers.get(agentId) ?? []) {
      handler(modes);
    }
  }
}

/** Deterministic, manually advanced `Clock` test double. */
export class FakeClock implements Clock {
  private currentMs: number;

  constructor(startMs = 0) {
    this.currentMs = startMs;
  }

  now(): number {
    return this.currentMs;
  }

  advance(deltaMs: number): void {
    this.currentMs += deltaMs;
  }

  setTimeout(): TimerHandle {
    throw new Error("FakeClock.setTimeout is not implemented; this test double is now-only.");
  }

  clearTimeout(): void {
    throw new Error("FakeClock.clearTimeout is not implemented; this test double is now-only.");
  }

  setInterval(): TimerHandle {
    throw new Error("FakeClock.setInterval is not implemented; this test double is now-only.");
  }

  clearInterval(): void {
    throw new Error("FakeClock.clearInterval is not implemented; this test double is now-only.");
  }
}

/**
 * Builds a `PickedFile` test double (T28B6) whose `readAsBytes` resolves
 * to `bytes` (default: derived from `text`, matching the web adapter's
 * own `file.arrayBuffer()`-backed `readAsBytes` shape).
 */
export function makeFakePickedFile(input: {
  name: string;
  mimeType?: string;
  size?: number;
  text?: string;
  bytes?: Uint8Array;
  /** Rejects `readAsBytes()` with this error instead of resolving, to exercise a read failure. */
  readError?: string;
}): PickedFile {
  const bytes = input.bytes ?? new TextEncoder().encode(input.text ?? input.name);
  return {
    name: input.name,
    mimeType: input.mimeType,
    size: input.size ?? bytes.byteLength,
    async readAsBytes(): Promise<Uint8Array> {
      if (input.readError) throw new Error(input.readError);
      return bytes;
    },
  };
}

/**
 * In-memory `FilePicker` test double (T28B6). `filesToReturn` is consumed
 * one `pickFiles()` call at a time (FIFO) via `enqueue`, so a test can
 * script exactly which files a given "Attach files" click produces —
 * including an empty array, standing in for the user dismissing the
 * native dialog without choosing anything.
 */
export class FakeFilePicker implements FilePicker {
  private readonly queue: PickedFile[][] = [];
  readonly pickFilesCalls: Array<FilePickOptions | undefined> = [];

  /** Queues the files the *next* `pickFiles()` call resolves with. */
  enqueue(files: PickedFile[]): void {
    this.queue.push(files);
  }

  async pickFiles(options?: FilePickOptions): Promise<PickedFile[]> {
    this.pickFilesCalls.push(options);
    return this.queue.shift() ?? [];
  }
}
