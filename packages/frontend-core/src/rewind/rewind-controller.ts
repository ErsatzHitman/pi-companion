/**
 * Rewind/checkpoint controller — `plan.md` §4.2 ("Workspace checkpoint
 * snapshots"), T395.
 *
 * The daemon can snapshot a workspace per turn and restore it, refusing a
 * restore that would discard a change the checkpoint system did not take
 * unless the request carries `force: true` (plan.md §4.2, "A conflict
 * refuses unless `force` is set"). This module is the platform-neutral
 * half both apps share: it drives that rewind through a client-like port
 * and collapses every outcome into one typed result a screen can render.
 *
 * ## Why the outcome is typed here, and the conflict is a code
 *
 * `agent.rewind.response.payload` carries only `ok` and a human-readable
 * `error` string. A screen must distinguish three failures it renders (and
 * answers) differently: a refused restore (offer `force: true`), a mode
 * the provider cannot rewind, and a generic daemon failure. Matching the
 * wording of the daemon's sentence in a screen would make the answer
 * depend on prose a later edit can reword, so the classification lives
 * here, once, and reads the documented markers the daemon stamps onto the
 * `error` string (`@picompanion/protocol/rewind-errors`, plan.md §4.2).
 * The screen sees `status`, never the marker.
 *
 * `RewindController` is stateless beyond the port it holds; it performs no
 * I/O of its own and holds no agent state, so it is trivially reusable by
 * a web route and an Android screen and testable against a fake port.
 *
 * Repository invariant: this module must never import React, React
 * Native, Expo, DOM types, or browser globals.
 */
import type { AgentRewindMode } from "@picompanion/protocol/messages";
import {
  parseRewindFailureCode,
  stripRewindFailureMarker,
} from "@picompanion/protocol/rewind-errors";

/** The rewind modes `agent.rewind.request` accepts (plan.md §4.2). */
export type RewindMode = AgentRewindMode;

/**
 * The slice of `@picompanion/client`'s `DaemonClient` this controller
 * needs. The real `DaemonClient` satisfies it as-is, and tests inject a
 * fake. `force` is sent only when the caller supplied one, so a request
 * that omits it keeps the exact wire frame a three-argument
 * `DaemonClient.rewindAgent` call always sent.
 */
export interface RewindClientPort {
  rewindAgent(
    agentId: string,
    messageId: string,
    mode: RewindMode,
    options?: { force?: boolean },
  ): Promise<unknown>;
}

export interface RewindRequest {
  agentId: string;
  messageId: string;
  mode: RewindMode;
  /**
   * `true` overrides a checkpoint conflict; `false`/omitted leaves the
   * daemon's own refusal in place. Omitted and `false` both reach the port
   * as a request that does not force, but only the omitted case leaves the
   * `force` key off the wire.
   */
  force?: boolean;
}

/**
 * What a screen renders.
 *
 * - `success` — the rewind applied.
 * - `unsupported` — this provider/host cannot rewind that mode.
 * - `conflict` — the restore was refused because the work tree moved; the
 *   caller can retry with `force: true`.
 * - `failed` — anything else, carrying the daemon's own sentence.
 *
 * `conflict` and `unsupported` carry the daemon's human sentence with its
 * wire marker stripped, so a screen may display `message` directly.
 */
export type RewindOutcome =
  | { readonly status: "success" }
  | { readonly status: "unsupported"; readonly message: string }
  | { readonly status: "conflict"; readonly message: string }
  | { readonly status: "failed"; readonly message: string };

export class RewindController {
  private readonly client: RewindClientPort;

  constructor(client: RewindClientPort) {
    this.client = client;
  }

  /** Performs one rewind and maps its outcome, never throwing for a daemon refusal. */
  async rewind(request: RewindRequest): Promise<RewindOutcome> {
    try {
      await this.client.rewindAgent(
        request.agentId,
        request.messageId,
        request.mode,
        request.force === undefined ? undefined : { force: request.force },
      );
      return { status: "success" };
    } catch (error) {
      const message = rewindErrorMessage(error);
      switch (parseRewindFailureCode(message)) {
        case "conflict":
          return { status: "conflict", message: stripRewindFailureMarker(message) };
        case "unsupported":
          return { status: "unsupported", message: stripRewindFailureMarker(message) };
        default:
          return { status: "failed", message };
      }
    }
  }
}

/** The daemon's sentence when the port rejected with an `Error`, else a stable fallback. */
function rewindErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string" && error.length > 0) {
    return error;
  }
  return "Failed to rewind agent";
}
