import { describe, expect, it } from "vitest";
import { ReconnectPolicy } from "./reconnect-policy.js";

describe("ReconnectPolicy", () => {
  it("backs off exponentially per kind, capped at maxDelayMs", () => {
    const policy = new ReconnectPolicy({
      baseDelayMs: 1000,
      maxDelayMs: 8000,
      maxAttemptsPerKind: 100,
    });
    expect(policy.recordFailure("direct").delayMs).toBe(1000);
    expect(policy.recordFailure("direct").delayMs).toBe(2000);
    expect(policy.recordFailure("direct").delayMs).toBe(4000);
    expect(policy.recordFailure("direct").delayMs).toBe(8000);
    // Capped: would be 16000 uncapped.
    expect(policy.recordFailure("direct").delayMs).toBe(8000);
  });

  it("tracks attempt counts independently per connection kind", () => {
    const policy = new ReconnectPolicy({ baseDelayMs: 1000, maxAttemptsPerKind: 100 });
    policy.recordFailure("direct");
    policy.recordFailure("direct");
    policy.recordFailure("relay");
    expect(policy.getAttemptCount("direct")).toBe(2);
    expect(policy.getAttemptCount("relay")).toBe(1);
  });

  it("recommends switching kind once a kind's consecutive failures reach maxAttemptsPerKind", () => {
    const policy = new ReconnectPolicy({ maxAttemptsPerKind: 3 });
    expect(policy.recordFailure("direct").shouldSwitchKind).toBe(false);
    expect(policy.recordFailure("direct").shouldSwitchKind).toBe(false);
    expect(policy.recordFailure("direct").shouldSwitchKind).toBe(true);
    expect(policy.recordFailure("direct").shouldSwitchKind).toBe(true);
  });

  it("recordSuccess resets that kind's attempt count and its next failure starts the backoff over", () => {
    const policy = new ReconnectPolicy({ baseDelayMs: 1000, maxAttemptsPerKind: 100 });
    policy.recordFailure("direct");
    policy.recordFailure("direct");
    expect(policy.getAttemptCount("direct")).toBe(2);
    policy.recordSuccess("direct");
    expect(policy.getAttemptCount("direct")).toBe(0);
    expect(policy.recordFailure("direct")).toMatchObject({ attempt: 1, delayMs: 1000 });
  });

  it("reset() clears every kind's attempt count", () => {
    const policy = new ReconnectPolicy({ maxAttemptsPerKind: 100 });
    policy.recordFailure("direct");
    policy.recordFailure("relay");
    policy.reset();
    expect(policy.getAttemptCount("direct")).toBe(0);
    expect(policy.getAttemptCount("relay")).toBe(0);
  });

  it("uses documented defaults when no config is given", () => {
    const policy = new ReconnectPolicy();
    expect(policy.recordFailure("direct").delayMs).toBe(1000);
  });
});
