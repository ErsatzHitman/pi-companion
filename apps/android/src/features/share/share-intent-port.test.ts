import { describe, expect, it } from "vitest";

import { createUnavailableShareIntentPort } from "./share-intent-port";

describe("createUnavailableShareIntentPort", () => {
  it("reports no initial share intent", async () => {
    const port = createUnavailableShareIntentPort();
    expect(await port.getInitialShareIntent()).toBeNull();
  });

  it("never calls a subscribed handler", () => {
    const port = createUnavailableShareIntentPort();
    const handler = () => {
      throw new Error("should never be called");
    };
    const unsubscribe = port.subscribe(handler);
    expect(typeof unsubscribe).toBe("function");
    unsubscribe();
  });
});
