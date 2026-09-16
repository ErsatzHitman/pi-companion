import { describe, expect, it, vi } from "vitest";

import {
  buildDevicesHref,
  buildDiagnosticsHref,
  buildExtensionHref,
  pressOpenDevices,
  pressOpenDiagnostics,
  pressOpenExtension,
  type SettingsNavRouter,
} from "./settings-navigation-model.js";

/**
 * T301 real behavioural coverage — RN-free, unlike the `.tsx` view
 * (`SettingsScreen.tsx`) and route (`app/h/[serverId]/(tabs)/
 * settings.tsx`) this module feeds. A fake router stands in for the
 * mounted settings screen's own `useRouter()`, never a deep link
 * constructed by the test.
 */
describe("pressOpenDevices", () => {
  it("navigates the router to this host's devices route", () => {
    const router: SettingsNavRouter = { push: vi.fn() };
    pressOpenDevices(router, "srv_1");
    expect(router.push).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledWith(buildDevicesHref("srv_1"));
    expect(router.push).toHaveBeenCalledWith("/h/srv_1/devices");
  });

  it("percent-encodes serverId the same way frontend-core's own path builder does", () => {
    const router: SettingsNavRouter = { push: vi.fn() };
    pressOpenDevices(router, "srv one/two");
    expect(router.push).toHaveBeenCalledWith(`/h/${encodeURIComponent("srv one/two")}/devices`);
  });
});

describe("pressOpenDiagnostics", () => {
  it("navigates the router to this host's diagnostics route", () => {
    const router: SettingsNavRouter = { push: vi.fn() };
    pressOpenDiagnostics(router, "srv_1");
    expect(router.push).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledWith(buildDiagnosticsHref("srv_1"));
    expect(router.push).toHaveBeenCalledWith("/h/srv_1/diagnostics");
  });

  it("percent-encodes serverId the same way frontend-core's own path builder does", () => {
    const router: SettingsNavRouter = { push: vi.fn() };
    pressOpenDiagnostics(router, "srv one/two");
    expect(router.push).toHaveBeenCalledWith(`/h/${encodeURIComponent("srv one/two")}/diagnostics`);
  });
});

describe("pressOpenExtension", () => {
  it("navigates the router to this host's extension detail route", () => {
    const router: SettingsNavRouter = { push: vi.fn() };
    pressOpenExtension(router, "srv_1", "todo");
    expect(router.push).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledWith(buildExtensionHref("srv_1", "todo"));
    expect(router.push).toHaveBeenCalledWith("/h/srv_1/extensions/todo");
  });

  it("percent-encodes both serverId and name the same way frontend-core's own path builder does", () => {
    const router: SettingsNavRouter = { push: vi.fn() };
    pressOpenExtension(router, "srv one/two", "pi-herdr-delegate");
    expect(router.push).toHaveBeenCalledWith(
      `/h/${encodeURIComponent("srv one/two")}/extensions/pi-herdr-delegate`,
    );
  });
});

describe("buildDevicesHref / buildDiagnosticsHref / buildExtensionHref", () => {
  it("never produce the same path for the same serverId", () => {
    expect(buildDevicesHref("srv_1")).not.toBe(buildDiagnosticsHref("srv_1"));
    expect(buildDevicesHref("srv_1")).not.toBe(buildExtensionHref("srv_1", "todo"));
    expect(buildDiagnosticsHref("srv_1")).not.toBe(buildExtensionHref("srv_1", "todo"));
  });
});
