/**
 * T31D — CI performance-budget measurement: live event-to-paint p95
 * (plan.md §14.5: "local live-event-to-paint p95: under 100 ms on web
 * ... the mechanism for the paint budget is a frame clock supplied
 * through a platform interface: core batches pending rows into one
 * application per tick").
 *
 * This module measures the latency from "this browser's WebSocket
 * receives a real `agent_stream` push
 * (`packages/protocol/src/messages.ts`'s `AgentStreamMessageSchema`,
 * `type: "agent_stream"`) from the isolated daemon" to "that push's
 * content is visible in the rendered transcript" — client-side render
 * latency, decoupled from how long the round trip to the daemon itself
 * took to produce that push, matching what plan.md §14.5 actually
 * budgets (the frame-clock batching cost, not network latency).
 *
 * **Why the assistant's row, not the user's own.** `use-composer.ts`
 * renders the just-sent message as an optimistic local row *before* any
 * daemon round trip completes (`session-lifecycle.spec.ts`'s module doc:
 * "the outbox write + optimistic row happen before any daemon round
 * trip"), so watching for the user's own text would mostly measure
 * local React commit latency, not anything server-pushed. The
 * assistant's reply is the one thing this browser cannot possibly know
 * before an `agent_stream` push actually delivers it, so this module
 * only ever looks for the marker inside an assistant row — scoped by
 * `[aria-label^="Pi"]` (`StreamingMessage.tsx`'s `role="group"`
 * `aria-label`, `"Pi"` for the assistant speaker, `"You"` for the user
 * — an accessibility contract, not a styling className, so this stays
 * correct across a purely visual restyle).
 *
 * **Why polling `requestAnimationFrame` rather than a `MutationObserver`.**
 * A `MutationObserver` callback fires as a microtask right after the DOM
 * write, which is *before* the browser's next paint — timing that would
 * make this measurement read faster than what a user's eyes actually
 * see. Polling from inside a `requestAnimationFrame` callback instead
 * only ever samples once per composited frame, immediately before the
 * browser paints it, which is the same clock plan.md §14.5's own paint
 * budget mechanism (`apps/web/src/platform/frame-clock.ts`) is built on.
 *
 * Runs entirely inside `page.evaluate`/`page.addInitScript` bodies. This
 * workspace's `e2e/tsconfig.json` intentionally has no `"dom"` lib (see
 * that file), so every DOM/WebSocket/`performance` access below goes
 * through one `globalThis` cast instead of bare `window`/`document`
 * identifiers — the same pattern `fixtures/axe.ts` already uses for its
 * own in-page `page.evaluate` call.
 */
import type { Page } from "@playwright/test";

/** plan.md §14.5. */
export const EVENT_TO_PAINT_P95_BUDGET_MS = 100;

/** The subset of the page's real `WebSocket`/`performance`/`document` globals this module reaches through one cast (see module doc — no `"dom"` lib here). */
interface BudgetGlobalScope {
  WebSocket: new (url: string, protocols?: string | string[]) => BudgetWebSocketLike;
  document: {
    querySelector: (selector: string) => BudgetElementLike | null;
  };
  performance: { now: () => number };
  requestAnimationFrame: (callback: () => void) => void;
  __picoBudgetLastAgentStreamTime?: number | null;
}

interface BudgetWebSocketLike {
  addEventListener: (type: "message", listener: (event: { data: unknown }) => void) => void;
}

interface BudgetElementLike {
  querySelectorAll: (selector: string) => ArrayLike<{ textContent: string | null }>;
}

/**
 * Must be called before any navigation happens on `page` — i.e. before
 * `connectViaUi`'s own first `page.goto` — because `page.addInitScript`
 * re-runs on *every subsequent* navigation in this same page, including
 * the later hard navigation onto the session route that opens the real
 * `WebSocket` this instrumentation needs to already be wrapping by the
 * time it is constructed (`connect-ui.ts`'s module doc: a stored host
 * profile lets `DaemonClientProvider` auto-reconnect on that navigation
 * without repeating the `/connect` flow).
 *
 * Wraps the page's `WebSocket` constructor so every socket it creates
 * also gets a `message` listener that stamps
 * `__picoBudgetLastAgentStreamTime` with `performance.now()` whenever
 * the frame's raw text contains `"type":"agent_stream"` — a cheap
 * substring check rather than a full JSON parse, since this runs on
 * every message any daemon connection this page opens ever receives.
 * The daemon always sends this wire protocol as WebSocket **text**
 * frames (`packages/server`'s `socket.send(JSON.stringify(...))`), so
 * `event.data` is always a string here — never `ArrayBuffer`/`Blob`,
 * regardless of `DaemonClient`'s own `binaryType = "arraybuffer"`
 * request (`daemon-client-websocket-transport.ts`), which only affects
 * frames the server sends as *binary*.
 */
export async function installEventToPaintInstrumentation(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const globalScope = globalThis as unknown as BudgetGlobalScope;
    const NativeWebSocket = globalScope.WebSocket;
    globalScope.__picoBudgetLastAgentStreamTime = null;

    function PatchedWebSocket(url: string, protocols?: string | string[]): BudgetWebSocketLike {
      const socket =
        protocols === undefined ? new NativeWebSocket(url) : new NativeWebSocket(url, protocols);
      socket.addEventListener("message", (event) => {
        const data = event.data;
        if (typeof data === "string" && data.includes('"type":"agent_stream"')) {
          globalScope.__picoBudgetLastAgentStreamTime = globalScope.performance.now();
        }
      });
      return socket;
    }
    (PatchedWebSocket as unknown as { prototype: unknown }).prototype = (
      NativeWebSocket as unknown as { prototype: unknown }
    ).prototype;
    for (const key of ["CONNECTING", "OPEN", "CLOSING", "CLOSED"]) {
      (PatchedWebSocket as unknown as Record<string, unknown>)[key] = (
        NativeWebSocket as unknown as Record<string, unknown>
      )[key];
    }
    globalScope.WebSocket = PatchedWebSocket as unknown as BudgetGlobalScope["WebSocket"];
  });
}

/**
 * Waits for `marker` to appear inside an assistant transcript row
 * (`[aria-label^="Pi"]` within `[data-testid="host-session-transcript"]`
 * — see module doc for why this is scoped to the assistant, not the
 * user's own optimistic row), sampling only from inside a
 * `requestAnimationFrame` callback. Resolves the number of milliseconds
 * between the most recent `agent_stream` frame this page received
 * (`installEventToPaintInstrumentation`'s
 * `__picoBudgetLastAgentStreamTime`) and that paint, or `null` if the
 * marker never appeared within `timeoutMs`.
 *
 * Call this *before* triggering the send (fill + click) that will
 * eventually produce it, and only `await` the returned promise
 * afterwards — the in-page polling loop must already be registered
 * before the round trip that produces the paint it is watching for, or
 * a call that started polling late would read back a larger (i.e. only
 * ever unfairly worse, never fabricated-fast) latency than what was
 * actually painted.
 */
export function waitForAssistantPaint(
  page: Page,
  marker: string,
  timeoutMs = 8_000,
): Promise<number | null> {
  return page.evaluate(
    ({ marker, timeoutMs }) => {
      const globalScope = globalThis as unknown as BudgetGlobalScope;

      return new Promise<number | null>((resolve) => {
        const deadline = globalScope.performance.now() + timeoutMs;

        function poll(): void {
          let found = false;
          const container = globalScope.document.querySelector(
            '[data-testid="host-session-transcript"]',
          );
          if (container) {
            const rows = container.querySelectorAll('[aria-label^="Pi"]');
            for (let i = 0; i < rows.length; i += 1) {
              const row = rows[i];
              if (row && (row.textContent ?? "").includes(marker)) {
                found = true;
                break;
              }
            }
          }
          if (found) {
            const paintTime = globalScope.performance.now();
            const raw = globalScope.__picoBudgetLastAgentStreamTime;
            resolve(typeof raw === "number" ? paintTime - raw : null);
            return;
          }
          if (globalScope.performance.now() > deadline) {
            resolve(null);
            return;
          }
          globalScope.requestAnimationFrame(poll);
        }
        globalScope.requestAnimationFrame(poll);
      });
    },
    { marker, timeoutMs },
  );
}

/** Nearest-rank p95 over `samplesMs` (sorted ascending internally; the input is never mutated). */
export function computeP95(samplesMs: readonly number[]): number {
  if (samplesMs.length === 0) {
    throw new Error("computeP95 called with zero samples");
  }
  const sorted = [...samplesMs].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1);
  return sorted[index]!;
}
