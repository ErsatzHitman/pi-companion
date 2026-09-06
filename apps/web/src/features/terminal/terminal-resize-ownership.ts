/**
 * Terminal resize *ownership* policy (plan.md §12.4, T30A3).
 *
 * `TerminalController.resize()` (`@picompanion/frontend-core`, T30A1) is a
 * plain pass-through: it forwards whatever `(rows, cols, intent)` it is
 * given and deliberately does not decide `intent` itself. The daemon's own
 * arbiter (`packages/server/src/terminal/terminal-size-ownership.ts`) keys
 * ownership per connection: a `"claim"` always takes over the PTY size and
 * remembers this connection as the current owner; an `"update"` only takes
 * effect while this connection still *is* that owner, and is silently
 * ignored otherwise. Omitting `intent` is a compatibility fallback the
 * daemon treats as `"claim"` — this module never relies on that fallback,
 * so every resize this app sends is explicit about which one it means.
 *
 * The policy this module encodes, mirroring the reference frontend's
 * "measured (passive) resize vs. explicit claim" split (`D:\paseo`,
 * consulted for behavior only per plan.md §5.2, not copied):
 *
 * - the very first resize sent on a subscribe/resubscribe is a `"claim"`
 *   — subscribing to view a terminal *is* the explicit act that should own
 *   its size, matching the daemon's own implicit claim on
 *   `subscribe_terminal_request`'s `restore.size` (or a `terminal-view.ts`
 *   follow-up claim when no `restore.size` was sent);
 * - every resize after that, for as long as this connection is believed to
 *   still own the terminal, is an `"update"` — a passive container/window
 *   fit should never silently steal ownership back from a viewer that has
 *   taken it over since;
 * - a detected transport disconnect immediately forgets the claim, since
 *   the daemon's per-connection owner is gone with it: the next resize
 *   after reconnecting is a fresh `"claim"` again, exactly like an initial
 *   mount.
 *
 * Deliberately framework-free (no React, no DOM) so it is unit-testable in
 * isolation from xterm/jsdom and reusable verbatim if `apps/android`'s
 * terminal WebView wrapper (T35B) ever needs the identical policy.
 */

export type TerminalResizeIntent = "claim" | "update";

export class TerminalResizeOwnership {
  private owned = false;

  /** `true` once this connection has (re)claimed the terminal's size. */
  isOwned(): boolean {
    return this.owned;
  }

  /**
   * Call once after each subscribe/resubscribe that the daemon accepted
   * (`TerminalSubscribeOutcome.error === null`): the daemon already
   * treated that as this connection's claim (`restore.size`, or the
   * follow-up explicit claim `terminal-view.ts` sends when there was no
   * `restore.size`), so this view's own bookkeeping must agree.
   */
  markSubscribed(): void {
    this.owned = true;
  }

  /**
   * Call when the underlying transport is known to have dropped: the
   * daemon's connection-keyed owner record cannot survive a reconnect, so
   * this view can no longer assume its previous claim still holds.
   */
  markDisconnected(): void {
    this.owned = false;
  }

  /**
   * The intent for the *next* outgoing resize, given everything known so
   * far. Pure — callers combine this with `markSubscribed()`/
   * `markDisconnected()` to keep it in sync; it never mutates state itself.
   */
  nextIntent(): TerminalResizeIntent {
    return this.owned ? "update" : "claim";
  }
}
