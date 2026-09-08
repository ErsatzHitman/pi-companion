/**
 * T132: resolves this route's `queueModeClient`/`turnStatusClient` props
 * for `Composer` (`../features/composer`) off `AppCore.connection`'s
 * active lifecycle — the exact "read `getActiveLifecycle()?.getDaemonClient()`
 * fresh, cast to the narrow port the feature actually needs, no adapter
 * class" convention this same file (`index.tsx`) already established for
 * `SessionApprovals`'s `client` prop (cast to `DaemonPermissionsSource`,
 * T32S7) and this directory's own `core.ts` already established for
 * its own `getTurnTransport`/`getSessionServiceClient` closures (see
 * either's doc comment): a real `DaemonClient` returned by production's
 * `getDaemonClient()` structurally satisfies `DaemonQueueModeSource` and
 * `DaemonTurnStatusSource` as-is — see `../features/composer/
 * queue-mode-model.ts` and `turn-status-model.ts`'s own module docs for
 * exactly why (T110's real `getQueueModes`/`setSteeringMode`/
 * `setFollowUpMode`, and the real `on("agent_stream", handler)` overload).
 *
 * **T282 adds `resolveTranscribeClient` below**, the identical pattern a
 * third time: `Composer.tsx`'s `transcribeClient` prop wants a
 * `VoiceTranscriptionClient` (`../features/voice`'s
 * `{ transcribeVoiceClip?(input): Promise<{ text, error }> }`), and the
 * real `DaemonClient.transcribeVoiceClip` (`packages/client/src/
 * daemon-client.ts`) matches that shape exactly — same method name, same
 * input fields (`audioBase64`/`format`/optional `language`), same
 * `{ text: string | null; error: string | null }` return — so the one
 * live `DaemonClient` instance this file already narrows twice above
 * satisfies this third port as-is too, with no adapter.
 *
 * **T284 adds `resolveAttachmentDownloadClient` below**, the same pattern
 * a fourth time: `use-attachment-image-resolver.ts`'s hook wants an
 * `AttachmentDownloadTokenClient` (`../features/transcript`'s
 * `{ requestAttachmentDownloadToken(agentId, path): Promise<{ token,
 * mimeType, error }> }`), and the real `DaemonClient.
 * requestAttachmentDownloadToken` (T283, `packages/client/src/
 * daemon-client.ts`) matches that shape exactly — so the one live
 * `DaemonClient` instance this file already narrows three times above
 * satisfies this fourth port as-is too, with no adapter.
 *

 * ## Why this is its own file, not inlined in `index.tsx` like
 * `SessionApprovals`'s cast
 *
 * `index.tsx` transitively imports `react-native` (via `Composer.tsx`,
 * `features/transcript`, etc.) — the RN-in-vitest limitation named in
 * every `-model.ts` file in this workspace (the RolldownError on
 * `node_modules/react-native/index.js:1:0`, proven 27+ times), so
 * nothing in `index.tsx` itself can be imported and called directly
 * under plain `vitest`; every existing proof about that file is
 * source-text only (`index.test.ts`'s `readCode()`/`readComponentCode()`).
 * Pulling this one resolve step into its own module — importing only
 * *types* from `features/composer` (erased at compile time, so this
 * file never touches `react-native` even transitively) — lets
 * `./session-route-daemon-clients.test.ts` prove the resolve step
 * itself with a real counting fake and real function calls, not a
 * regex: "whatever `getDaemonClient()` returns reaches the caller
 * unchanged" is a plain data-flow claim, not a rendering one.
 */
import type { DaemonQueueModeSource, DaemonTurnStatusSource } from "../features/composer";
import type { AttachmentDownloadTokenClient } from "../features/transcript";
import type { VoiceTranscriptionClient } from "../features/voice";

/**
 * The one shape this module needs off `AppCore.connection`
 * (`@picompanion/frontend-core`'s `DaemonConnectionStore`, via
 * `../features/connect/daemon-connection-store.ts`) —
 * narrowed exactly like this directory's own `core.ts`'s own local
 * `AgentStreamCapableClient` type, never importing the real
 * `DaemonConnectionStore` type itself (this module has no other reason
 * to depend on it). A real `DaemonConnectionStore` satisfies this
 * as-is: its own `getActiveLifecycle(): DaemonClientLifecycle | null`
 * returns an object whose `getDaemonClient(): DaemonClientLike | null`
 * is exactly this shape.
 */
export interface SessionRouteConnectionSource {
  getActiveLifecycle(): { getDaemonClient(): unknown } | null | undefined;
}

/**
 * Fresh read, same as every other narrow-port cast on this route —
 * never memoized across a connection change, so a reconnect (a new
 * live lifecycle) is reflected the next time `SessionRoute` re-renders,
 * exactly like `SessionApprovals`'s `client` above. `undefined` (never
 * `null`) when there is no active lifecycle or no live client yet,
 * matching `ComposerProps.queueModeClient`'s own `| undefined` shape —
 * `Composer` renders `QueueModePicker`'s truthful "Connect to a
 * daemon…" unavailable state in that case, never an enabled control
 * that can only fail.
 */
export function resolveQueueModeClient(
  connection: SessionRouteConnectionSource,
): DaemonQueueModeSource | undefined {
  return (
    (connection.getActiveLifecycle()?.getDaemonClient() as unknown as
      | DaemonQueueModeSource
      | null
      | undefined) ?? undefined
  );
}

/**
 * Same fresh-read contract as `resolveQueueModeClient` above, cast to
 * `DaemonTurnStatusSource` instead — both narrow the exact same live
 * `DaemonClient` instance to the one method each feature actually
 * calls, never two different client objects.
 */
export function resolveTurnStatusClient(
  connection: SessionRouteConnectionSource,
): DaemonTurnStatusSource | undefined {
  return (
    (connection.getActiveLifecycle()?.getDaemonClient() as unknown as
      | DaemonTurnStatusSource
      | null
      | undefined) ?? undefined
  );
}

/**
 * T282: same fresh-read contract as the two functions above, cast to
 * `VoiceTranscriptionClient` instead — the third narrow port this one
 * live `DaemonClient` instance satisfies. `undefined` (never `null`)
 * with no active lifecycle or no live client yet, matching
 * `ComposerProps.transcribeClient`'s own `| undefined` shape —
 * `Composer` resolves a captured `{ kind: "audio" }` clip to the
 * truthful `"transcription-unavailable"` outcome in that case (see
 * `Composer.tsx`'s `transcribeClient` doc comment), never a silent
 * no-op and never a permission taken with nothing to repay it.
 */
export function resolveTranscribeClient(
  connection: SessionRouteConnectionSource,
): VoiceTranscriptionClient | undefined {
  return (
    (connection.getActiveLifecycle()?.getDaemonClient() as unknown as
      | VoiceTranscriptionClient
      | null
      | undefined) ?? undefined
  );
}

/**
 * T284: same fresh-read contract as the three functions above, cast to
 * `AttachmentDownloadTokenClient` instead — the fourth narrow port this
 * one live `DaemonClient` instance satisfies (T283's real
 * `requestAttachmentDownloadToken(agentId, path)`, see that method's own
 * doc comment in `packages/client/src/daemon-client.ts`). `undefined`
 * (never `null`) with no active lifecycle or no live client yet,
 * matching every sibling resolver above — `use-attachment-image-
 * resolver.ts`'s hook then resolves every image to `undefined` (the
 * accessible reference card) rather than attempting a token request with
 * nothing to send it to.
 */
export function resolveAttachmentDownloadClient(
  connection: SessionRouteConnectionSource,
): AttachmentDownloadTokenClient | undefined {
  return (
    (connection.getActiveLifecycle()?.getDaemonClient() as unknown as
      | AttachmentDownloadTokenClient
      | null
      | undefined) ?? undefined
  );
}
