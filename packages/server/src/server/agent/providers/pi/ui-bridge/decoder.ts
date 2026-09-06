import { z } from "zod";
import {
  PIUI_MARKER,
  PIUI_MAX_REASSEMBLED_BYTES,
  PIUI_CHUNK_TTL_MS,
  PiUiElementSchema,
} from "./schema.js";
// COMPAT(piUiPayloadV2): added 2026-08-31, remove after 2027-02-28.
import { normalizePiUiElementInput } from "./payload-compat.js";

// One-time warning for unknown channels
const unknownChannelWarned = new Set<string>();

function warnUnknownChannel(channel: string): void {
  if (unknownChannelWarned.has(channel)) return;
  unknownChannelWarned.add(channel);
  console.warn(`[pi-ui-bridge] unknown channel dropped: ${channel}`);
}

// Zod schemas for PIUI wire ops (v1)
const ChunkSchema = z.object({
  v: z.literal(1),
  op: z.literal("chunk"),
  id: z.string().min(1),
  i: z.number().int().nonnegative(),
  n: z.number().int().positive(),
  data: z.string(),
});

const ChannelSchema = z.object({
  v: z.literal(1),
  op: z.literal("channel"),
  channel: z.string().min(1),
  payload: z.unknown(),
  agentSeq: z.number().int().nonnegative().optional(),
});

// Generic PIUI op detection; specific ops validated lazily per kind
const BaseSchema = z.object({
  v: z.literal(1),
  op: z.string().min(1),
  agentSeq: z.number().int().nonnegative().optional(),
});

type ChunkBuffer = {
  parts: Array<string | undefined>;
  totalSize: number;
  n: number;
  received: number;
  timer: ReturnType<typeof setTimeout>;
};

// Result type returned to caller/state
export type PiUiDecodedOp =
  | { kind: "set"; el: z.infer<typeof PiUiElementSchema>; agentSeq?: number }
  | { kind: "patch"; id: string; ns: string; patch: Record<string, unknown>; agentSeq?: number }
  | { kind: "remove"; id: string; ns?: string; agentSeq?: number }
  | { kind: "clear"; agentSeq?: number }
  | { kind: "sync"; elements: z.infer<typeof PiUiElementSchema>[]; agentSeq?: number }
  | { kind: "append"; id: string; ns: string; data: unknown; agentSeq?: number }
  | { kind: "channel"; channel: string; payload: unknown; agentSeq?: number };

export type PiUiDecoderCallbacks = {
  onOp: (op: PiUiDecodedOp) => void;
  onNotice: (level: "info" | "warning" | "error", message: string) => void;
};

export class PiUiDecoder {
  private chunks = new Map<string, ChunkBuffer>();

  constructor(private readonly callbacks: PiUiDecoderCallbacks) {}

  /** Returns true if message was PIUI (handled), false if not PIUI, null-ish handled via chunk buffering */
  ingest(rawMessage: string): boolean {
    if (!rawMessage.startsWith(PIUI_MARKER)) return false;

    const jsonText = rawMessage.slice(PIUI_MARKER.length);
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonText);
    } catch (err) {
      this.callbacks.onNotice(
        "error",
        `PIUI invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
      );
      return true; // consumed, do not leak
    }

    if (!parsed || typeof parsed !== "object") {
      this.callbacks.onNotice("error", "PIUI payload must be an object");
      return true;
    }

    const base = BaseSchema.safeParse(parsed);
    if (!base.success) {
      this.callbacks.onNotice("error", `PIUI invalid base: ${base.error.message}`);
      return true;
    }

    // Chunk handling
    if (base.data.op === "chunk") {
      const res = ChunkSchema.safeParse(parsed);
      if (!res.success) {
        this.callbacks.onNotice("error", `PIUI invalid chunk: ${res.error.message}`);
        return true;
      }
      this.handleChunk(res.data);
      return true;
    }

    // Channel op
    if (base.data.op === "channel") {
      const res = ChannelSchema.safeParse(parsed);
      if (!res.success) {
        this.callbacks.onNotice("error", `PIUI invalid channel: ${res.error.message}`);
        return true;
      }
      const ch = res.data.channel;
      // registry check
      if (!isKnownChannel(ch)) {
        warnUnknownChannel(ch);
        return true; // dropped
      }
      this.callbacks.onOp({
        kind: "channel",
        channel: ch,
        payload: res.data.payload,
        agentSeq: res.data.agentSeq,
      });
      return true;
    }

    // Regular ops: set/patch/remove/clear/sync/append
    const op = base.data.op;
    const agentSeq = base.data.agentSeq;
    const record = parsed as Record<string, unknown>;

    try {
      switch (op) {
        case "set":
        case "upsert": {
          // supports both "el" and "element"
          const elRaw = record.el ?? record.element;
          // COMPAT(piUiPayloadV2): added 2026-08-31, remove after 2027-02-28.
          // Normalization runs at the daemon boundary, before protocol
          // validation, so old helper messages (v1 top-level fields) and
          // canonical payload messages are both accepted (plan.md §4.2).
          const parsedEl = PiUiElementSchema.safeParse(normalizePiUiElementInput(elRaw));
          if (!parsedEl.success) {
            this.callbacks.onNotice("error", `PIUI set invalid element: ${parsedEl.error.message}`);
            return true;
          }
          this.callbacks.onOp({ kind: "set", el: parsedEl.data, agentSeq });
          return true;
        }
        case "patch": {
          const id =
            typeof record.id === "string"
              ? record.id
              : typeof record.elementId === "string"
                ? record.elementId
                : undefined;
          const ns = typeof record.ns === "string" ? record.ns : undefined;
          if (!id || !ns) {
            this.callbacks.onNotice("error", "PIUI patch requires id and ns");
            return true;
          }
          const patch = (record.patch ?? record.data ?? record.el) as Record<string, unknown>;
          if (!patch || typeof patch !== "object") {
            this.callbacks.onNotice("error", "PIUI patch requires patch object");
            return true;
          }
          this.callbacks.onOp({
            kind: "patch",
            id,
            ns,
            patch: patch as Record<string, unknown>,
            agentSeq,
          });
          return true;
        }
        case "remove": {
          const id =
            typeof record.id === "string"
              ? record.id
              : typeof record.elementId === "string"
                ? record.elementId
                : undefined;
          if (!id) {
            this.callbacks.onNotice("error", "PIUI remove requires id");
            return true;
          }
          const ns = typeof record.ns === "string" ? record.ns : undefined;
          this.callbacks.onOp({ kind: "remove", id, ns, agentSeq });
          return true;
        }
        case "clear": {
          this.callbacks.onOp({ kind: "clear", agentSeq });
          return true;
        }
        case "sync": {
          const elementsRaw = record.elements ?? record.els ?? [];
          if (!Array.isArray(elementsRaw)) {
            this.callbacks.onNotice("error", "PIUI sync requires elements array");
            return true;
          }
          const elements: z.infer<typeof PiUiElementSchema>[] = [];
          for (const e of elementsRaw) {
            // COMPAT(piUiPayloadV2): added 2026-08-31, remove after 2027-02-28.
            const pr = PiUiElementSchema.safeParse(normalizePiUiElementInput(e));
            if (!pr.success) {
              this.callbacks.onNotice(
                "warning",
                `PIUI sync skipped invalid element: ${pr.error.message}`,
              );
              continue;
            }
            elements.push(pr.data);
          }
          this.callbacks.onOp({ kind: "sync", elements, agentSeq });
          return true;
        }
        case "append": {
          const id =
            typeof record.id === "string"
              ? record.id
              : typeof record.elementId === "string"
                ? record.elementId
                : undefined;
          const ns = typeof record.ns === "string" ? record.ns : undefined;
          if (!id || !ns) {
            this.callbacks.onNotice("error", "PIUI append requires id and ns");
            return true;
          }
          const data = record.data ?? record.patch ?? record.el;
          this.callbacks.onOp({ kind: "append", id, ns, data, agentSeq });
          return true;
        }
        default: {
          this.callbacks.onNotice("warning", `PIUI unknown op dropped: ${op}`);
          return true;
        }
      }
    } catch (err) {
      this.callbacks.onNotice(
        "error",
        `PIUI handling failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return true;
    }
  }

  private handleChunk(chunk: z.infer<typeof ChunkSchema>): void {
    const { id, i, n, data } = chunk;
    let buf = this.chunks.get(id);
    if (!buf) {
      if (i !== 0) {
        // out-of-order first chunk? still create buffer but will check completeness
      }
      const timer = setTimeout(() => {
        this.chunks.delete(id);
        this.callbacks.onNotice(
          "warning",
          `PIUI chunk ${id} discarded after ${PIUI_CHUNK_TTL_MS}ms timeout`,
        );
      }, PIUI_CHUNK_TTL_MS);
      // Node timers have unref
      (timer as unknown as { unref?: () => void }).unref?.();
      buf = { parts: new Array(n), totalSize: 0, n, received: 0, timer };
      this.chunks.set(id, buf);
    }

    if (i >= buf.n || buf.n !== n) {
      this.callbacks.onNotice("error", `PIUI chunk id=${id} mismatched n or i out of bounds`);
      return;
    }
    if (buf.parts[i] !== undefined) {
      // duplicate
      return;
    }
    const dataBytes = Buffer.byteLength(data, "utf8");
    buf.totalSize += dataBytes;
    if (buf.totalSize > PIUI_MAX_REASSEMBLED_BYTES) {
      clearTimeout(buf.timer);
      this.chunks.delete(id);
      this.callbacks.onNotice("error", `PIUI reassembled payload exceeds 1 MiB cap (id=${id})`);
      return;
    }
    buf.parts[i] = data;
    buf.received += 1;

    if (i === n - 1) {
      // check if all parts received
      if (buf.received !== n || buf.parts.some((p) => p === undefined)) {
        // not yet complete, wait for missing pieces (still within timeout)
        return;
      }
      clearTimeout(buf.timer);
      this.chunks.delete(id);
      const reassembled = buf.parts.join("");
      if (Buffer.byteLength(reassembled, "utf8") > PIUI_MAX_REASSEMBLED_BYTES) {
        this.callbacks.onNotice("error", `PIUI reassembled payload exceeds 1 MiB cap (id=${id})`);
        return;
      }
      // Recursively ingest the reassembled PIUI payload (it should be JSON of an op, without PIUI prefix)
      // The chunk data is the JSON payload string itself (without PIUI prefix)
      // So we re-prefix for parsing
      const fakeMarker = PIUI_MARKER + reassembled;
      this.ingest(fakeMarker);
    }
  }

  destroy(): void {
    for (const buf of this.chunks.values()) {
      clearTimeout(buf.timer);
    }
    this.chunks.clear();
  }
}

function isKnownChannel(channel: string): boolean {
  return (
    channel === "subagents:fleet" || channel === "workflow:progress" || channel === "pi-goal:status"
  );
}
