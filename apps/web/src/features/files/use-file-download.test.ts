import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { FileDownloadClient, FileDownloadTokenResult } from "./file-download-client.js";
import type { MinimalFetch, MinimalFetchResponse } from "./use-file-download.js";
import { useFileDownload } from "./use-file-download.js";

function tokenResult(overrides: Partial<FileDownloadTokenResult> = {}): FileDownloadTokenResult {
  return {
    cwd: "/workspace",
    path: "README.md",
    token: "tok_1",
    fileName: "README.md",
    mimeType: "text/markdown",
    size: 10,
    error: null,
    ...overrides,
  };
}

/** A fetch stub that streams `chunks` one `read()` at a time. The mock is kept separate from the `MinimalFetch`-typed function passed to the hook so assertions (`toHaveBeenCalledWith`) still work without fighting `vi.fn`'s constructable-signature typing. */
function fetchStreaming(
  chunks: Uint8Array[],
  status = 200,
): { fetchImpl: MinimalFetch; mock: ReturnType<typeof vi.fn> } {
  const mock = vi.fn(async (_url: string): Promise<MinimalFetchResponse> => {
    let index = 0;
    return {
      ok: status >= 200 && status < 300,
      status,
      body: {
        getReader: () => ({
          read: async () => {
            if (index >= chunks.length) return { done: true };
            const value = chunks[index];
            index += 1;
            return { done: false, value };
          },
        }),
      },
    };
  });
  const fetchImpl: MinimalFetch = (url: string) => mock(url) as Promise<MinimalFetchResponse>;
  return { fetchImpl, mock };
}

/** A promise plus its externally-callable settle functions, for pausing an async chain mid-flight in a test. */
function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/**
 * A fetch stub whose reader is driven by hand, one `read()` at a time —
 * for tests that need to observe (or interrupt) a download mid-stream.
 * Captures the `signal` `use-file-download.ts` passes so a test can
 * assert cancel()'s abort actually reached `fetchImpl`, and exposes a
 * `readerCancel` spy so a test can assert the reader itself was released.
 */
function fetchControllable(): {
  fetchImpl: MinimalFetch;
  push: (chunk: Uint8Array) => void;
  finish: () => void;
  readerCancel: ReturnType<typeof vi.fn>;
  signal: () => AbortSignal | undefined;
} {
  const readerCancel = vi.fn();
  let resolveNextRead: ((value: { done: boolean; value?: Uint8Array }) => void) | null = null;
  const pending: { done: boolean; value?: Uint8Array }[] = [];
  let capturedSignal: AbortSignal | undefined;

  function deliver(item: { done: boolean; value?: Uint8Array }): void {
    if (resolveNextRead) {
      const resolve = resolveNextRead;
      resolveNextRead = null;
      resolve(item);
    } else {
      pending.push(item);
    }
  }

  const fetchImpl: MinimalFetch = async (_url, init) => {
    capturedSignal = init?.signal;
    return {
      ok: true,
      status: 200,
      body: {
        getReader: () => ({
          read: () =>
            new Promise((resolve) => {
              const next = pending.shift();
              if (next) {
                resolve(next);
              } else {
                resolveNextRead = resolve;
              }
            }),
          cancel: readerCancel,
        }),
      },
    };
  };

  return {
    fetchImpl,
    push: (chunk) => deliver({ done: false, value: chunk }),
    finish: () => deliver({ done: true }),
    readerCancel,
    signal: () => capturedSignal,
  };
}

describe("useFileDownload (T30B4)", () => {
  it("starts idle", () => {
    const { result } = renderHook(() =>
      useFileDownload({
        client: { requestDownloadToken: vi.fn() },
        downloadOrigin: "http://127.0.0.1:6768",
      }),
    );
    expect(result.current.state).toEqual({
      status: "idle",
      path: null,
      fileName: null,
      progress: null,
      error: null,
    });
  });

  it("requests a token, fetches the bytes with real proportional progress, and saves the result", async () => {
    const client: FileDownloadClient = {
      requestDownloadToken: vi.fn(async () => tokenResult({ size: 10 })),
    };
    const saveBlob = vi.fn();
    const chunkA = new Uint8Array([1, 2, 3, 4, 5]);
    const chunkB = new Uint8Array([6, 7, 8, 9, 10]);
    const { fetchImpl, mock: fetchMock } = fetchStreaming([chunkA, chunkB]);

    const { result } = renderHook(() =>
      useFileDownload({ client, downloadOrigin: "http://127.0.0.1:6768", fetchImpl, saveBlob }),
    );

    act(() => result.current.download("/workspace", "README.md", "README.md"));

    await waitFor(() => expect(result.current.state.status).toBe("success"));
    expect(result.current.state.progress).toBe(1);
    expect(client.requestDownloadToken).toHaveBeenCalledWith("/workspace", "README.md");
    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:6768/api/files/download?token=tok_1");
    expect(saveBlob).toHaveBeenCalledTimes(1);
    const [savedBytes, savedName, savedMime] = saveBlob.mock.calls[0] as [
      Uint8Array,
      string,
      string,
    ];
    expect(Array.from(savedBytes)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(savedName).toBe("README.md");
    expect(savedMime).toBe("text/markdown");
  });

  it("keeps the selected path and explains a no-token server response", async () => {
    const client: FileDownloadClient = {
      requestDownloadToken: vi.fn(async () =>
        tokenResult({ token: null, error: "ENOENT: no such file or directory" }),
      ),
    };
    const { result } = renderHook(() =>
      useFileDownload({ client, downloadOrigin: "http://127.0.0.1:6768" }),
    );

    act(() => result.current.download("/workspace", "gone.txt", "gone.txt"));

    await waitFor(() => expect(result.current.state.status).toBe("error"));
    expect(result.current.state.path).toBe("gone.txt");
    expect(result.current.state.error?.title).toMatch(/no longer exists/i);
  });

  it("explains a transport-level token-request rejection without losing the path", async () => {
    const client: FileDownloadClient = {
      requestDownloadToken: vi.fn(async () => {
        throw new Error("socket hang up");
      }),
    };
    const { result } = renderHook(() =>
      useFileDownload({ client, downloadOrigin: "http://127.0.0.1:6768" }),
    );

    act(() => result.current.download("/workspace", "README.md", "README.md"));

    await waitFor(() => expect(result.current.state.status).toBe("error"));
    expect(result.current.state.path).toBe("README.md");
    expect(result.current.state.error?.description).toBe("socket hang up");
  });

  it("explains a missing download origin as a distinct, actionable error", async () => {
    const client: FileDownloadClient = {
      requestDownloadToken: vi.fn(async () => tokenResult()),
    };
    const { result } = renderHook(() => useFileDownload({ client, downloadOrigin: null }));

    act(() => result.current.download("/workspace", "README.md", "README.md"));

    await waitFor(() => expect(result.current.state.status).toBe("error"));
    expect(result.current.state.error?.title).toMatch(/aren't available yet/i);
  });

  it("explains a non-ok HTTP response while fetching the token URL", async () => {
    const client: FileDownloadClient = {
      requestDownloadToken: vi.fn(async () => tokenResult()),
    };
    const { fetchImpl } = fetchStreaming([], 403);
    const { result } = renderHook(() =>
      useFileDownload({
        client,
        downloadOrigin: "http://127.0.0.1:6768",
        fetchImpl,
        saveBlob: vi.fn(),
      }),
    );

    act(() => result.current.download("/workspace", "README.md", "README.md"));

    await waitFor(() => expect(result.current.state.status).toBe("error"));
    expect(result.current.state.error?.description).toMatch(/403/);
  });

  it("retry re-requests a token and re-fetches the same path without a new selection", async () => {
    let attempt = 0;
    const client: FileDownloadClient = {
      requestDownloadToken: vi.fn(async () => {
        attempt += 1;
        if (attempt === 1) return tokenResult({ token: null, error: "socket hang up" });
        return tokenResult();
      }),
    };
    const saveBlob = vi.fn();
    const { fetchImpl } = fetchStreaming([new Uint8Array([1, 2, 3])]);
    const { result } = renderHook(() =>
      useFileDownload({ client, downloadOrigin: "http://127.0.0.1:6768", fetchImpl, saveBlob }),
    );

    act(() => result.current.download("/workspace", "README.md", "README.md"));
    await waitFor(() => expect(result.current.state.status).toBe("error"));

    act(() => result.current.retry());
    await waitFor(() => expect(result.current.state.status).toBe("success"));

    expect(client.requestDownloadToken).toHaveBeenCalledTimes(2);
    expect(client.requestDownloadToken).toHaveBeenNthCalledWith(2, "/workspace", "README.md");
  });

  // T144: deliberately redundant with `path-authorization.test.ts`'s own
  // "every file-access entry point" coverage — this suite's job is to fail
  // HERE, in this file's own `npx vitest run`, if `useFileDownload` ever
  // stops calling `authorizeWorkspacePath` before `requestDownloadToken`,
  // without relying on the sibling suite to notice. Do not delete as
  // "already tested elsewhere".
  it("T144: denies an escaping path and never calls requestDownloadToken", async () => {
    const requestDownloadToken = vi.fn(async (): Promise<FileDownloadTokenResult> => tokenResult());
    const client: FileDownloadClient = { requestDownloadToken };
    const { result } = renderHook(() =>
      useFileDownload({ client, downloadOrigin: "http://127.0.0.1:6768" }),
    );

    act(() => result.current.download("/workspace", "~/.ssh/id_rsa", "id_rsa"));

    await waitFor(() => expect(result.current.state.status).toBe("error"));
    expect(result.current.state.error?.description).toContain(
      "outside the folders the daemon shares",
    );
    expect(requestDownloadToken).not.toHaveBeenCalled();
  });

  describe("cancellation (T41A3)", () => {
    it("cancel() during the token request stops before any fetch, and a late token cannot resurrect it", async () => {
      const token = deferred<FileDownloadTokenResult>();
      const requestDownloadToken = vi.fn(() => token.promise);
      const fetchImpl = vi.fn(async (): Promise<MinimalFetchResponse> => {
        throw new Error("fetchImpl must never be called once cancelled during the token request");
      });
      const { result } = renderHook(() =>
        useFileDownload({
          client: { requestDownloadToken },
          downloadOrigin: "http://127.0.0.1:6768",
          fetchImpl,
        }),
      );

      act(() => result.current.download("/workspace", "README.md", "README.md"));
      expect(result.current.state.status).toBe("requesting-token");

      act(() => result.current.cancel());
      expect(result.current.state.status).toBe("cancelled");

      await act(async () => {
        token.resolve(tokenResult());
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(result.current.state.status).toBe("cancelled");
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it("cancel() mid-download aborts the fetch signal, releases the reader, stops applying progress, and never saves — decisive: no partial file", async () => {
      const client: FileDownloadClient = {
        requestDownloadToken: vi.fn(async () => tokenResult({ size: 20 })),
      };
      const saveBlob = vi.fn();
      const { fetchImpl, push, finish, readerCancel, signal } = fetchControllable();

      const { result } = renderHook(() =>
        useFileDownload({ client, downloadOrigin: "http://127.0.0.1:6768", fetchImpl, saveBlob }),
      );

      act(() => result.current.download("/workspace", "README.md", "README.md"));
      await waitFor(() => expect(result.current.state.status).toBe("downloading"));

      await act(async () => {
        push(new Uint8Array([1, 2, 3, 4, 5]));
        await Promise.resolve();
        await Promise.resolve();
      });
      await waitFor(() => expect(result.current.state.progress).toBe(0.25));

      act(() => result.current.cancel());

      expect(result.current.state.status).toBe("cancelled");
      // The effect, not just the state: the abort signal genuinely reached fetchImpl.
      expect(signal()?.aborted).toBe(true);
      expect(readerCancel).toHaveBeenCalledTimes(1);

      // The stream finishes anyway (as a real network stream might, racing
      // the abort) — this must not apply another progress update or save.
      await act(async () => {
        push(new Uint8Array([6, 7, 8, 9, 10]));
        finish();
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(result.current.state.status).toBe("cancelled");
      expect(result.current.state.progress).toBeNull();
      expect(saveBlob).not.toHaveBeenCalled();
    });

    it("cancel() is a no-op while idle", () => {
      const { result } = renderHook(() =>
        useFileDownload({
          client: { requestDownloadToken: vi.fn() },
          downloadOrigin: "http://127.0.0.1:6768",
        }),
      );

      act(() => result.current.cancel());

      expect(result.current.state.status).toBe("idle");
    });

    it("cancel() after a completed download does not disturb the success state", async () => {
      const client: FileDownloadClient = {
        requestDownloadToken: vi.fn(async () => tokenResult({ size: 5 })),
      };
      const saveBlob = vi.fn();
      const { fetchImpl } = fetchStreaming([new Uint8Array([1, 2, 3, 4, 5])]);
      const { result } = renderHook(() =>
        useFileDownload({ client, downloadOrigin: "http://127.0.0.1:6768", fetchImpl, saveBlob }),
      );

      act(() => result.current.download("/workspace", "README.md", "README.md"));
      await waitFor(() => expect(result.current.state.status).toBe("success"));

      act(() => result.current.cancel());

      expect(result.current.state.status).toBe("success");
    });

    it("unmounting mid-download aborts the fetch and releases the reader instead of leaving it dangling", async () => {
      const client: FileDownloadClient = {
        requestDownloadToken: vi.fn(async () => tokenResult({ size: 20 })),
      };
      const { fetchImpl, push, readerCancel, signal } = fetchControllable();
      const { result, unmount } = renderHook(() =>
        useFileDownload({
          client,
          downloadOrigin: "http://127.0.0.1:6768",
          fetchImpl,
          saveBlob: vi.fn(),
        }),
      );

      act(() => result.current.download("/workspace", "README.md", "README.md"));
      await waitFor(() => expect(result.current.state.status).toBe("downloading"));

      unmount();

      expect(signal()?.aborted).toBe(true);
      expect(readerCancel).toHaveBeenCalledTimes(1);

      // A chunk delivered after unmount must not throw (no dangling reader driving a dead tree).
      expect(() => push(new Uint8Array([1]))).not.toThrow();
    });
  });
});
