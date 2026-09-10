/**
 * T329 — what every Maestro job does to the emulator before its first
 * flow, as ONE function that `run-shard.ts` (the shards) and
 * `prepare-device.ts` (`packaged-app-smoke`) both call.
 *
 * ## Why a system dialog has to be DISMISSED, not only hidden
 *
 * T328 set `hide_error_dialogs 1` after `adb install`, because run
 * 34442086730's shard-1 lost both flows to a launcher ANR dialog
 * ("Quickstep isn't responding" / "Close app" / "Wait") sitting over the
 * app Maestro had just launched. Run 34444464068 then lost
 * `packaged-app-smoke` and both of shard-4's flows to the very same
 * dialog, with the setting in place. The setting is real and it works —
 * but it governs whether the system SHOWS a new dialog. It does nothing
 * to one that is already on screen, and the launcher ANRs while the
 * runner is still booting, before any of this has run. So the setting
 * alone protects every flow after the first from a dialog that appears
 * later; it never protected the first flow from the one already there.
 *
 * The dismissal reads the screen the way Maestro will: `uiautomator dump`
 * writes the accessibility tree as XML, and an Android error dialog's
 * buttons carry stable framework ids — `android:id/aerr_close` ("Close
 * app") and `android:id/aerr_wait` ("Wait"). "Close app" is preferred:
 * it kills the hung launcher, which the system restarts on demand,
 * whereas "Wait" leaves a still-hung process that may re-ANR (and, with
 * `hide_error_dialogs` now set, would then be killed anyway). The loop
 * runs a bounded number of times because one dismissal can reveal a
 * second dialog stacked beneath it.
 *
 * Nothing here is fatal except a failed install: a runner whose
 * `uiautomator` cannot dump, or whose settings table lacks the key, gets
 * a logged line and the flows still run — the flows themselves are the
 * proof, and a flow that fails on a dialog fails visibly, with its
 * hierarchy in the artifact.
 */

export interface DeviceCommands {
  /** Runs `adb <argv>` with inherited stdio; resolves to the exit code. */
  run(argv: string[]): Promise<number>;
  /** Runs `adb <argv>` and resolves to its combined stdout+stderr. */
  capture(argv: string[]): Promise<string>;
  log(message: string): void;
}

/**
 * In preference order. Both ids come from the Android framework's own
 * `AppErrorDialog`/`AppNotRespondingDialog` layouts and have been stable
 * across releases.
 */
export const ERROR_DIALOG_BUTTON_IDS = ["android:id/aerr_close", "android:id/aerr_wait"] as const;

export const UI_DUMP_DEVICE_PATH = "/sdcard/picompanion-device-prep.xml";

/** One dismissal can uncover a second dialog; three is well past anything a boot has produced. */
export const MAX_DIALOG_DISMISSALS = 3;

export interface ErrorDialogDismissal {
  resourceId: (typeof ERROR_DIALOG_BUTTON_IDS)[number];
  /** Tap target: the centre of the button's `bounds`, in screen pixels. */
  x: number;
  y: number;
}

const NODE_TAG = /<node\b([^>]*?)\/?>/g;
const ATTRIBUTE = /([\w:-]+)="([^"]*)"/g;
const BOUNDS = /^\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]$/;

function parseAttributes(tag: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const match of tag.matchAll(ATTRIBUTE)) {
    attributes[match[1] as string] = match[2] as string;
  }
  return attributes;
}

/**
 * Finds the button to tap to dismiss a system error dialog in a
 * `uiautomator dump`, or `null` when no such dialog is on screen. Pure:
 * it parses the XML and nothing else, so it is tested against fixtures.
 */
export function findErrorDialogDismissal(uiDumpXml: string): ErrorDialogDismissal | null {
  const nodes = [...uiDumpXml.matchAll(NODE_TAG)].map((match) => parseAttributes(match[1] ?? ""));
  for (const resourceId of ERROR_DIALOG_BUTTON_IDS) {
    const node = nodes.find((candidate) => candidate["resource-id"] === resourceId);
    if (!node) continue;
    const bounds = BOUNDS.exec(node["bounds"] ?? "");
    if (!bounds) continue;
    const [x1, y1, x2, y2] = bounds.slice(1, 5).map(Number) as [number, number, number, number];
    if (x2 <= x1 || y2 <= y1) continue;
    return { resourceId, x: Math.floor((x1 + x2) / 2), y: Math.floor((y1 + y2) / 2) };
  }
  return null;
}

async function captureUiDump(adb: DeviceCommands): Promise<string> {
  await adb.run(["shell", "uiautomator", "dump", UI_DUMP_DEVICE_PATH]);
  return adb.capture(["shell", "cat", UI_DUMP_DEVICE_PATH]);
}

/**
 * Installs the APK, stops the system showing new error dialogs, and
 * dismisses any already on screen. Resolves to the exit code the caller
 * should propagate: `adb install`'s when it fails, else `0`.
 */
export async function prepareDevice(apkPath: string, adb: DeviceCommands): Promise<number> {
  const installExit = await adb.run(["install", "-r", apkPath]);
  if (installExit !== 0) {
    adb.log(`[device-prep] adb install failed with exit code ${installExit}: ${apkPath}`);
    return installExit;
  }

  const hideDialogsExit = await adb.run([
    "shell",
    "settings",
    "put",
    "global",
    "hide_error_dialogs",
    "1",
  ]);
  if (hideDialogsExit !== 0) {
    adb.log(`[device-prep] could not set hide_error_dialogs (exit ${hideDialogsExit}); continuing`);
  }

  for (let attempt = 1; attempt <= MAX_DIALOG_DISMISSALS; attempt += 1) {
    const dismissal = findErrorDialogDismissal(await captureUiDump(adb));
    if (dismissal === null) {
      adb.log(
        attempt === 1
          ? "[device-prep] no system error dialog on screen"
          : "[device-prep] system error dialog dismissed",
      );
      return 0;
    }
    adb.log(
      `[device-prep] system error dialog on screen; tapping ${dismissal.resourceId} at (${dismissal.x}, ${dismissal.y})`,
    );
    await adb.run(["shell", "input", "tap", String(dismissal.x), String(dismissal.y)]);
  }

  adb.log(
    `[device-prep] a system error dialog is still on screen after ${MAX_DIALOG_DISMISSALS} dismissals; continuing`,
  );
  return 0;
}
