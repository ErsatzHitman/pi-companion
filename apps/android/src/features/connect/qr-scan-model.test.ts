import { describe, expect, it, vi } from "vitest";

import type { PermissionState } from "../composer/permission-recovery.js";
import type { ApplyConnectionOfferResult } from "./apply-connection-offer.js";
import {
  CAMERA_BLOCKED_EXPLANATION,
  CAMERA_DENIED_EXPLANATION,
  CAMERA_UNAVAILABLE_EXPLANATION,
  createQrScanController,
  describeQrScanPhase,
} from "./qr-scan-model.js";
import type { CameraScannerPort } from "./qr-scanner-port.js";

/** A scripted `CameraScannerPort` whose status is mutable — mirrors how a real OS permission is a piece of persistent state a fresh screen mount reads back, not something this workspace's own code remembers. */
function makeScriptedScanner(initial: PermissionState): CameraScannerPort & {
  getPermissionStatusCalls: number;
  requestPermissionCalls: number;
  setStatus: (status: PermissionState) => void;
} {
  let status = initial;
  let getPermissionStatusCalls = 0;
  let requestPermissionCalls = 0;
  return {
    get getPermissionStatusCalls() {
      return getPermissionStatusCalls;
    },
    get requestPermissionCalls() {
      return requestPermissionCalls;
    },
    setStatus(next) {
      status = next;
    },
    async getPermissionStatus() {
      getPermissionStatusCalls += 1;
      return status;
    },
    async requestPermission() {
      requestPermissionCalls += 1;
      return status;
    },
  };
}

const successfulLifecycle = { dispose: vi.fn() } as never;

function makeApplyOffer(script: (text: string) => Promise<ApplyConnectionOfferResult>) {
  return vi.fn(script);
}

describe("createQrScanController", () => {
  it("does not touch the scanner port until enterScanSurface() is called — never at construction/app launch", () => {
    const scanner = makeScriptedScanner("undetermined");
    createQrScanController({
      scanner,
      applyOffer: makeApplyOffer(async () => {
        throw new Error("should not be called");
      }),
      onPaired: () => {
        throw new Error("should not be called");
      },
    });
    expect(scanner.getPermissionStatusCalls).toBe(0);
    expect(scanner.requestPermissionCalls).toBe(0);
  });

  it("starts idle before enterScanSurface() runs", () => {
    const scanner = makeScriptedScanner("granted");
    const controller = createQrScanController({
      scanner,
      applyOffer: makeApplyOffer(async () => {
        throw new Error("should not be called");
      }),
      onPaired: () => {},
    });
    expect(controller.getSnapshot()).toEqual({ phase: "idle", error: null });
  });

  it("undetermined permission is checked then prompted exactly once, landing on 'ready' when granted", async () => {
    const scanner = makeScriptedScanner("undetermined");
    scanner.setStatus("undetermined");
    // The prompt itself is what grants it — script requestPermission to flip status.
    const controller = createQrScanController({
      scanner: {
        ...scanner,
        async getPermissionStatus() {
          return "undetermined";
        },
        async requestPermission() {
          scanner.setStatus("granted");
          return "granted";
        },
      },
      applyOffer: makeApplyOffer(async () => {
        throw new Error("should not be called");
      }),
      onPaired: () => {},
    });

    await controller.enterScanSurface();
    expect(controller.getSnapshot()).toEqual({ phase: "ready", error: null });
  });

  it("already-granted permission goes straight to 'ready' without ever prompting", async () => {
    const scanner = makeScriptedScanner("granted");
    const controller = createQrScanController({
      scanner,
      applyOffer: makeApplyOffer(async () => {
        throw new Error("should not be called");
      }),
      onPaired: () => {},
    });

    await controller.enterScanSurface();
    expect(controller.getSnapshot()).toEqual({ phase: "ready", error: null });
    expect(scanner.requestPermissionCalls).toBe(0);
  });

  it("a remembered denial (status already 'denied') goes straight to the fallback, never re-prompting", async () => {
    const scanner = makeScriptedScanner("denied");
    const controller = createQrScanController({
      scanner,
      applyOffer: makeApplyOffer(async () => {
        throw new Error("should not be called");
      }),
      onPaired: () => {},
    });

    await controller.enterScanSurface();
    expect(controller.getSnapshot()).toEqual({ phase: "denied", error: null });
    expect(scanner.requestPermissionCalls).toBe(0);
    expect(describeQrScanPhase("denied")).toBe(CAMERA_DENIED_EXPLANATION);
  });

  it("re-entering the scan surface (a fresh controller, same underlying OS permission) never re-prompts after a denial", async () => {
    // Simulates leaving and re-entering the scan surface: a brand new
    // `QrPairingPanel` mount builds a brand new controller, but the
    // permission itself is the same persistent OS-level state (here,
    // the same scripted port instance) — so the second entry must read
    // "denied" and stop there, exactly like the first.
    const scanner = makeScriptedScanner("undetermined");
    const firstEntryController = createQrScanController({
      scanner: {
        ...scanner,
        async getPermissionStatus() {
          return scanner.getPermissionStatus();
        },
        async requestPermission() {
          scanner.setStatus("denied");
          return scanner.requestPermission();
        },
      },
      applyOffer: makeApplyOffer(async () => {
        throw new Error("should not be called");
      }),
      onPaired: () => {},
    });
    await firstEntryController.enterScanSurface();
    expect(firstEntryController.getSnapshot().phase).toBe("denied");
    expect(scanner.requestPermissionCalls).toBe(1);

    const secondEntryController = createQrScanController({
      scanner,
      applyOffer: makeApplyOffer(async () => {
        throw new Error("should not be called");
      }),
      onPaired: () => {},
    });
    await secondEntryController.enterScanSurface();
    expect(secondEntryController.getSnapshot().phase).toBe("denied");
    // Still exactly one prompt total, across both entries — the second
    // entry only ever re-checked, it never re-prompted.
    expect(scanner.requestPermissionCalls).toBe(1);
    expect(scanner.getPermissionStatusCalls).toBe(2);
  });

  it("a permanently-denied permission ('denied-permanently', the OS's own 'don't ask again') lands on its own 'settings' phase, never 'denied', and never re-prompts", async () => {
    const scanner = makeScriptedScanner("denied-permanently");
    const controller = createQrScanController({
      scanner,
      applyOffer: makeApplyOffer(async () => {
        throw new Error("should not be called");
      }),
      onPaired: () => {},
    });

    await controller.enterScanSurface();
    expect(controller.getSnapshot()).toEqual({ phase: "settings", error: null });
    expect(scanner.requestPermissionCalls).toBe(0);
    expect(describeQrScanPhase("settings")).toBe(CAMERA_BLOCKED_EXPLANATION);
    expect(describeQrScanPhase("settings")).not.toBe(describeQrScanPhase("denied"));
  });

  it("an unavailable camera module reports its own distinct fallback, never the 'denied' copy", async () => {
    const scanner = makeScriptedScanner("unavailable");
    const controller = createQrScanController({
      scanner,
      applyOffer: makeApplyOffer(async () => {
        throw new Error("should not be called");
      }),
      onPaired: () => {},
    });

    await controller.enterScanSurface();
    expect(controller.getSnapshot()).toEqual({ phase: "unavailable", error: null });
    expect(describeQrScanPhase("unavailable")).toBe(CAMERA_UNAVAILABLE_EXPLANATION);
    expect(describeQrScanPhase("unavailable")).not.toBe(describeQrScanPhase("denied"));
  });

  it("retryPermission() always prompts, even right after a remembered denial — the one deliberate exception, reached only by explicit user action", async () => {
    const scanner = makeScriptedScanner("denied");
    const controller = createQrScanController({
      scanner,
      applyOffer: makeApplyOffer(async () => {
        throw new Error("should not be called");
      }),
      onPaired: () => {},
    });
    await controller.enterScanSurface();
    expect(scanner.requestPermissionCalls).toBe(0);

    scanner.setStatus("granted");
    await controller.retryPermission();
    expect(scanner.requestPermissionCalls).toBe(1);
    expect(controller.getSnapshot()).toEqual({ phase: "ready", error: null });
  });

  it("a scanned offer completes pairing: 'pairing' then 'paired', and onPaired receives the successful result", async () => {
    const scanner = makeScriptedScanner("granted");
    const onPaired = vi.fn();
    const successResult: ApplyConnectionOfferResult = {
      ok: true,
      kind: "success",
      lifecycle: successfulLifecycle,
      relay: {
        kind: "relay",
        serverId: "srv-1",
        relayEndpoint: "relay.example:443",
        useTls: true,
        daemonPublicKeyB64: "abc",
      } as never,
      label: "My daemon",
    };
    const applyOffer = makeApplyOffer(async (text) => {
      expect(text).toBe("https://app.paseo.sh/#offer=abc123");
      return successResult;
    });
    const controller = createQrScanController({ scanner, applyOffer, onPaired });
    await controller.enterScanSurface();

    const phases: string[] = [];
    controller.subscribe((snapshot) => phases.push(snapshot.phase));
    await controller.handleScannedText("https://app.paseo.sh/#offer=abc123");

    expect(phases).toEqual(["pairing", "paired"]);
    expect(controller.getSnapshot()).toEqual({ phase: "paired", error: null });
    expect(onPaired).toHaveBeenCalledTimes(1);
    expect(onPaired).toHaveBeenCalledWith(successResult);
  });

  it("a malformed/expired scan lands on 'error' with the classified message, and does not call onPaired", async () => {
    const scanner = makeScriptedScanner("granted");
    const onPaired = vi.fn();
    const applyOffer = makeApplyOffer(async () => ({
      ok: false,
      kind: "malformed",
      error: "This pairing link isn't valid. Check it was copied in full and try again.",
    }));
    const controller = createQrScanController({ scanner, applyOffer, onPaired });
    await controller.enterScanSurface();
    await controller.handleScannedText("garbage");

    expect(controller.getSnapshot()).toEqual({
      phase: "error",
      error: "This pairing link isn't valid. Check it was copied in full and try again.",
    });
    expect(onPaired).not.toHaveBeenCalled();
  });

  it("the same text scanned again after a failure is retried, not silently dropped", async () => {
    const scanner = makeScriptedScanner("granted");
    let call = 0;
    const applyOffer = makeApplyOffer(async () => {
      call += 1;
      return call === 1
        ? { ok: false, kind: "malformed", error: "nope" }
        : {
            ok: true,
            kind: "success",
            lifecycle: successfulLifecycle,
            relay: {} as never,
            label: "x",
          };
    });
    const onPaired = vi.fn();
    const controller = createQrScanController({ scanner, applyOffer, onPaired });
    await controller.enterScanSurface();

    await controller.handleScannedText("same-text");
    expect(controller.getSnapshot().phase).toBe("error");

    await controller.handleScannedText("same-text");
    expect(controller.getSnapshot().phase).toBe("paired");
    expect(applyOffer).toHaveBeenCalledTimes(2);
  });

  it("an identical scan repeated while already pairing is ignored (dedupe), not re-attempted", async () => {
    const scanner = makeScriptedScanner("granted");
    let resolveFirst: (() => void) | undefined;
    const applyOffer = makeApplyOffer(
      () =>
        new Promise<ApplyConnectionOfferResult>((resolve) => {
          resolveFirst = () =>
            resolve({
              ok: true,
              kind: "success",
              lifecycle: successfulLifecycle,
              relay: {} as never,
              label: "x",
            });
        }),
    );
    const controller = createQrScanController({ scanner, applyOffer, onPaired: () => {} });
    await controller.enterScanSurface();

    const firstCall = controller.handleScannedText("dup-text");
    // Fires while the first attempt is still in flight — same text.
    await controller.handleScannedText("dup-text");
    expect(applyOffer).toHaveBeenCalledTimes(1);

    resolveFirst?.();
    await firstCall;
    expect(controller.getSnapshot().phase).toBe("paired");
  });

  it("a scan is ignored entirely once already paired", async () => {
    const scanner = makeScriptedScanner("granted");
    const applyOffer = makeApplyOffer(async () => ({
      ok: true,
      kind: "success",
      lifecycle: successfulLifecycle,
      relay: {} as never,
      label: "x",
    }));
    const controller = createQrScanController({ scanner, applyOffer, onPaired: () => {} });
    await controller.enterScanSurface();
    await controller.handleScannedText("first");
    expect(controller.getSnapshot().phase).toBe("paired");

    await controller.handleScannedText("second-different-text");
    expect(applyOffer).toHaveBeenCalledTimes(1);
  });
});
