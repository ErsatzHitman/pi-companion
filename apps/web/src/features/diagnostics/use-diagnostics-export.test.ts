import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { DiagnosticsSection } from "./diagnostics-model.js";
import { useDiagnosticsExport } from "./use-diagnostics-export.js";

const SAFE_SECTIONS: DiagnosticsSection[] = [
  {
    id: "connection",
    title: "Connection",
    fields: [{ id: "status", label: "Connection status", value: "idle" }],
  },
];

const META = { appVersion: "0.3.0-beta.2", clientId: "picompanion-web" };

describe("useDiagnosticsExport", () => {
  it("calls saveBlob with redacted, well-formed JSON bytes and reports success", () => {
    const saveBlob = vi.fn();
    const { result } = renderHook(() =>
      useDiagnosticsExport({
        sections: SAFE_SECTIONS,
        meta: META,
        now: () => "2026-09-05T00:00:00.000Z",
        saveBlob,
      }),
    );

    act(() => result.current.exportNow());

    expect(result.current.state).toEqual({ status: "success", error: null });
    expect(saveBlob).toHaveBeenCalledTimes(1);
    const [bytes, fileName, mimeType] = saveBlob.mock.calls[0]!;
    expect(fileName).toBe("pi-companion-diagnostics-20260905000000000.json");
    expect(mimeType).toBe("application/json");
    const json = JSON.parse(new TextDecoder().decode(bytes as Uint8Array));
    expect(json.kind).toBe("picompanion-diagnostics-export");
    expect(json.sections[0].fields[0].value).toBe("idle");
  });

  it("surfaces a redaction refusal as a visible error and never calls saveBlob", () => {
    const secretCarryingSections: DiagnosticsSection[] = [
      {
        id: "connection",
        title: "Connection",
        fields: [{ id: "profile", label: "Host profile", value: "bob:s3cr3t@evil.example" }],
      },
    ];
    const saveBlob = vi.fn();
    const { result } = renderHook(() =>
      useDiagnosticsExport({
        sections: secretCarryingSections,
        meta: META,
        now: () => "2026-09-05T00:00:00.000Z",
        saveBlob,
      }),
    );

    act(() => result.current.exportNow());

    expect(result.current.state.status).toBe("error");
    expect(result.current.state.error).toContain("connection/profile");
    expect(saveBlob).not.toHaveBeenCalled();
  });

  it("surfaces a saveBlob failure as a visible error too, rather than a silent no-op", () => {
    const saveBlob = vi.fn(() => {
      throw new Error("no writable download directory");
    });
    const { result } = renderHook(() =>
      useDiagnosticsExport({
        sections: SAFE_SECTIONS,
        meta: META,
        now: () => "2026-09-05T00:00:00.000Z",
        saveBlob,
      }),
    );

    act(() => result.current.exportNow());

    expect(result.current.state).toEqual({
      status: "error",
      error: "no writable download directory",
    });
  });
});
