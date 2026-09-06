import { actions } from "@picompanion/frontend-core";
import { describe, expect, it } from "vitest";

/**
 * T103 — proves `packages/frontend-core/src/actions/` (T47A1a's
 * `RequestArbitrator`, plan.md §12.3) is actually reachable from
 * `apps/android` through the real package export
 * `@picompanion/frontend-core`, not merely present in the package's own
 * source tree.
 *
 * This file imports only `@picompanion/frontend-core` and `vitest` — it
 * never reaches `react-native` (the catalogued RN-in-vitest limitation:
 * any test importing a module that reaches react-native fails with
 * RolldownError on node_modules/react-native/index.js:1:0), matching the
 * pattern `apps/android/src/dev/component-lab.test.ts` already uses for
 * this same package.
 *
 * "Registration is not receipt": before T103, `src/index.ts` named no
 * `actions` export at all (`packages/frontend-core/src/actions/index.ts`
 * did not exist), so `actions` would have been `undefined` and every
 * property read below would throw. This asserts a real `RequestArbitrator`
 * instance arrives and actually arbitrates a two-client scenario end to
 * end — not just that the `actions` namespace object is truthy.
 */
describe("actions.RequestArbitrator reachability (T103)", () => {
  const clock = {
    now: () => 2_000,
    setTimeout: () => ({}) as never,
    clearTimeout: () => {},
    setInterval: () => ({}) as never,
    clearInterval: () => {},
  };

  it("constructs a real RequestArbitrator through the package specifier", () => {
    const arbitrator = new actions.RequestArbitrator<{ approved: boolean }>({ clock });
    expect(arbitrator.getOutcome("req-1")).toEqual({ status: "pending" });
  });

  it("arbitrates a submit-then-resolve sequence to a real, non-pending outcome", () => {
    const arbitrator = new actions.RequestArbitrator<{ approved: boolean }>({ clock });
    arbitrator.open("req-2");
    const local = arbitrator.submitLocalAnswer("req-2", { approved: true });
    expect(local.status).toBe("answered-locally");

    const resolved = arbitrator.applyResolution("req-2", {
      response: { approved: true },
    });
    expect(resolved.status).toBe("confirmed");
    expect(arbitrator.isTerminal("req-2")).toBe(true);
  });

  it("carries a superseded outcome for the losing client of two arbitrators", () => {
    const winner = new actions.RequestArbitrator<{ approved: boolean }>({ clock });
    const loser = new actions.RequestArbitrator<{ approved: boolean }>({ clock });

    winner.submitLocalAnswer("req-3", { approved: true });
    loser.submitLocalAnswer("req-3", { approved: false });

    const resolution = { response: { approved: true } };

    expect(winner.applyResolution("req-3", resolution).status).toBe("confirmed");
    const loserOutcome = loser.applyResolution("req-3", resolution);
    expect(loserOutcome.status).toBe("superseded");
    expect(loser.isSuperseded("req-3")).toBe(true);
  });
});
