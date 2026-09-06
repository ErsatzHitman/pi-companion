import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { SessionsClient } from "./sessions-client.js";
import type { SessionSummary } from "./types.js";
import { useCreateSession } from "./use-create-session.js";

const SESSION: SessionSummary = {
  id: "s-1",
  title: null,
  provider: "pi",
  cwd: "/repo/demo",
  status: "initializing",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("useCreateSession (T27B2)", () => {
  it("opens with a clean draft and closes on a successful create, clearing the fields", async () => {
    const createSession = vi.fn(async () => SESSION);
    const onCreated = vi.fn();
    const { result } = renderHook(() => useCreateSession({ client: { createSession }, onCreated }));

    act(() => result.current.openDialog());
    expect(result.current.open).toBe(true);

    act(() => result.current.setCwd("/repo/demo"));
    await act(async () => {
      await result.current.submit();
    });

    expect(createSession).toHaveBeenCalledWith({ provider: "pi", cwd: "/repo/demo" });
    expect(onCreated).toHaveBeenCalledWith(SESSION);
    expect(result.current.open).toBe(false);
    expect(result.current.cwd).toBe("");
  });

  it("ignores a second concurrent submit while the first is still in flight", async () => {
    let resolveCreate!: (session: SessionSummary) => void;
    const createSession = vi.fn(
      () =>
        new Promise<SessionSummary>((resolve) => {
          resolveCreate = resolve;
        }),
    );
    const client: SessionsClient = { createSession };
    const { result } = renderHook(() => useCreateSession({ client }));

    act(() => {
      result.current.openDialog();
      result.current.setCwd("/repo/demo");
    });

    let firstSubmit!: Promise<void>;
    act(() => {
      firstSubmit = result.current.submit();
    });
    await waitFor(() => expect(result.current.phase).toBe("submitting"));

    // A second submit while the first is in flight must not call the client again.
    await act(async () => {
      await result.current.submit();
    });
    expect(createSession).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveCreate(SESSION);
      await firstSubmit;
    });
    expect(result.current.open).toBe(false);
  });

  it("keeps the dialog open and the typed cwd intact after a failed create", async () => {
    const createSession = vi.fn(async () => {
      throw new Error("cwd is required");
    });
    const { result } = renderHook(() => useCreateSession({ client: { createSession } }));

    act(() => {
      result.current.openDialog();
      result.current.setCwd("/repo/typed");
    });
    await act(async () => {
      await result.current.submit();
    });

    expect(result.current.open).toBe(true);
    expect(result.current.cwd).toBe("/repo/typed");
    expect(result.current.phase).toBe("error");
    expect(result.current.errorMessage).toBe("cwd is required");
  });

  it("refuses to close while a submit is in flight", async () => {
    let resolveCreate!: (session: SessionSummary) => void;
    const createSession = vi.fn(
      () =>
        new Promise<SessionSummary>((resolve) => {
          resolveCreate = resolve;
        }),
    );
    const { result } = renderHook(() => useCreateSession({ client: { createSession } }));

    act(() => {
      result.current.openDialog();
      result.current.setCwd("/repo/demo");
    });
    let submitPromise!: Promise<void>;
    act(() => {
      submitPromise = result.current.submit();
    });
    await waitFor(() => expect(result.current.phase).toBe("submitting"));

    act(() => result.current.closeDialog());
    expect(result.current.open).toBe(true);

    await act(async () => {
      resolveCreate(SESSION);
      await submitPromise;
    });
  });

  it("rejects an empty draft locally without calling the client", async () => {
    const createSession = vi.fn();
    const { result } = renderHook(() => useCreateSession({ client: { createSession } }));

    act(() => result.current.openDialog());
    await act(async () => {
      await result.current.submit();
    });

    expect(createSession).not.toHaveBeenCalled();
    expect(result.current.errors.cwd).toMatch(/enter a working directory/i);
  });
});
