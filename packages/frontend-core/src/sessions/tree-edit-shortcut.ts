/**
 * Edit-from-here branch shortcut — plan.md §11.1 ("session tree, fork,
 * clone, resume, and naming"), T38A1b. Folded in from the ompweb review
 * (`D:\ompweb-review\notes\02-chat-ui.md`, "Quick edit-from-here";
 * `D:\ompweb-review\ompweb-reference-review.md`, "Branching") rather than
 * built as a new T38A1 criterion, because it is an independently
 * shippable affordance layered on top of T38A1a's tree model, not part of
 * that model itself.
 *
 * ## What "edit from here" means here, and why it is not a fourth primitive
 *
 * ompweb's "edit from here" is an *in-session* rewind: it walks a single
 * `.jsonl` file's entry tree back to the assistant entry just before the
 * user message being edited, then refills the composer with that
 * message's text (`onNavigate(prevAssistantEntryId)` then
 * `onEditContent(content)`). Pi has no in-session rewind RPC — the only
 * way our daemon can branch a conversation at all is `fork` (T38A1a's
 * `forkSession`), which always creates a *new* session attached at a
 * `SessionForkPoint`.
 *
 * So in this codebase "edit from here" is not a third way to branch
 * alongside fork and clone. It is a one-step *shortcut* that:
 *
 *  1. derives the `SessionForkPoint` the edit implies — the last message
 *     the caller still wants to keep, i.e. the message immediately before
 *     the one being edited (`resolveEditFromHereForkPoint`); then
 *  2. hands that fork point straight to `forkSession`, exactly as any
 *     other caller of the T38A1a model would (`editFromHere`).
 *
 * ## Composition, not duplication
 *
 * This module owns none of the tree invariants `tree.ts` already proved:
 * root inheritance across a fork chain, frozen nodes, and
 * construction-only cycle-freedom (see that file's module doc). It does
 * no node construction of its own — `editFromHere` below computes a fork
 * point from the caller's two message references and then calls
 * `forkSession`. `tree-edit-shortcut.test.ts` proves the delegation
 * itself, not just matching output: it spies on the real `forkSession`
 * export, asserts `editFromHere` calls it with the derived fork point,
 * and asserts the node `editFromHere` returns is reference-identical to
 * what that call produced — nothing is copied, re-wrapped, or
 * reconstructed in between. A version that quietly stopped delegating
 * (e.g. hand-building `{ kind: "fork", parent, ... }` inline) would still
 * satisfy every behavioural assertion but fail the spy-call assertion,
 * which is the point of testing composition rather than only outcome.
 *
 * Repository invariant: this module must never import React, React
 * Native, Expo, DOM types, or browser globals.
 */

import {
  forkSession,
  type ForkSessionParams,
  type SessionForkPoint,
  type SessionTreeNode,
} from "./tree.js";

/**
 * A minimal reference to one message in a session's timeline — just
 * enough to place it in the branch tree. This module never reads a full
 * timeline; a caller such as the composer (T38A3) already has one and
 * supplies the two references it needs directly.
 */
export interface EditFromHereMessageRef {
  readonly id: string;
  readonly index: number;
}

/**
 * The user message being edited, plus the message immediately before it
 * in the same timeline — the shared history the new branch keeps.
 * `previous` is `null` when the edited message is the first message in
 * the session, mirroring ompweb's own guard (`prevAssistantEntryId`
 * existing is a precondition for showing the affordance at all).
 *
 * `role` is carried only so this module can enforce the "on a user
 * message" half of T38A1b's first checkbox at the type level — it never
 * inspects `text` or otherwise interprets message content.
 */
export interface EditFromHereTarget {
  readonly role: "user";
  readonly id: string;
  readonly index: number;
  readonly text: string;
  readonly previous: EditFromHereMessageRef | null;
}

export interface EditFromHereParams {
  /** The session tree node the edited message belongs to — forked to produce the new branch. */
  readonly parent: SessionTreeNode;
  /** The id the daemon assigns the forked session. */
  readonly agentId: string;
  readonly createdAt: number;
  readonly name?: string | null;
  readonly target: EditFromHereTarget;
}

export interface EditFromHereResult {
  /** The new branch, produced by `forkSession` — see the module doc. */
  readonly node: SessionTreeNode;
  /** The fork point this shortcut derived, exposed for callers that want to show or log it. */
  readonly forkPoint: SessionForkPoint;
  /**
   * The edited message's original text, for a caller to refill a
   * composer with (ompweb's `onEditContent`) instead of re-deriving it
   * from `params.target` a second time.
   */
  readonly draftText: string;
}

/**
 * Thrown when a target cannot be turned into a fork point. Reasoned
 * rejection rather than a crash, so a caller can use it to decide whether
 * to show the affordance at all — mirroring ompweb's `canNavigate` guard,
 * which disables the button instead of letting a click fail.
 */
export class InvalidEditFromHereTargetError extends Error {
  constructor(reason: string) {
    super(`Cannot edit-from-here: ${reason}`);
    this.name = "InvalidEditFromHereTargetError";
  }
}

/**
 * Derives the `SessionForkPoint` this shortcut implies, without
 * constructing or forking any node. Split out from `editFromHere` so a
 * caller — e.g. a button's enabled/disabled state — can validate a
 * target before committing to the fork, the same shape as ompweb's
 * `canNavigate` check running ahead of `onNavigate`.
 */
export function resolveEditFromHereForkPoint(target: EditFromHereTarget): SessionForkPoint {
  if (target.previous === null) {
    throw new InvalidEditFromHereTargetError(
      "the message being edited has no predecessor to fork from (it is the first message in the session)",
    );
  }
  if (target.previous.index >= target.index) {
    throw new InvalidEditFromHereTargetError(
      `the preceding message (index ${target.previous.index}) does not come before the edited message (index ${target.index})`,
    );
  }
  if (target.previous.id === target.id) {
    throw new InvalidEditFromHereTargetError(
      "the preceding message has the same id as the message being edited",
    );
  }
  return { messageId: target.previous.id, index: target.previous.index };
}

/**
 * The one-step "edit from here" shortcut: forks `params.parent` at the
 * point just before `params.target`, and returns the new branch node
 * alongside the fork point and the edited message's original text.
 *
 * Delegates every bit of tree construction to `forkSession` — see the
 * module doc's "Composition, not duplication". Throws
 * `InvalidEditFromHereTargetError` (via `resolveEditFromHereForkPoint`)
 * without calling `forkSession` at all when the target has no valid fork
 * point, so an invalid edit-from-here attempt never reaches, and never
 * needs to be rejected by, the tree model itself.
 */
export function editFromHere(params: EditFromHereParams): EditFromHereResult {
  const forkPoint = resolveEditFromHereForkPoint(params.target);
  const forkParams: ForkSessionParams = {
    agentId: params.agentId,
    forkPoint,
    name: params.name,
    createdAt: params.createdAt,
  };
  const node = forkSession(params.parent, forkParams);
  return { node, forkPoint, draftText: params.target.text };
}
