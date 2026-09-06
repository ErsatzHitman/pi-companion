import { describe, expect, it } from "vitest";

import {
  BOOTSTRAP_CONNECTION_GLOBAL_KEY,
  bootstrapConnectDraft,
  readBootstrapConnectDraft,
  readInjectedConnectionHint,
} from "./bootstrap-connection.js";

describe("readInjectedConnectionHint (T27A5)", () => {
  it("returns null when the global object has no bootstrap key at all", () => {
    expect(readInjectedConnectionHint({})).toBeNull();
  });

  it("returns null when the global itself is not an object", () => {
    expect(readInjectedConnectionHint(undefined)).toBeNull();
    expect(readInjectedConnectionHint(null)).toBeNull();
    expect(readInjectedConnectionHint("nope")).toBeNull();
  });

  it("reads a well-formed hint injected by packages/server/src/server/web-ui.ts", () => {
    const globalObject = {
      [BOOTSTRAP_CONNECTION_GLOBAL_KEY]: {
        listen: "daemon.example.test:6767",
        useTls: false,
        label: "my-mac",
      },
    };
    expect(readInjectedConnectionHint(globalObject)).toEqual({
      listen: "daemon.example.test:6767",
      useTls: false,
      label: "my-mac",
    });
  });

  it.each([
    ["the hint itself is not an object", { [BOOTSTRAP_CONNECTION_GLOBAL_KEY]: "nope" }],
    [
      "listen is missing",
      { [BOOTSTRAP_CONNECTION_GLOBAL_KEY]: { useTls: false, label: "my-mac" } },
    ],
    [
      "listen is empty",
      { [BOOTSTRAP_CONNECTION_GLOBAL_KEY]: { listen: "   ", useTls: false, label: "my-mac" } },
    ],
    [
      "listen is not a string",
      { [BOOTSTRAP_CONNECTION_GLOBAL_KEY]: { listen: 123, useTls: false, label: "my-mac" } },
    ],
    [
      "useTls is not a boolean",
      {
        [BOOTSTRAP_CONNECTION_GLOBAL_KEY]: {
          listen: "daemon.example.test:6767",
          useTls: "false",
          label: "my-mac",
        },
      },
    ],
    [
      "label is not a string",
      {
        [BOOTSTRAP_CONNECTION_GLOBAL_KEY]: {
          listen: "daemon.example.test:6767",
          useTls: false,
          label: null,
        },
      },
    ],
  ])("returns null when %s", (_description, globalObject) => {
    expect(readInjectedConnectionHint(globalObject)).toBeNull();
  });
});

describe("bootstrapConnectDraft (T27A5)", () => {
  it("builds a direct, password-free, preferDirect ConnectDraft from a valid hint", () => {
    const draft = bootstrapConnectDraft({
      listen: "daemon.example.test:6767",
      useTls: true,
      label: "my-mac",
    });
    expect(draft).toEqual({
      label: "my-mac",
      direct: { endpoint: "daemon.example.test:6767", useTls: true },
      preferDirect: true,
    });
  });

  it("accepts an IPv6 listen value the same way validate-connect-form does", () => {
    const draft = bootstrapConnectDraft({
      listen: "[::1]:6767",
      useTls: false,
      label: "localhost",
    });
    expect(draft).toEqual({
      label: "localhost",
      direct: { endpoint: "[::1]:6767", useTls: false },
      preferDirect: true,
    });
  });

  it("derives a label from the host when the injected label is blank", () => {
    const draft = bootstrapConnectDraft({
      listen: "daemon.example.test:6767",
      useTls: false,
      label: "   ",
    });
    expect(draft?.label).toBe("daemon.example.test");
  });

  it("returns null (never throws) when listen is not a valid host:port pair", () => {
    expect(
      bootstrapConnectDraft({ listen: "not-a-valid-listen-value", useTls: false, label: "x" }),
    ).toBeNull();
  });
});

describe("readBootstrapConnectDraft (T27A5)", () => {
  it("falls back to null for a missing bootstrap global", () => {
    expect(readBootstrapConnectDraft({})).toBeNull();
  });

  it("falls back to null for a malformed bootstrap global without throwing", () => {
    expect(
      readBootstrapConnectDraft({
        [BOOTSTRAP_CONNECTION_GLOBAL_KEY]: { listen: "", useTls: false, label: "x" },
      }),
    ).toBeNull();
  });

  it("combines reading and draft-building for a well-formed hint", () => {
    const draft = readBootstrapConnectDraft({
      [BOOTSTRAP_CONNECTION_GLOBAL_KEY]: {
        listen: "daemon.example.test:6767",
        useTls: false,
        label: "my-mac",
      },
    });
    expect(draft).toEqual({
      label: "my-mac",
      direct: { endpoint: "daemon.example.test:6767", useTls: false },
      preferDirect: true,
    });
  });
});
