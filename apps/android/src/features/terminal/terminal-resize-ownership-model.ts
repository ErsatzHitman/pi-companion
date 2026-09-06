/**
 * Terminal resize ownership decision model (T35B3, plan.md §5.2 "terminal
 * resize ownership", §13 Phase 7.2 "Terminal latency and resize
 * ownership").
 *
 * A **written model of daemon behavior**, derived from reading — never
 * copying — `packages/server/src/terminal/terminal-size-ownership.ts`'s
 * `applyTerminalSize` in *this* repository (itself a port of the
 * equivalent rule in `D:\paseo\packages\server`; nothing here reads or
 * reuses anything from `D:\paseo\packages\app`). That file is the real
 * decision the daemon makes every time any client — this Android screen,
 * a browser tab, another device — sends a `Resize` opcode or a
 * `terminal.input` `{ type: "resize" }` message:
 *
 *   - `intent: "claim"` **always wins**, unconditionally: it both
 *     reassigns ownership to whoever sent it (evicting any prior owner,
 *     including one that has since disconnected — the daemon's
 *     `WeakMap<TerminalSession, object>` never explicitly clears a
 *     disconnected owner; the next claim simply overwrites the entry)
 *     and applies the requested size.
 *   - `intent: "update"` only succeeds when the sender **is** the
 *     terminal's current owner; from anyone else it is rejected outright
 *     — ownership is untouched and the size is never applied.
 *   - No `intent` at all is treated as `"claim"` (the daemon's own
 *     documented back-compat default), so the two-branch decision below
 *     never needs a third case.
 *
 * This repo's Android terminal (`terminal-resize-controller.ts`) only
 * ever emits `"claim"` — see that file's module doc — because this
 * screen shows exactly one terminal at a time with no multi-pane
 * ownership negotiation of its own to model. That makes the ownership
 * question trivial for *this* client considered alone (a claim always
 * wins), but "matches daemon behaviour" is a claim about the *shared*
 * decision every client is subject to, including ones this codebase
 * does not own (a browser tab, a second device) — this model exists to
 * state and test that shared decision directly, independent of which
 * client happens to be asking, rather than leaving it implicit in one
 * client's always-claims behavior.
 *
 * `owner` is deliberately typed as `object`, matching the daemon's own
 * `WeakMap<TerminalSession, object>` keying: identity, not a client id
 * string — two requests are "the same owner" only by reference equality,
 * exactly as `terminalSizeOwners.get(terminal) !== owner` checks it.
 *
 * **T32S11 (P5-W16) decision, so this stops drifting a fourth wave:**
 * this module is, and remains, a **verification model only** — a pure
 * function this repository's tests hold the daemon's ownership rule
 * against, not a decision point any real resize request is routed
 * through. `decideTerminalResizeOwnership` has no importer outside its
 * own test file today (confirmed again this wave: `terminal-resize-
 * controller.ts`, this module's one real-client neighbor, never calls
 * it — see that file's own doc comment for why an always-"claim" client
 * has no ownership question of its own to route through this function).
 * `apps/android/src/app/` and `app-shell/` (this task's `Owns` grant)
 * have no live terminal-resize wire handling to wire it into either —
 * `app-shell/core.ts` still constructs
 * `createNotConnectedTerminalBinaryTransport()`, so no real `Resize`
 * opcode is ever sent from this app yet (see this task's report).
 *
 * That is also why `TerminalResizeOwnershipRequest.intent` above is
 * typed as the required, resolved `"claim" | "update"`, never
 * `TerminalResizeOwnershipIntent | undefined`: this function models only
 * the daemon's *ownership* branch once an intent is already known, not
 * the daemon's separate "no intent at all on the wire" normalization
 * step. The `applyTerminalSize` COMPAT default this module's own doc
 * above describes (`undefined` on the wire behaves as `"claim"`) is a
 * decision a real caller — the still-unbuilt live counterpart to
 * `terminal-resize-controller.ts`'s always-`"claim"` emitter, for
 * whichever client (this one, a browser tab) actually needs to *decode*
 * an incoming request rather than only emit its own — must apply
 * *before* calling `decideTerminalResizeOwnership`, by normalizing a
 * missing/`undefined` wire `intent` to the literal `"claim"` first, the
 * same way this repository's own emitter already always sends `"claim"`
 * outright rather than omitting `intent`. Extending this function's own
 * parameter type to accept `undefined` would let a caller skip that
 * normalization and still get the right *decision*, but would blur the
 * one thing this model is trying to keep separate and testable: "what
 * does an already-known intent decide" (this function) versus "what does
 * a missing intent resolve to" (the COMPAT default, one line of prose,
 * not a branch this function needs). Two branches remain correct for
 * *this* function; a third, wire-level normalization step belongs to
 * whichever future task builds the real inbound handler, immediately
 * before its one call into this one.
 */

export type TerminalResizeOwnershipIntent = "claim" | "update";

export interface TerminalResizeOwnershipRequest {
  /** Identity of the client asking — reference equality, not a string id. See module doc. */
  readonly requester: object;
  readonly intent: TerminalResizeOwnershipIntent;
}

export interface TerminalResizeOwnershipDecision {
  /** Whether the daemon would apply the requested size to the PTY. */
  readonly applied: boolean;
  /** The owner of record after this request — unchanged from `currentOwner` when rejected. */
  readonly owner: object | null;
}

/**
 * The daemon's `applyTerminalSize` ownership branch, modeled as a pure
 * function: given who currently owns the terminal's size — `null` for
 * "nobody has claimed it yet", mirroring the daemon's own
 * `WeakMap.get` returning `undefined` for an unclaimed terminal — and
 * one request, decides whether the request is honored and who owns it
 * afterward.
 */
export function decideTerminalResizeOwnership(
  currentOwner: object | null,
  request: TerminalResizeOwnershipRequest,
): TerminalResizeOwnershipDecision {
  if (request.intent === "update" && currentOwner !== request.requester) {
    return { applied: false, owner: currentOwner };
  }
  const owner = request.intent === "claim" ? request.requester : currentOwner;
  return { applied: true, owner };
}
