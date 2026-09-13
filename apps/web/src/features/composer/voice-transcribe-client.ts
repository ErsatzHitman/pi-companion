/**
 * Web voice-transcription client resolver (T277 close, web equivalent of
 * Android's T282 `resolveTranscribeClient`).
 *
 * `plan.md` §9.4's disclosed gap names the close call:
 * `client.transcribeVoiceClip.bind(client)`, using the same
 * connection-derived `DaemonClient` the route layer already threads
 * through. Android closed it in
 * `apps/android/src/app-shell/session-route-daemon-clients.ts` with a
 * fresh-read-and-cast off `AppCore.connection.getActiveLifecycle()?.
 * getDaemonClient()`; web has no `AppCore` — the equivalent live client
 * is `useDaemonClientContext()`'s `DaemonClient | null`
 * (`apps/web/src/app/daemon-client-context.tsx`), already backed by the
 * same `HostController` lifecycle. This module narrows that client to the
 * one method voice needs, with no adapter class: a real `DaemonClient`
 * (`packages/client/src/daemon-client.ts`'s `transcribeVoiceClip`) already
 * satisfies `VoiceTranscriptionClient` as-is.
 *
 * `undefined` (never `null`) with no live client yet, matching every
 * sibling optional-client seam in this app (`editorTextClient`,
 * `fileReferenceSource`, `editFromHereClient`) — a caller with no client
 * resolves the honest `"transcription-unavailable"` outcome rather than a
 * fake transcript or a silent no-op.
 */

export interface VoiceTranscriptionInput {
  audioBase64: string;
  format: string;
  language?: string;
}

export interface VoiceTranscriptionResult {
  text: string | null;
  error: string | null;
}

export interface VoiceTranscriptionClient {
  transcribeVoiceClip(input: VoiceTranscriptionInput): Promise<VoiceTranscriptionResult>;
}

interface TranscribeCapableClient {
  transcribeVoiceClip?: unknown;
}

function hasTranscribeVoiceClip(client: unknown): client is VoiceTranscriptionClient {
  return !!client && typeof (client as TranscribeCapableClient).transcribeVoiceClip === "function";
}

/**
 * Narrows a live `DaemonClient | null` to the voice port web's composer
 * needs. Fresh read — call on every render, never memoize across a
 * connection change, so a reconnect is reflected the next time the route
 * re-renders, exactly like `host-session-screen.tsx`'s own
 * `adaptEditFromHereForkClient` memo.
 */
export function resolveTranscribeClient(client: unknown): VoiceTranscriptionClient | undefined {
  if (!hasTranscribeVoiceClip(client)) return undefined;
  return client;
}
