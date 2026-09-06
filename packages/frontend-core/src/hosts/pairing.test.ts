import { describe, expect, it } from "vitest";
import type { ConnectionOffer } from "@picompanion/protocol/connection-offer";
import {
  hostProfileDraftFromConnectionOffer,
  hostProfileDraftFromDirectConnection,
} from "./pairing.js";

describe("hostProfileDraftFromConnectionOffer", () => {
  const offer: ConnectionOffer = {
    v: 2,
    serverId: "srv_abc123",
    daemonPublicKeyB64: "base64key==",
    relay: { endpoint: "relay.paseo.sh:443", useTls: true },
  };

  it("builds a relay-only draft that does not prefer direct", () => {
    const draft = hostProfileDraftFromConnectionOffer(offer);
    expect(draft.direct).toBeUndefined();
    expect(draft.relay).toEqual({
      endpoint: "relay.paseo.sh:443",
      useTls: true,
      serverId: "srv_abc123",
      daemonPublicKeyB64: "base64key==",
    });
    expect(draft.preferDirect).toBe(false);
    expect(draft.label).toBe("relay.paseo.sh");
  });

  it("honors label/id/preferDirect overrides", () => {
    const draft = hostProfileDraftFromConnectionOffer(offer, {
      id: "host_fixed",
      label: "My laptop",
      preferDirect: true,
    });
    expect(draft.id).toBe("host_fixed");
    expect(draft.label).toBe("My laptop");
    expect(draft.preferDirect).toBe(true);
  });

  it("defaults relay useTls to true when the offer omits it", () => {
    const draft = hostProfileDraftFromConnectionOffer({
      ...offer,
      relay: { endpoint: "relay.paseo.sh:443" },
    });
    expect(draft.relay?.useTls).toBe(true);
  });
});

describe("hostProfileDraftFromDirectConnection", () => {
  it("builds a direct-only draft and returns the password separately", () => {
    const { draft, password } = hostProfileDraftFromDirectConnection({
      id: "host_direct_1",
      type: "directTcp",
      endpoint: "localhost:6767",
      password: "hunter2",
    });
    expect(draft).toEqual({
      id: "host_direct_1",
      label: "localhost",
      direct: { endpoint: "localhost:6767", useTls: false },
      preferDirect: true,
    });
    expect(password).toBe("hunter2");
    expect(JSON.stringify(draft)).not.toContain("hunter2");
  });

  it("normalizes a loopback endpoint (127.0.0.1) to localhost for a stable cache key", () => {
    const { draft } = hostProfileDraftFromDirectConnection({
      id: "host_direct_2",
      type: "directTcp",
      endpoint: "127.0.0.1:6767",
    });
    expect(draft.direct?.endpoint).toBe("localhost:6767");
  });

  it("leaves password undefined when the input carries none", () => {
    const { password } = hostProfileDraftFromDirectConnection({
      id: "host_direct_3",
      type: "directTcp",
      endpoint: "10.0.0.5:6767",
    });
    expect(password).toBeUndefined();
  });

  it("rejects a malformed direct connection descriptor", () => {
    expect(() =>
      hostProfileDraftFromDirectConnection({
        id: "host_direct_bad",
        type: "directTcp",
        endpoint: "",
      }),
    ).toThrow();
  });
});
