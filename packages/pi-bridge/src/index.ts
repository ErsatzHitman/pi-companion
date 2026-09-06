// @picompanion/bridge — thin dual-mode helper for Pi extensions (<300 lines)
// Dual rendering: tui -> ctx.ui.* , rpc -> PIUI marker via ctx.ui.notify, print/json -> no-op.
// Coalesces patch ops per element on 100ms; chunks payloads >32 KiB into PIUI chunk frames.

const PIUI_MARKER = "PIUI ";
const PIUI_V = 1;
const PIUI_MAX_BYTES = 32 * 1024;
const PATCH_COALESCE_MS = 100;
const CHUNK_SLICE = 28 * 1024;

type Ctx = { mode?: string; hasUI?: boolean; ui?: Record<string, (...a: unknown[]) => unknown> };
type Pi = {
  mode?: string;
  hasUI?: boolean;
  ctx?: Ctx;
  events?: {
    on: (e: string, cb: (p: unknown) => void) => void;
    emit: (e: string, p: unknown) => void;
  };
  on?: (e: string, cb: (...a: unknown[]) => void) => void;
  registerCommand?: (
    n: string,
    d: { description: string; handler: (args: string, ctx: Ctx) => Promise<void> },
  ) => void;
  ui?: Ctx["ui"];
};

let piRef: Pi | null = null;
let ctxRef: Ctx | null = null;
let agentSeq = 0;
let chunkId = 0;
let installed = false;

const patchBuf = new Map<
  string,
  { ns: string; id: string; acc: Record<string, unknown>; t: ReturnType<typeof setTimeout> }
>();
const handlers = new Map<string, Set<(v: unknown) => void>>();

function getMode(): string | undefined {
  return ctxRef?.mode ?? piRef?.mode ?? piRef?.ctx?.mode;
}
function hasUI(): boolean {
  if (ctxRef?.hasUI === false) return false;
  if (piRef?.hasUI === false) return false;
  const m = getMode();
  if (m === "print" || m === "json") return false;
  return true;
}
function isTui(): boolean {
  return getMode() === "tui";
}
function notifyRaw(msg: string): void {
  const ui = ctxRef?.ui ?? piRef?.ui ?? (piRef?.ctx as Ctx | undefined)?.ui;
  try {
    (ui?.notify as ((m: string, l?: string) => void) | undefined)?.(msg, "info");
  } catch {}
  // fallback: Pi's global ctx.ui may be on ctxRef
  try {
    (ctxRef?.ui?.notify as unknown as (m: string) => void)?.(msg);
  } catch {}
}

function emitPiUi(obj: Record<string, unknown>): void {
  if (!hasUI()) return;
  const payload = { v: PIUI_V, agentSeq: agentSeq++, ...obj } as Record<string, unknown>;
  if (isTui()) {
    renderTui(payload);
    return;
  }
  sendChunked(payload);
}

function sendChunked(payload: Record<string, unknown>): void {
  const json = JSON.stringify(payload);
  const full = PIUI_MARKER + json;
  // Node Buffer may not exist in all envs; approximate with string length
  const bytes = typeof Buffer !== "undefined" ? Buffer.byteLength(full, "utf8") : full.length;
  if (bytes <= PIUI_MAX_BYTES) {
    notifyRaw(full);
    return;
  }
  const id = `c${++chunkId}_${Date.now().toString(36)}`;
  const n = Math.ceil(json.length / CHUNK_SLICE);
  for (let i = 0; i < n; i++) {
    const data = json.slice(i * CHUNK_SLICE, (i + 1) * CHUNK_SLICE);
    const chunk = { v: PIUI_V, op: "chunk", id, i, n, data };
    notifyRaw(PIUI_MARKER + JSON.stringify(chunk));
  }
}

function renderTui(payload: Record<string, unknown>): void {
  const ui = ctxRef?.ui as Record<string, (...a: unknown[]) => unknown> | undefined;
  if (!ui) return;
  try {
    if (payload.op === "set" || payload.op === "upsert") {
      const el = (payload.el ?? payload.element) as Record<string, unknown> | undefined;
      if (!el) return;
      if (el.kind === "status" && ui.setStatus)
        ui.setStatus(
          el.id as string,
          (el.title as string) ?? (el as Record<string, unknown>).text ?? "",
        );
      else if (el.kind === "widget" && ui.setWidget)
        ui.setWidget(
          el.id as string,
          (el as Record<string, unknown>).lines ?? [(el.title as string) ?? ""],
          "above",
        );
      else if (el.kind === "composer" && ui.setEditorText)
        (ui.setEditorText as (t: string) => void)(
          ((el as Record<string, unknown>).text as string) ?? "",
        );
      else if (ui.custom) (ui.custom as (c: unknown) => void)(() => JSON.stringify(el));
    } else if (payload.op === "remove" && ui.setStatus && typeof payload.id === "string") {
      // heuristic: clear status if setStatus with undefined removes
      try {
        (ui.setStatus as (k: string, v: undefined) => void)(payload.id as string, undefined);
      } catch {}
    }
  } catch {}
}

// Coalesced patch
function schedulePatch(ns: string, id: string, patch: Record<string, unknown>): void {
  const key = `${ns}:${id}`;
  const existing = patchBuf.get(key);
  if (existing) {
    Object.assign(existing.acc, patch);
    return;
  }
  const acc = { ...patch };
  const t = setTimeout(() => {
    patchBuf.delete(key);
    emitPiUi({ op: "patch", id, ns, patch: acc });
  }, PATCH_COALESCE_MS);
  // @ts-ignore unref
  (t as unknown as { unref?: () => void }).unref?.();
  patchBuf.set(key, { ns, id, acc, t });
}

// Install: binds pi/ctx and registers pi_ui_event command once
export function install(pi: Pi, ctx?: Ctx): void {
  if (pi) piRef = pi;
  if (ctx) ctxRef = ctx;
  else if (pi?.ctx) ctxRef = pi.ctx as Ctx;
  if (installed) return;
  try {
    pi.registerCommand?.("pi_ui_event", {
      description: "Internal Pi Companion UI bridge",
      handler: async (args: string, c: Ctx) => {
        if (c) ctxRef = c;
        const raw = (args ?? "").trim();
        if (!raw) return;
        let dec: Record<string, unknown>;
        try {
          const b =
            typeof Buffer !== "undefined"
              ? Buffer.from(raw, "base64url").toString("utf8")
              : atob(raw.replace(/-/g, "+").replace(/_/g, "/"));
          dec = JSON.parse(b) as Record<string, unknown>;
        } catch {
          return;
        }
        const elId = dec.elementId as string | undefined;
        const act = dec.actionId as string | undefined;
        const ns = elId ? String(elId).split(":")[0] : (dec.ns as string | undefined);
        const val = (dec.value ?? dec.payload) as unknown;
        if (ns)
          try {
            pi.events?.emit(`piui:${ns}`, { elementId: elId, actionId: act, value: val, raw: dec });
          } catch {}
        if (elId && act) {
          for (const k of [`${elId}:${act}`, `${ns ?? ""}:${act}`]) {
            const set = handlers.get(k);
            if (set)
              for (const cb of [...set])
                try {
                  cb(val);
                } catch {}
          }
        }
      },
    });
    installed = true;
  } catch {}
  try {
    pi.on?.("session_start", (...a: unknown[]) => {
      const c = a[1] as Ctx | undefined;
      if (c) ctxRef = c;
    });
  } catch {}
}

export function setCtx(ctx: Ctx): void {
  ctxRef = ctx;
}

// publish: one-line pass-through + PIUI channel marker in rpc mode
export function publish(channel: string, payload: unknown): void {
  try {
    piRef?.events?.emit(channel, payload);
  } catch {}
  if (!hasUI() || isTui()) return;
  emitPiUi({ op: "channel", channel, payload });
}

// PanelHandle
export type PanelHandle = {
  id: string;
  ns: string;
  patch: (
    idOrPatch: string | Record<string, unknown>,
    maybePatch?: Record<string, unknown>,
  ) => void;
  append: (id: string, text: string) => void;
  on: (actionId: string, cb: (value: unknown) => void) => () => void;
  close: (opts?: { durable?: boolean }) => void;
};

function makeHandle(ns: string, id: string): PanelHandle {
  return {
    id,
    ns,
    patch: (a: string | Record<string, unknown>, b?: Record<string, unknown>) => {
      if (typeof a === "string" && b && typeof b === "object") schedulePatch(ns, a, b);
      else if (typeof a === "object") schedulePatch(ns, id, a as Record<string, unknown>);
    },
    append: (appendId: string, text: string) => {
      emitPiUi({ op: "append", id: appendId, ns, data: text });
    },
    on: (actionId: string, cb: (v: unknown) => void) => {
      const k1 = `${id}:${actionId}`;
      const k2 = `${ns}:${actionId}`;
      for (const k of [k1, k2]) {
        let set = handlers.get(k);
        if (!set) {
          set = new Set();
          handlers.set(k, set);
        }
        set.add(cb as (v: unknown) => void);
      }
      return () => {
        for (const k of [k1, k2]) handlers.get(k)?.delete(cb as (v: unknown) => void);
      };
    },
    close: (opts?: { durable?: boolean }) => {
      // flush coalesced patches immediately
      const key = `${ns}:${id}`;
      const pending = patchBuf.get(key);
      if (pending) {
        clearTimeout(pending.t);
        patchBuf.delete(key);
        emitPiUi({ op: "patch", id, ns, patch: pending.acc });
      }
      if (opts?.durable)
        emitPiUi({ op: "set", el: { id, ns, kind: "panel", placement: "inline", durable: true } });
      emitPiUi({ op: "remove", id, ns });
    },
  };
}

function buildEl(
  ns: string,
  kind: string,
  spec: unknown,
  defaults: Record<string, unknown> = {},
): Record<string, unknown> {
  const s = (spec && typeof spec === "object" ? (spec as Record<string, unknown>) : {}) as Record<
    string,
    unknown
  >;
  const id = (s.id as string) ?? kind;
  const placement = (s.placement as string) ?? defaults.placement ?? "inline";
  const base: Record<string, unknown> = { ...defaults, ...s, id, ns, kind, placement };
  // carry through title/text/etc
  return base;
}

export const ui = {
  panel(ns: string, spec: Record<string, unknown> = {}): PanelHandle {
    const el = buildEl(ns, "panel", spec, { placement: "sheet" });
    emitPiUi({ op: "set", el });
    return makeHandle(ns, el.id as string);
  },
  widget(ns: string, spec: Record<string, unknown> = {}): PanelHandle {
    const el = buildEl(ns, "widget", spec, { placement: "pinned" });
    emitPiUi({ op: "set", el });
    return makeHandle(ns, el.id as string);
  },
  status(ns: string, text: string | Record<string, unknown>): PanelHandle {
    const spec =
      typeof text === "string" ? { text, title: text } : (text as Record<string, unknown>);
    const el = buildEl(
      ns,
      "status",
      {
        ...spec,
        title:
          (spec as Record<string, unknown>).title ?? (spec as Record<string, unknown>).text ?? text,
      },
      { placement: "status" },
    );
    emitPiUi({ op: "set", el });
    return makeHandle(ns, el.id as string);
  },
  progress(ns: string, spec: Record<string, unknown> = {}): PanelHandle {
    const el = buildEl(ns, "progress", spec, { placement: "pinned" });
    emitPiUi({ op: "set", el });
    return makeHandle(ns, el.id as string);
  },
  roster(ns: string, spec: Record<string, unknown> = {}): PanelHandle {
    const el = buildEl(ns, "roster", spec, { placement: "inline" });
    emitPiUi({ op: "set", el });
    return makeHandle(ns, el.id as string);
  },
  log(ns: string, spec: Record<string, unknown> = {}): PanelHandle {
    const el = buildEl(ns, "log", spec, { placement: "inline" });
    emitPiUi({ op: "set", el });
    return makeHandle(ns, el.id as string);
  },
  markdown(ns: string, text: string): PanelHandle {
    const el = buildEl(ns, "markdown", { text, title: text.slice(0, 80) }, { placement: "inline" });
    emitPiUi({ op: "set", el });
    return makeHandle(ns, el.id as string);
  },
  diff(ns: string, diffText: string | Record<string, unknown>): PanelHandle {
    const spec =
      typeof diffText === "string"
        ? { unifiedDiff: diffText }
        : (diffText as Record<string, unknown>);
    const el = buildEl(ns, "diff", spec, { placement: "inline" });
    emitPiUi({ op: "set", el });
    return makeHandle(ns, el.id as string);
  },
  form(ns: string, fields: unknown): PanelHandle {
    const el = buildEl(ns, "form", { fields }, { placement: "sheet" });
    emitPiUi({ op: "set", el });
    return makeHandle(ns, el.id as string);
  },
  composer(text: string): PanelHandle {
    const el: Record<string, unknown> = {
      id: "composer",
      ns: "composer",
      kind: "composer",
      placement: "inline",
      text,
    };
    emitPiUi({ op: "set", el });
    return makeHandle("composer", "composer");
  },
};

// Re-export constants for daemon/tests if needed
export const __internal = { PIUI_MARKER, PIUI_MAX_BYTES };
