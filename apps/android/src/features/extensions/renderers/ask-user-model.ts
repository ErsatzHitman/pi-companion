/**
 * The redesign's ask-user `.pop` (`HANDOFF.md` §7.2), as the two
 * decisions a `panel` renderer has to make about one — T361.
 *
 * RN-free, so both are provable by execution under this workspace's
 * plain `vitest`, which cannot parse `react-native` (`CLAUDE.md`).
 *
 * ## There is no ask-user KIND on the wire
 *
 * `HANDOFF.md` §6.3 records the shape the daemon actually sends: ask-user
 * arrives as an ordinary `panel` placed as a `sheet`, composing a `form`
 * — or, for a yes/no, as a confirm permission through `SessionApprovals`.
 * So the tag below is keyed on the namespace, which is the only thing
 * that distinguishes it, and it is drawn for EVERY sheet-placement
 * panel's namespace rather than only for `ask-user`. Special-casing one
 * string would make every other extension's sheet look unlabelled and
 * would break the moment someone shipped `ask-user-v2`.
 *
 * ## The footer hint is rewritten, not reproduced
 *
 * The artifact's footer reads "1-2 to answer · esc to let the model
 * choose". Both halves are keyboard instructions: Android has no number
 * row bound to anything here and no `esc` key. Printing them would be a
 * visible instruction the reader cannot follow — the same class of
 * defect `CLAUDE.md`'s T124 section is about, and the same call T359
 * made for the bash block's "esc to cancel". The hint says what a touch
 * reader can actually do, and it only claims the dismiss half when the
 * panel really can be dismissed.
 */

/** The artifact's `[ns]` tag: the namespace in brackets, in purple. */
export function askUserTagLabel(ns: string): string {
  return `[${ns}]`;
}

/**
 * What the footer says under a sheet-placement panel.
 *
 * `dismissible` is the panel's own local open state being closable —
 * there is no wire "dismiss", so closing leaves the element in the
 * store and a reopen button in its place. When it is false the second
 * clause is dropped rather than softened: a hint that offers a way out
 * that is not there is worse than a shorter hint.
 */
export function askUserFooterHint(dismissible: boolean): string {
  const answer = "Tap an option to answer";
  return dismissible ? `${answer} · dismiss to let the model choose` : answer;
}
