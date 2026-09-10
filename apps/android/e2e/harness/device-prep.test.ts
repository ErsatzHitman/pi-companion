import { describe, expect, it } from "vitest";

import {
  ERROR_DIALOG_BUTTON_IDS,
  MAX_DIALOG_DISMISSALS,
  UI_DUMP_DEVICE_PATH,
  findErrorDialogDismissal,
  prepareDevice,
  type DeviceCommands,
} from "./device-prep.js";

/**
 * T329. The fixtures below are in `uiautomator dump`'s own format — one
 * self-closing `<node .../>` per accessibility node, attributes in the
 * order the tool writes them — with the exact button ids and bounds the
 * Android framework's ANR dialog produced on run 34444464068's
 * `packaged-app-smoke` (hierarchy: "Quickstep isn't responding", "Close
 * app", "Wait").
 */
const node = (attributes: Record<string, string>): string =>
  `<node ${Object.entries(attributes)
    .map(([key, value]) => `${key}="${value}"`)
    .join(" ")} />`;

const ANR_DIALOG = [
  '<?xml version="1.0" encoding="UTF-8"?><hierarchy rotation="0">',
  node({
    index: "0",
    text: "",
    "resource-id": "android:id/parentPanel",
    class: "android.widget.LinearLayout",
    package: "android",
    bounds: "[63,1090][1017,1500]",
  }),
  node({
    index: "0",
    text: "Quickstep isn't responding",
    "resource-id": "android:id/alertTitle",
    class: "android.widget.TextView",
    package: "android",
    bounds: "[126,1150][954,1210]",
  }),
  node({
    index: "1",
    text: "Close app",
    "resource-id": "android:id/aerr_close",
    class: "android.widget.Button",
    package: "android",
    clickable: "true",
    bounds: "[63,1290][540,1416]",
  }),
  node({
    index: "2",
    text: "Wait",
    "resource-id": "android:id/aerr_wait",
    class: "android.widget.Button",
    package: "android",
    clickable: "true",
    bounds: "[540,1290][1017,1416]",
  }),
  "</hierarchy>",
].join("");

const APP_SCREEN = [
  '<?xml version="1.0" encoding="UTF-8"?><hierarchy rotation="0">',
  node({
    index: "0",
    text: "Welcome to Pi Companion",
    "resource-id": "",
    class: "android.widget.TextView",
    package: "sh.picompanion",
    bounds: "[63,200][1017,260]",
  }),
  node({
    index: "1",
    text: "",
    "resource-id": "connect-onboarding-welcome-continue",
    class: "android.widget.Button",
    package: "sh.picompanion",
    bounds: "[108,900][972,1026]",
  }),
  "</hierarchy>",
].join("");

describe("findErrorDialogDismissal", () => {
  it("prefers Close app over Wait and taps the centre of its bounds", () => {
    expect(findErrorDialogDismissal(ANR_DIALOG)).toEqual({
      resourceId: "android:id/aerr_close",
      x: 301,
      y: 1353,
    });
  });

  it("falls back to Wait when only that button is present", () => {
    const waitOnly = ANR_DIALOG.replace(/<node [^>]*aerr_close[^>]*\/>/, "");
    expect(findErrorDialogDismissal(waitOnly)).toEqual({
      resourceId: "android:id/aerr_wait",
      x: 778,
      y: 1353,
    });
  });

  it("returns null for an ordinary app screen", () => {
    expect(findErrorDialogDismissal(APP_SCREEN)).toBeNull();
  });

  it("returns null for an empty or non-XML dump (a failed uiautomator run)", () => {
    expect(findErrorDialogDismissal("")).toBeNull();
    expect(findErrorDialogDismissal("ERROR: could not get idle state.")).toBeNull();
  });

  it("ignores a button whose bounds are malformed or empty rather than tapping (0, 0)", () => {
    const malformed = ANR_DIALOG.replace(
      'bounds="[63,1290][540,1416]"',
      'bounds="garbage"',
    ).replace('bounds="[540,1290][1017,1416]"', 'bounds="[540,1290][540,1290]"');
    expect(findErrorDialogDismissal(malformed)).toBeNull();
  });

  it("does not match the id as a substring of some other id", () => {
    const lookalike = APP_SCREEN.replace(
      '"resource-id": ""',
      '"resource-id": "sh.picompanion:id/aerr_close_lookalike"',
    );
    expect(findErrorDialogDismissal(lookalike)).toBeNull();
    expect(ERROR_DIALOG_BUTTON_IDS).toEqual(["android:id/aerr_close", "android:id/aerr_wait"]);
  });
});

interface FakeAdb extends DeviceCommands {
  calls: string[][];
  logs: string[];
}

function fakeAdb(options: {
  installExit?: number;
  hideDialogsExit?: number;
  dumps: string[];
}): FakeAdb {
  const calls: string[][] = [];
  const logs: string[] = [];
  const dumps = [...options.dumps];
  return {
    calls,
    logs,
    async run(argv) {
      calls.push(argv);
      if (argv[0] === "install") return options.installExit ?? 0;
      if (argv[0] === "shell" && argv[1] === "settings") return options.hideDialogsExit ?? 0;
      return 0;
    },
    async capture(argv) {
      calls.push(argv);
      if (argv[0] === "shell" && argv[1] === "cat" && argv[2] === UI_DUMP_DEVICE_PATH) {
        return dumps.shift() ?? APP_SCREEN;
      }
      return "";
    },
    log(message) {
      logs.push(message);
    },
  };
}

describe("prepareDevice", () => {
  it("installs, hides new error dialogs, and taps an existing dialog's Close app once it is found", async () => {
    const adb = fakeAdb({ dumps: [ANR_DIALOG, APP_SCREEN] });
    await expect(prepareDevice("/tmp/app.apk", adb)).resolves.toBe(0);

    expect(adb.calls).toEqual([
      ["install", "-r", "/tmp/app.apk"],
      ["shell", "settings", "put", "global", "hide_error_dialogs", "1"],
      ["shell", "uiautomator", "dump", UI_DUMP_DEVICE_PATH],
      ["shell", "cat", UI_DUMP_DEVICE_PATH],
      ["shell", "input", "tap", "301", "1353"],
      ["shell", "uiautomator", "dump", UI_DUMP_DEVICE_PATH],
      ["shell", "cat", UI_DUMP_DEVICE_PATH],
    ]);
    expect(adb.logs.at(-1)).toBe("[device-prep] system error dialog dismissed");
  });

  it("taps nothing when no dialog is on screen", async () => {
    const adb = fakeAdb({ dumps: [APP_SCREEN] });
    await expect(prepareDevice("/tmp/app.apk", adb)).resolves.toBe(0);
    expect(adb.calls.some((argv) => argv[1] === "input")).toBe(false);
    expect(adb.logs.at(-1)).toBe("[device-prep] no system error dialog on screen");
  });

  it("propagates a failed install and does nothing else", async () => {
    const adb = fakeAdb({ installExit: 1, dumps: [] });
    await expect(prepareDevice("/tmp/app.apk", adb)).resolves.toBe(1);
    expect(adb.calls).toEqual([["install", "-r", "/tmp/app.apk"]]);
  });

  it("treats a missing hide_error_dialogs setting as non-fatal", async () => {
    const adb = fakeAdb({ hideDialogsExit: 255, dumps: [APP_SCREEN] });
    await expect(prepareDevice("/tmp/app.apk", adb)).resolves.toBe(0);
    expect(adb.logs).toContain(
      "[device-prep] could not set hide_error_dialogs (exit 255); continuing",
    );
  });

  it("gives up after a bounded number of dismissals rather than looping on a dialog that will not go", async () => {
    const adb = fakeAdb({ dumps: Array.from({ length: 10 }, () => ANR_DIALOG) });
    await expect(prepareDevice("/tmp/app.apk", adb)).resolves.toBe(0);
    const taps = adb.calls.filter((argv) => argv[1] === "input");
    expect(taps).toHaveLength(MAX_DIALOG_DISMISSALS);
    expect(adb.logs.at(-1)).toMatch(/still on screen after 3 dismissals; continuing/);
  });
});
