import type { DownloadFetch, DownloadFetchResponse } from "../features/files/index.js";

/**
 * Real (not fake) `DownloadFetch` for Android — T32S14, the route-level
 * `fetchImpl` seam `[...path].tsx`'s own doc comment named as still
 * unwired: "This route still passes no `fetchImpl`/`filePicker`/
 * `sharing`." `file-download-model.ts`'s `FileDownloadControllerOptions
 * .fetchImpl` doc comment is explicit that this has no default — "a
 * caller with no real transport wired yet must pass one that always
 * rejects, not omit this" — so omitting it entirely, as the route did
 * before this task, is not a safe default; it is why `files-screen.tsx`'s
 * `DownloadPanel` was omitted outright (`useMemo`'s `!fetchImpl` guard)
 * rather than rendered broken. This module is what makes that `useMemo`
 * stop short-circuiting: `createFetchDownload()`'s result is never
 * `undefined`.
 *
 * ## Why this needs a wrapper at all, not a bare `fetch` reference
 *
 * `apps/web/src/features/files/use-file-download.ts` passes `(url) =>
 * fetch(url)` directly, because DOM's `Response.body` is a real
 * `ReadableStream<Uint8Array>` whose reader structurally satisfies
 * `DownloadStreamReader`. React Native's own `fetch`/`Response` type
 * declarations (`react-native/src/types/globals.d.ts`'s `Body`
 * interface) declare no `body` field at all — only the whole-response
 * consumers (`arrayBuffer()`/`blob()`/`json()`/`text()`/`formData()`).
 * Whether Hermes' `fetch` polyfill exposes a *runtime* `body` getter
 * anyway (React Native's fetch is a `whatwg-fetch`-derived polyfill,
 * and recent RN versions do wire streaming support behind an opt-in) is
 * exactly the kind of claim this workspace's `vitest` setup cannot
 * verify — there is no real device or Hermes runtime under test here.
 * This function makes the honest, testable choice: read `response.body`
 * defensively (present or not, structurally checked, never assumed),
 * and normalize its absence to `body: null` — the exact shape
 * `file-download-model.ts`'s own `run()` already handles as
 * `FILE_DOWNLOAD_TRANSFER_FAILED` (see that module's `"the stream
 * closed with no readable body"` case), not a crash or a silent hang.
 *
 * **Disclosed, unverified on this task**: whether a real Android device
 * ever produces a non-`null` `response.body` (i.e., whether streaming
 * downloads work at all on this RN version) is not proven by anything
 * in this repository's test suite — proving it needs an on-device or
 * emulator run (T37/T59's territory), which this task does not attempt.
 * If it turns out RN's `fetch` never exposes a streaming body, every
 * download on Android would honestly refuse with
 * `FILE_DOWNLOAD_TRANSFER_FAILED` rather than silently doing nothing —
 * the same "real logic, real adapter, currently unable to do anything on
 * a live device" shape `AppCore.notifications`/`AppCore.offlineCache`
 * already establish elsewhere in this app, not a new kind of gap.
 */

/** Structural slice of RN's `fetch` `Response` this module reads, narrower than RN's own `Body`/`Response` type declarations (which omit `body` entirely — see this module's doc comment) but wide enough to describe what a real fetch response actually carries at runtime. */
interface FetchLikeResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly body?: unknown;
}

/** True only when `value` is an object exposing a callable `getReader` — the one structural fact `DownloadFetchResponse.body` requires. Never assumes `value` has any particular shape beyond that. */
function hasGetReader(value: unknown): value is { getReader(): unknown } {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { getReader?: unknown }).getReader === "function"
  );
}

/**
 * Wraps a real `fetch`-shaped function (defaults to the ambient global
 * `fetch`; injectable for tests, mirroring
 * `network-reachability.ts`'s `createDefaultAndroidProbe`) into the
 * `DownloadFetch` shape `file-download-model.ts`'s
 * `FileDownloadController` requires. Never throws synchronously; a
 * rejected/thrown underlying `fetch` call propagates as a rejected
 * promise, which `file-download-model.ts`'s `run()` already catches and
 * classifies as `FILE_DOWNLOAD_TRANSFER_FAILED`.
 */
export function createFetchDownload(
  rawFetch: (url: string) => Promise<FetchLikeResponse> = (url) => fetch(url),
): DownloadFetch {
  return async (url: string): Promise<DownloadFetchResponse> => {
    const response = await rawFetch(url);
    const body: DownloadFetchResponse["body"] = hasGetReader(response.body)
      ? (response.body as NonNullable<DownloadFetchResponse["body"]>)
      : null;
    return {
      ok: response.ok,
      status: response.status,
      body,
    };
  };
}
