import {
  PiUiElementSchema,
  piUiKindSupportsAppend,
  type PiUiDelta,
  type PiUiElement,
  type PiUiState,
} from "@picompanion/protocol/pi-ui-bridge/schema";
import type { AgentStreamEvent } from "../../../agent-sdk-types.js";
import { PIUI_INITIAL_REVISION, isPiUiRevision, nextPiUiRevision } from "./revision.js";
// COMPAT(piUiPayloadV2): added 2026-08-31, remove after 2027-02-28.
import { normalizePiUiElementInput } from "./payload-compat.js";
import {
  buildPiUiActionEnvelope,
  elementKeyOf,
  formatActionKey,
  formatCompositeElementId,
  parseCompositeElementId,
  type PiUiActionTarget,
} from "./identity.js";

/**
 * Bridge state rules (plan.md §4.2, "Bridge state correctness").
 *
 * The provisional store invented elements for unknown patches, appended to any
 * kind, and left TTL unenforced. The explicit rules implemented here are:
 *
 * - a `patch` for a missing element is **rejected** and triggers a full
 *   resync request; the daemon never invents an element;
 * - `append` applies only to payload kinds that support it (`log`);
 * - TTL is enforced **only** in the daemon — the helper's `ttl` is advisory
 *   metadata and is clamped to a sane daemon-owned range;
 * - `ns:id` identity is preserved everywhere: state keys, deltas, removals;
 * - action routing resolves a composite identity and never a bare element id.
 *
 * Revision handling follows the deterministic rules in `revision.ts`: the
 * daemon is the producer, so every emitted delta advances the revision by
 * exactly one and a full state always carries the current revision. Recent
 * deltas are kept in a bounded per-agent replay buffer so a reconnecting
 * client that is only slightly behind can be caught up with deltas instead of
 * a full resend.
 *
 * Durable snapshots are optional and bounded: only elements explicitly marked
 * `durable: true` are ever persisted, and they travel as ordinary
 * `pi_ui_snapshot` timeline items. Ephemeral Pi UI state (everything else,
 * plus every `pi_ui_state`/`pi_ui_delta` event) never enters the durable
 * cache (plan.md §4.2).
 */

/** Daemon-owned clamp for helper-provided TTLs (advisory, in milliseconds). */
export const PIUI_TTL_MIN_MS = 1_000;
export const PIUI_TTL_MAX_MS = 6 * 60 * 60 * 1_000; // 6 hours

/** Hard bound on retained `log` lines, so `append` cannot grow without limit. */
export const PIUI_MAX_LOG_LINES = 5_000;

/** Bounded reconnect replay window: newest deltas kept per agent. */
export const PIUI_MAX_REPLAY_DELTAS = 256;

/** Bounds for an optional durable snapshot (plan.md §4.2). */
export const PIUI_DURABLE_MAX_ELEMENTS = 32;
export const PIUI_DURABLE_MAX_BYTES = 64 * 1_024;

/**
 * Durable snapshot policy. Disabled by default: plan.md §4.2 says durable
 * snapshots "default to false until old-daemon parsing of the new optional
 * payload has a fixture".
 */
export type PiUiDurableSnapshotOptions = {
  enabled?: boolean;
  /** Maximum number of durable elements written into one snapshot. */
  maxElements?: number;
  /** Maximum serialized size of the retained elements, in bytes. */
  maxBytes?: number;
};

type ResolvedDurableOptions = Required<PiUiDurableSnapshotOptions>;

const DURABLE_DEFAULTS: ResolvedDurableOptions = {
  enabled: false,
  maxElements: PIUI_DURABLE_MAX_ELEMENTS,
  maxBytes: PIUI_DURABLE_MAX_BYTES,
};

/** One buffered delta, tagged with the revision it produced. */
export type PiUiReplayEntry = { revision: number; delta: PiUiDelta };

/**
 * What a reconnecting subscriber needs, given the revision it last applied.
 *
 * `up-to-date` means the client already has `revision`; `deltas` means the
 * bounded buffer still covers the gap contiguously; `full` means the client
 * is too far behind (or ahead, or unknown) and must take a full state.
 */
export type PiUiReplayPlan =
  | { mode: "up-to-date"; revision: number }
  | { mode: "deltas"; revision: number; entries: PiUiReplayEntry[] }
  | { mode: "full"; revision: number; state: PiUiState };

/** Envelope keys that a patch never projects into a payload. */
const PATCH_ENVELOPE_KEYS = new Set([
  "id",
  "ns",
  "kind",
  "placement",
  "title",
  "actions",
  "ttl",
  "durable",
  "payload",
]);

/** Why the daemon asked the helper for a full resync. */
export type PiUiResyncReason = "agent-seq-gap" | "patch-missing-element" | "append-missing-element";

type PiUiStateEntry = {
  revision: number;
  elements: Map<string, PiUiElement>; // key = `${ns}:${id}`
  lastAgentSeq: number;
  /** Daemon-owned TTL timers, keyed exactly like `elements`. */
  ttlTimers: Map<string, ReturnType<typeof setTimeout>>;
  /** Bounded newest-last reconnect replay window. */
  replay: PiUiReplayEntry[];
  /** Serialized last durable snapshot, for dedupe. Never holds ephemerals. */
  lastDurableSnapshot: string | null;
};

export type PiUiActionResolution =
  | { ok: true; target: PiUiActionTarget }
  | { ok: false; error: string };

type Rec = Record<string, unknown>;

function isRecord(value: unknown): value is Rec {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function elementKey(el: PiUiElement): string {
  return elementKeyOf(el.ns, el.id);
}

/** Serialized byte size of a JSON-able value (used to bound durable snapshots). */
function byteLengthOf(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

/** Normalizes helper `ttl` (advisory) into a daemon-enforced duration. */
export function clampAdvisoryTtlMs(ttl: unknown): number | null {
  if (typeof ttl !== "number" || !Number.isFinite(ttl) || ttl <= 0) return null;
  return Math.min(Math.max(Math.floor(ttl), PIUI_TTL_MIN_MS), PIUI_TTL_MAX_MS);
}

/** Extracts the action ids declared by an element, row, or panel section. */
function actionIdsOf(value: unknown): string[] {
  if (!isRecord(value) || !Array.isArray(value.actions)) return [];
  return value.actions
    .map((action) => (isRecord(action) && typeof action.id === "string" ? action.id : null))
    .filter((id): id is string => id !== null);
}

/** Finds a roster row or panel section by id inside an element's payload. */
function findChild(element: PiUiElement, childId: string): Rec | null {
  const payload = (element as unknown as Rec).payload;
  const containers: unknown[] = [];
  if (isRecord(payload)) {
    if (Array.isArray(payload.rows)) containers.push(...payload.rows);
    if (Array.isArray(payload.sections)) containers.push(...payload.sections);
  }
  const legacy = element as unknown as Rec;
  if (Array.isArray(legacy.rows)) containers.push(...legacy.rows);
  if (Array.isArray(legacy.sections)) containers.push(...legacy.sections);
  for (const child of containers) {
    if (isRecord(child) && child.id === childId) return child;
  }
  return null;
}

export class PiUiStateStore {
  private store = new Map<string, PiUiStateEntry>(); // agentId -> entry
  /** Agent shutdown latch: a disposed store never mutates or emits again. */
  private disposed = false;
  private readonly durable: ResolvedDurableOptions;

  constructor(
    private readonly emit: (event: AgentStreamEvent) => void,
    private readonly requestResync: (agentId: string, reason?: PiUiResyncReason) => void,
    private readonly notify: (
      level: "info" | "warning" | "error",
      message: string,
    ) => void = () => {},
    durableSnapshots: PiUiDurableSnapshotOptions = {},
  ) {
    this.durable = {
      enabled: durableSnapshots.enabled ?? DURABLE_DEFAULTS.enabled,
      maxElements: Math.max(0, durableSnapshots.maxElements ?? DURABLE_DEFAULTS.maxElements),
      maxBytes: Math.max(0, durableSnapshots.maxBytes ?? DURABLE_DEFAULTS.maxBytes),
    };
  }

  private ensureAgent(agentId: string): PiUiStateEntry {
    let entry = this.store.get(agentId);
    if (!entry) {
      entry = {
        revision: PIUI_INITIAL_REVISION,
        elements: new Map(),
        lastAgentSeq: -1,
        ttlTimers: new Map(),
        replay: [],
        lastDurableSnapshot: null,
      };
      this.store.set(agentId, entry);
    }
    return entry;
  }

  /* ------------------------------------------------------------------ */
  /* revision bookkeeping (plan.md §4.2, see revision.ts)                */
  /* ------------------------------------------------------------------ */

  /**
   * Advances the revision by exactly one and emits the delta that produced it,
   * recording it in the bounded replay window. A conforming consumer applies
   * only `current + 1`, so nothing else may ever change state.
   */
  private commitDelta(
    agentId: string,
    entry: PiUiStateEntry,
    deltaOrBuild: PiUiDelta | ((revision: number) => PiUiDelta),
  ): void {
    if (this.disposed) return;
    entry.revision = nextPiUiRevision(entry.revision);
    const delta = typeof deltaOrBuild === "function" ? deltaOrBuild(entry.revision) : deltaOrBuild;
    entry.replay.push({ revision: entry.revision, delta });
    if (entry.replay.length > PIUI_MAX_REPLAY_DELTAS) {
      entry.replay.splice(0, entry.replay.length - PIUI_MAX_REPLAY_DELTAS);
    }
    this.emitDelta(agentId, delta);
    this.maybeEmitDurableSnapshot(agentId, entry);
  }

  /**
   * Advances the revision and emits a full state. A full state supersedes the
   * replay window: a client that takes it is exactly at the new revision.
   */
  private commitFullState(agentId: string, entry: PiUiStateEntry): void {
    if (this.disposed) return;
    entry.revision = nextPiUiRevision(entry.revision);
    entry.replay.length = 0;
    this.emitFull(agentId);
    this.maybeEmitDurableSnapshot(agentId, entry);
  }

  /**
   * Bounded, optional durable snapshot (plan.md §4.2): only elements marked
   * `durable: true` are ever considered, capped to `maxElements` and to a
   * serialized size of `maxBytes`, and emitted as an ordinary
   * `pi_ui_snapshot` timeline item — the same `PiUiState` shape every client
   * already knows how to read, so old clients stay backward-compatible.
   * Disabled entirely unless `durableSnapshots.enabled` was passed in, and a
   * no-op whenever the retained set is unchanged since the last emission.
   */
  private maybeEmitDurableSnapshot(agentId: string, entry: PiUiStateEntry): void {
    if (this.disposed || !this.durable.enabled) return;

    const durableElements: PiUiElement[] = [];
    for (const el of entry.elements.values()) {
      if ((el as unknown as Rec).durable === true) durableElements.push(el);
    }

    let bounded = durableElements.slice(0, this.durable.maxElements);
    while (bounded.length > 0 && byteLengthOf(bounded) > this.durable.maxBytes) {
      bounded = bounded.slice(0, -1);
    }

    const serialized = JSON.stringify(bounded);
    if (serialized === entry.lastDurableSnapshot) return;
    // Never emit the initial empty snapshot for an agent that has never had a
    // durable element: there is nothing yet worth persisting.
    if (bounded.length === 0 && entry.lastDurableSnapshot === null) {
      entry.lastDurableSnapshot = serialized;
      return;
    }
    entry.lastDurableSnapshot = serialized;

    const state: PiUiState = {
      agentId,
      revision: entry.revision,
      elements: bounded,
      updatedAt: new Date().toISOString(),
    };
    this.emit({
      type: "timeline",
      provider: "pi",
      item: { type: "pi_ui_snapshot", state },
    });
  }

  // AgentSeq gap detection
  private checkAgentSeq(entry: PiUiStateEntry, agentId: string, agentSeq?: number): boolean {
    if (agentSeq === undefined) return true;
    if (entry.lastAgentSeq !== -1 && agentSeq !== entry.lastAgentSeq + 1) {
      // Gap detected
      this.requestResync(agentId, "agent-seq-gap");
      // still update lastAgentSeq to current to avoid repeated resync loops
      entry.lastAgentSeq = agentSeq;
      return false;
    }
    entry.lastAgentSeq = agentSeq;
    return true;
  }

  /* ------------------------------------------------------------------ */
  /* TTL — daemon enforced only (plan.md §4.2)                          */
  /* ------------------------------------------------------------------ */

  private clearTtl(entry: PiUiStateEntry, key: string): void {
    const timer = entry.ttlTimers.get(key);
    if (timer !== undefined) {
      clearTimeout(timer);
      entry.ttlTimers.delete(key);
    }
  }

  private clearAllTtl(entry: PiUiStateEntry): void {
    for (const timer of entry.ttlTimers.values()) clearTimeout(timer);
    entry.ttlTimers.clear();
  }

  /**
   * Schedules daemon-side expiry for one element. The helper's `ttl` is
   * advisory: it is clamped here, and only this timer can remove the element.
   */
  private scheduleTtl(agentId: string, entry: PiUiStateEntry, el: PiUiElement): void {
    const key = elementKey(el);
    this.clearTtl(entry, key);
    const ttlMs = clampAdvisoryTtlMs((el as unknown as Rec).ttl);
    if (ttlMs === null) return;
    const timer = setTimeout(() => {
      this.expireElement(agentId, el.ns, el.id);
    }, ttlMs);
    (timer as unknown as { unref?: () => void }).unref?.();
    entry.ttlTimers.set(key, timer);
  }

  private expireElement(agentId: string, ns: string, id: string): void {
    const entry = this.store.get(agentId);
    if (!entry) return;
    const key = elementKeyOf(ns, id);
    entry.ttlTimers.delete(key);
    if (!entry.elements.delete(key)) return;
    this.commitDelta(agentId, entry, { op: "remove", id, ns });
  }

  /* ------------------------------------------------------------------ */
  /* ops                                                                 */
  /* ------------------------------------------------------------------ */

  applySet(agentId: string, el: PiUiElement, agentSeq?: number): void {
    if (this.disposed) return;
    const entry = this.ensureAgent(agentId);
    this.checkAgentSeq(entry, agentId, agentSeq);
    const k = elementKey(el);
    entry.elements.set(k, el);
    this.scheduleTtl(agentId, entry, el);
    this.commitDelta(agentId, entry, { op: "upsert", element: el });
  }

  /**
   * A patch for a missing element is rejected: the daemon requests a full
   * resync rather than inventing a markdown placeholder that no helper owns.
   */
  applyPatch(
    agentId: string,
    id: string,
    ns: string,
    patch: Record<string, unknown>,
    agentSeq?: number,
  ): void {
    if (this.disposed) return;
    const entry = this.ensureAgent(agentId);
    this.checkAgentSeq(entry, agentId, agentSeq);
    const k = elementKeyOf(ns, id);
    const existing = entry.elements.get(k);
    if (!existing) {
      this.notify(
        "warning",
        `PIUI patch for unknown element ${k}; requesting full resync instead of creating it`,
      );
      this.requestResync(agentId, "patch-missing-element");
      return;
    }

    // `kind` is the payload discriminator: changing it would invalidate the
    // typed payload, so a kind-changing patch is rejected, not coerced.
    if (typeof patch.kind === "string" && patch.kind !== existing.kind) {
      this.notify(
        "error",
        `PIUI patch rejected for ${k}: cannot change kind ${existing.kind} -> ${patch.kind}`,
      );
      return;
    }

    const existingRec = existing as unknown as Rec;
    const merged: Rec = { ...existingRec, ...patch };
    if (isRecord(existingRec.payload)) {
      const nextPayload: Rec = { ...existingRec.payload };
      // COMPAT(piUiPayloadV2): added 2026-08-31, remove after 2027-02-28.
      // A v1 patch addresses top-level fields; drop the stale payload copies
      // so re-normalization lifts the patched values instead of the old ones.
      for (const key of Object.keys(patch)) {
        if (PATCH_ENVELOPE_KEYS.has(key)) continue;
        delete nextPayload[key];
        if (key === "diff") delete nextPayload.unifiedDiff;
      }
      if (isRecord(patch.payload)) Object.assign(nextPayload, patch.payload);
      merged.payload = nextPayload;
    }
    // `ns:id` identity is immutable: a patch can never re-home an element.
    merged.id = existing.id;
    merged.ns = existing.ns;
    merged.kind = existing.kind;

    // COMPAT(piUiPayloadV2): added 2026-08-31, remove after 2027-02-28.
    // v1 patches carry top-level fields; re-normalize so `payload` stays in
    // sync with the legacy projection.
    const parsed = PiUiElementSchema.safeParse(normalizePiUiElementInput(merged));
    if (!parsed.success) {
      this.notify("error", `PIUI patch rejected for ${k}: ${parsed.error.message}`);
      return;
    }

    entry.elements.set(k, parsed.data);
    this.scheduleTtl(agentId, entry, parsed.data);
    this.commitDelta(agentId, entry, { op: "upsert", element: parsed.data });
  }

  /**
   * Removes by composite identity. A bare id (no `ns`) is only honoured when
   * exactly one namespace owns it; an ambiguous bare id is rejected so one
   * extension can never remove another extension's element.
   */
  applyRemove(agentId: string, id: string, ns?: string, agentSeq?: number): void {
    if (this.disposed) return;
    const entry = this.ensureAgent(agentId);
    this.checkAgentSeq(entry, agentId, agentSeq);

    let resolvedNs = ns;
    if (resolvedNs === undefined) {
      // COMPAT(piUiPayloadV2): added 2026-08-31, remove after 2027-02-28.
      const matches = [...entry.elements.values()].filter((el) => el.id === id);
      if (matches.length === 0) {
        this.notify("warning", `PIUI remove ignored: no element with id ${id}`);
        return;
      }
      if (matches.length > 1) {
        this.notify(
          "error",
          `PIUI remove rejected: bare id ${id} is ambiguous across namespaces ${matches
            .map((el) => el.ns)
            .join(", ")}`,
        );
        return;
      }
      resolvedNs = matches[0]!.ns;
    }

    const key = elementKeyOf(resolvedNs, id);
    this.clearTtl(entry, key);
    if (!entry.elements.delete(key)) {
      this.notify("warning", `PIUI remove ignored: unknown element ${key}`);
      return;
    }
    this.commitDelta(agentId, entry, { op: "remove", id, ns: resolvedNs });
  }

  applyClear(agentId: string, agentSeq?: number): void {
    if (this.disposed) return;
    const entry = this.ensureAgent(agentId);
    this.checkAgentSeq(entry, agentId, agentSeq);
    this.clearAllTtl(entry);
    entry.elements.clear();
    this.commitDelta(agentId, entry, (revision) => ({ op: "reset", elements: [], revision }));
  }

  applySync(agentId: string, elements: PiUiElement[], agentSeq?: number): void {
    if (this.disposed) return;
    const entry = this.ensureAgent(agentId);
    this.checkAgentSeq(entry, agentId, agentSeq);
    this.clearAllTtl(entry);
    entry.elements.clear();
    for (const el of elements) {
      entry.elements.set(elementKey(el), el);
    }
    for (const el of elements) {
      this.scheduleTtl(agentId, entry, el);
    }
    this.commitFullState(agentId, entry);
  }

  /**
   * Appends to a payload that supports it. Only `log` does (plan.md §4.2);
   * every other kind is rejected with a notice and leaves state untouched.
   */
  applyAppend(agentId: string, id: string, ns: string, data: unknown, agentSeq?: number): void {
    if (this.disposed) return;
    const entry = this.ensureAgent(agentId);
    this.checkAgentSeq(entry, agentId, agentSeq);
    const k = elementKeyOf(ns, id);
    const existing = entry.elements.get(k);
    if (!existing) {
      this.notify(
        "warning",
        `PIUI append for unknown element ${k}; requesting full resync instead of creating it`,
      );
      this.requestResync(agentId, "append-missing-element");
      return;
    }
    if (!piUiKindSupportsAppend(existing.kind)) {
      this.notify("error", `PIUI append rejected: kind ${existing.kind} does not support append`);
      return;
    }

    const lines = appendLines(data);
    if (lines === null) {
      this.notify("error", `PIUI append rejected for ${k}: unsupported append data`);
      return;
    }
    if (lines.length === 0) return;

    const existingRec = existing as unknown as Rec;
    const currentPayload = isRecord(existingRec.payload) ? existingRec.payload : { kind: "log" };
    const currentLines = Array.isArray(currentPayload.lines)
      ? (currentPayload.lines as unknown[]).filter((l): l is string => typeof l === "string")
      : [];
    const nextLines = [...currentLines, ...lines].slice(-PIUI_MAX_LOG_LINES);

    const updatedRec: Rec = {
      ...existingRec,
      payload: { ...currentPayload, kind: "log", lines: nextLines },
    };
    // COMPAT(piUiPayloadV2): added 2026-08-31, remove after 2027-02-28.
    // Keep the legacy top-level projection consistent when it was present.
    if (Array.isArray(existingRec.lines)) updatedRec.lines = nextLines;

    const parsed = PiUiElementSchema.safeParse(updatedRec);
    if (!parsed.success) {
      this.notify("error", `PIUI append rejected for ${k}: ${parsed.error.message}`);
      return;
    }

    entry.elements.set(k, parsed.data);
    this.commitDelta(agentId, entry, { op: "upsert", element: parsed.data });
  }

  // Channel routing: synthesize curated elements
  applyChannel(agentId: string, channel: string, payload: unknown, agentSeq?: number): void {
    if (this.disposed) return;
    switch (channel) {
      case "subagents:fleet": {
        const p = isRecord(payload) ? payload : {};
        const rowsSource = Array.isArray(p.entries)
          ? p.entries
          : Array.isArray(p.rows)
            ? p.rows
            : [];
        this.setSynthesized(
          agentId,
          {
            id: "fleet",
            ns: "subagents",
            kind: "roster",
            placement: "pinned",
            ...(typeof p.header === "string" ? { title: p.header } : {}),
            rows: rowsSource,
          },
          agentSeq,
        );
        break;
      }
      case "workflow:progress": {
        if (!isRecord(payload)) break;
        const name =
          typeof payload.name === "string"
            ? payload.name
            : typeof payload.label === "string"
              ? payload.label
              : "workflow";
        const phase = typeof payload.phase === "string" ? ` · ${payload.phase}` : "";
        const title = `${name}${phase}`;
        // T40A3: `workflow:progress` sends numeric progress as `step`/`total`,
        // not the frozen v1 vocabulary's `value`/`max`
        // (`payload-compat.ts`'s `V1_PAYLOAD_FIELDS.progress` only lifts
        // `label`/`detail`/`value`/`max`/`indeterminate` into the typed
        // payload). Alias them here, before normalization runs inside
        // `setSynthesized`, so the synthesized element's typed `progress`
        // payload actually carries numeric progress instead of the
        // near-empty `{ kind: "progress" }` a renderer previously saw.
        // `...payload` is spread last so an explicit `value`/`max` the
        // channel payload provides directly still wins over the alias.
        const step = typeof payload.step === "number" ? payload.step : undefined;
        const total = typeof payload.total === "number" ? payload.total : undefined;
        this.setSynthesized(
          agentId,
          {
            id: "progress",
            ns: "workflow",
            kind: "progress",
            placement: "status",
            title,
            ...(step !== undefined ? { value: step } : {}),
            ...(total !== undefined ? { max: total } : {}),
            ...payload,
          },
          agentSeq,
        );
        if (payload.active === true) {
          // T113: the rail (`apps/web/src/features/rail/select-rail-
          // elements.ts`) only ever renders `placement: "pinned"` elements,
          // and the `placement: "status"` element above never reaches it —
          // so until now this pinned sibling was a plain-text `widget`
          // echoing only the title, and `step`/`total` never arrived
          // anywhere a renderer could read them (T40A4's disclosed gap).
          // Emitting it as a `progress` element instead, carrying the same
          // `step`/`total` alias as the status element above, lets the
          // already-registered `progress` renderer show a real determinate
          // bar on the rail. Deliberately no explicit `indeterminate` here:
          // `ProgressRenderer` already treats a missing `max` as
          // indeterminate (`progress.tsx`), so an absent `total` still
          // renders something truthful instead of misreading a raw step
          // count as a 0-1 fraction.
          this.setSynthesized(
            agentId,
            {
              id: "workflow-widget",
              ns: "workflow",
              kind: "progress",
              placement: "pinned",
              title,
              label: title,
              ...(step !== undefined ? { value: step } : {}),
              ...(total !== undefined ? { max: total } : {}),
            },
            agentSeq,
          );
        }
        break;
      }
      case "pi-goal:status": {
        if (!isRecord(payload)) break;
        const status = typeof payload.status === "string" ? payload.status : "unknown";
        const detail =
          typeof payload.detail === "string"
            ? payload.detail
            : typeof payload.text === "string"
              ? payload.text
              : undefined;
        const title = detail ?? status;
        // T40A4: pi-goal already puts `startedAt` (epoch ms) on every
        // `pi-goal:status` publish, but this case previously read only
        // `status`, `detail`/`text`, `tone`, and `active`/`running` — so
        // `startedAt` never reached either synthesized element and a
        // renderer had no way to compute live elapsed time. `startedAt` is
        // not one of `payload-compat.ts`'s `V1_PAYLOAD_FIELDS` for `status`
        // or `progress` (so it is never lifted from a top-level field), but
        // every payload schema is `.passthrough()` — so passing it inside an
        // explicit `payload:` object here (rather than as a top-level field)
        // survives `setSynthesized`'s normalize+parse path unchanged and
        // lands on the typed `payload` object a renderer is handed
        // (`ProgressRenderer`/`StatusRenderer` read `payload.*`, never
        // top-level element fields). Payload shape is otherwise unchanged:
        // an absent/non-numeric `startedAt` adds nothing.
        //
        // CORRECTED (P6-W4 merge gate): this makes the field AVAILABLE to a
        // renderer; it does not mean one reads it. Verified at that gate —
        // neither `apps/web/src/features/extensions/renderers/progress.tsx`
        // nor `.../status.tsx` (nor their `apps/android` counterparts)
        // references `startedAt`, so no elapsed time is displayed anywhere
        // today. Today the value is only visible through `RailElementCard`'s
        // raw-payload disclosure. Rendering live elapsed time from it is a
        // separate, unowned follow-up.
        const startedAt = typeof payload.startedAt === "number" ? payload.startedAt : undefined;
        this.setSynthesized(
          agentId,
          {
            id: "status",
            ns: "goal",
            kind: "status",
            placement: "status",
            title,
            text: title,
            ...(typeof payload.tone === "string" ? { tone: payload.tone } : {}),
            ...(startedAt !== undefined ? { payload: { startedAt } } : {}),
          },
          agentSeq,
        );
        if (payload.active === true || payload.running === true) {
          this.setSynthesized(
            agentId,
            {
              id: "goal-progress",
              ns: "goal",
              kind: "progress",
              placement: "pinned",
              title,
              label: title,
              indeterminate: true,
              ...(startedAt !== undefined ? { payload: { startedAt } } : {}),
            },
            agentSeq,
          );
        }
        break;
      }
      default:
        break;
    }
  }

  /**
   * Validates a daemon-synthesized channel element through the same normalize
   * + parse path as helper input, so channel payloads are typed rather than
   * attached with casts.
   */
  private setSynthesized(agentId: string, raw: Rec, agentSeq?: number): void {
    // COMPAT(piUiPayloadV2): added 2026-08-31, remove after 2027-02-28.
    const parsed = PiUiElementSchema.safeParse(normalizePiUiElementInput(raw));
    if (!parsed.success) {
      this.notify("error", `PIUI channel element invalid: ${parsed.error.message}`);
      return;
    }
    this.applySet(agentId, parsed.data, agentSeq);
  }

  /* ------------------------------------------------------------------ */
  /* action routing — composite identity only                            */
  /* ------------------------------------------------------------------ */

  /**
   * Resolves an incoming action request against live state.
   *
   * A composite `ns:id[#rowId]` is looked up directly. A legacy bare id is
   * only accepted when exactly one namespace owns it; anything ambiguous or
   * unknown is rejected so a bare id never routes on its own.
   */
  resolveActionTarget(
    agentId: string,
    input: { elementId: string; actionId: string },
  ): PiUiActionResolution {
    const parsed = parseCompositeElementId(input.elementId);
    if (!parsed) return { ok: false, error: `Invalid element id "${input.elementId}"` };
    if (input.actionId.trim().length === 0) return { ok: false, error: "Missing actionId" };

    const entry = this.store.get(agentId);
    if (!entry) return { ok: false, error: `No Pi UI state for agent ${agentId}` };

    let element: PiUiElement | undefined;
    if (parsed.ns !== undefined) {
      element = entry.elements.get(elementKeyOf(parsed.ns, parsed.id));
    } else {
      // COMPAT(piUiPayloadV2): added 2026-08-31, remove after 2027-02-28.
      const matches = [...entry.elements.values()].filter((el) => el.id === parsed.id);
      if (matches.length > 1) {
        return {
          ok: false,
          error: `Ambiguous element id "${parsed.id}" across namespaces ${matches
            .map((el) => el.ns)
            .join(", ")}; use ns:id`,
        };
      }
      element = matches[0];
    }
    if (!element) {
      return { ok: false, error: `Unknown Pi UI element "${input.elementId}"` };
    }

    let scopeActions = actionIdsOf(element);
    if (parsed.rowId !== undefined) {
      const child = findChild(element, parsed.rowId);
      if (!child) {
        return { ok: false, error: `Unknown row "${parsed.rowId}" on ${elementKey(element)}` };
      }
      scopeActions = [...actionIdsOf(child), ...scopeActions];
    }
    if (scopeActions.length > 0 && !scopeActions.includes(input.actionId)) {
      return {
        ok: false,
        error: `Unknown action "${input.actionId}" on ${elementKey(element)}`,
      };
    }

    const target: PiUiActionTarget = {
      ns: element.ns,
      id: element.id,
      elementKey: elementKey(element),
      kind: element.kind,
      ...(parsed.rowId !== undefined ? { rowId: parsed.rowId } : {}),
      actionId: input.actionId,
      actionKey: formatActionKey({
        ns: element.ns,
        id: element.id,
        ...(parsed.rowId !== undefined ? { rowId: parsed.rowId } : {}),
        actionId: input.actionId,
      }),
    };
    return { ok: true, target };
  }

  /** Convenience: resolved composite id (`ns:id[#rowId]`) for one target. */
  compositeIdFor(target: PiUiActionTarget): string {
    return formatCompositeElementId(target);
  }

  /** Builds the `/pi_ui_event` envelope for a resolved target. */
  buildActionEnvelope(input: {
    target: PiUiActionTarget;
    value?: unknown;
    requestId: string;
  }): Record<string, unknown> {
    return buildPiUiActionEnvelope(input);
  }

  getElements(agentId: string): PiUiElement[] {
    const entry = this.store.get(agentId);
    if (!entry) return [];
    return [...entry.elements.values()];
  }

  getElement(agentId: string, ns: string, id: string): PiUiElement | undefined {
    return this.store.get(agentId)?.elements.get(elementKeyOf(ns, id));
  }

  getRevision(agentId: string): number {
    return this.store.get(agentId)?.revision ?? 0;
  }

  // Emission helpers
  emitFull(agentId: string): void {
    const entry = this.ensureAgent(agentId);
    const elements = [...entry.elements.values()];
    this.emit({
      type: "pi_ui_state",
      provider: "pi",
      state: {
        agentId,
        revision: entry.revision,
        elements,
        updatedAt: new Date().toISOString(),
      },
    });
  }

  emitDelta(
    agentId: string,
    delta: import("@picompanion/protocol/pi-ui-bridge/schema").PiUiDelta,
  ): void {
    const entry = this.ensureAgent(agentId);
    this.emit({
      type: "pi_ui_delta",
      provider: "pi",
      agentId,
      revision: entry.revision,
      delta,
    });
  }

  // For subscribe handling: emit full state to caller via same emit path (agent_stream will carry it)
  handleSubscribe(agentIds: string[]): void {
    for (const id of agentIds) {
      this.emitFull(id);
    }
  }

  // Called on new client subscribe or gap recovery: send full state
  resyncAgent(agentId: string): void {
    this.emitFull(agentId);
  }

  /* ------------------------------------------------------------------ */
  /* reconnect replay (plan.md §4.2, see revision.ts)                   */
  /* ------------------------------------------------------------------ */

  /**
   * Decides what a reconnecting client needs, given the revision it last
   * applied: nothing when it is already current, the bounded buffer of
   * deltas when the gap is still covered by `PIUI_MAX_REPLAY_DELTAS`, or a
   * full state otherwise (unknown agent, invalid/ahead revision, or a gap
   * wider than the buffer). Read-only: never mutates state or the revision.
   */
  planReplay(agentId: string, clientRevision: unknown): PiUiReplayPlan {
    const entry = this.store.get(agentId);
    const current = entry?.revision ?? PIUI_INITIAL_REVISION;

    if (!isPiUiRevision(clientRevision) || clientRevision > current) {
      return this.fullReplayPlan(agentId, entry, current);
    }
    if (clientRevision === current) {
      return { mode: "up-to-date", revision: current };
    }

    const need = clientRevision + 1;
    const replay = entry?.replay ?? [];
    const startIndex = replay.findIndex((e) => e.revision === need);
    if (startIndex === -1) {
      return this.fullReplayPlan(agentId, entry, current);
    }
    const entries = replay.slice(startIndex);
    const first = entries[0];
    const last = entries.at(-1);
    if (!first || !last || first.revision !== need || last.revision !== current) {
      return this.fullReplayPlan(agentId, entry, current);
    }
    return { mode: "deltas", revision: current, entries };
  }

  private fullReplayPlan(
    agentId: string,
    entry: PiUiStateEntry | undefined,
    current: number,
  ): PiUiReplayPlan {
    const elements = entry ? [...entry.elements.values()] : [];
    return {
      mode: "full",
      revision: current,
      state: { agentId, revision: current, elements, updatedAt: new Date().toISOString() },
    };
  }

  /**
   * Executes `planReplay`: emits nothing when up to date, the covered
   * deltas (each stamped with its own historical revision, not the store's
   * live one) when a bounded catch-up is possible, or a full state
   * otherwise. Returns the plan it acted on for callers that want to log or
   * assert on it.
   */
  replayFor(agentId: string, clientRevision: unknown): PiUiReplayPlan {
    const plan = this.planReplay(agentId, clientRevision);
    if (plan.mode === "deltas") {
      for (const { revision, delta } of plan.entries) {
        this.emit({ type: "pi_ui_delta", provider: "pi", agentId, revision, delta });
      }
    } else if (plan.mode === "full") {
      this.emit({ type: "pi_ui_state", provider: "pi", state: plan.state });
    }
    return plan;
  }

  /**
   * Per-agent shutdown: drops that agent's live state, replay buffer, and
   * durable-snapshot dedupe cache, and cancels its TTL timers. Unlike
   * `dispose()` this does not affect other agents, and a later `applySet`
   * for the same `agentId` simply starts a fresh entry at
   * `PIUI_INITIAL_REVISION` — exactly what a reconnecting client sees once
   * the agent process is gone (`planReplay` then returns an empty `full`
   * plan at revision 0).
   */
  clearAgent(agentId: string): void {
    const entry = this.store.get(agentId);
    if (entry) this.clearAllTtl(entry);
    this.store.delete(agentId);
  }

  /**
   * Whole-store shutdown ("close"): cancels every daemon TTL timer, drops
   * every agent's state, and latches so every mutating method
   * (`applySet`/`applyPatch`/.../`applyChannel`) becomes a silent no-op from
   * then on. Idempotent.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const entry of this.store.values()) this.clearAllTtl(entry);
    this.store.clear();
  }
}

/** Coerces `append` data into log lines. Returns null when unsupported. */
function appendLines(data: unknown): string[] | null {
  if (typeof data === "string") return data.length === 0 ? [] : [data];
  if (Array.isArray(data)) {
    if (data.every((entry) => typeof entry === "string")) return data as string[];
    return null;
  }
  if (isRecord(data)) {
    if (Array.isArray(data.lines) && data.lines.every((entry) => typeof entry === "string")) {
      return data.lines as string[];
    }
    if (typeof data.text === "string") return [data.text];
    if (typeof data.line === "string") return [data.line];
  }
  return null;
}
