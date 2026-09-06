// Shared shape for the recorded payload-compatibility fixtures in
// `payload-compat/`. See README.md for scope and plan.md §4.2 step 7 for the
// source requirement (T07C, `docs/issues-from-plan.md`).

/** Whether the Pi UI helper that authored an element predates `piUiPayloadV2`. */
export type PayloadCompatHelperVersion = "old" | "new";

/** Whether the client receiving a projected element negotiated `piUiPayloadV2`. */
export type PayloadCompatClientCapability = "old" | "new";

/**
 * One kind's worth of data for a payload-compatibility scenario: the literal
 * `el` a helper of the fixture's `helperVersion` would emit in a v1 PIUI `set`
 * line, the element after `PiUiDecoder` normalization (plan.md §4.2 step 4),
 * and the element as `projectPiUiElementForClient` (step 6) sends it to a
 * client of the fixture's `clientCapability`.
 */
export interface PayloadCompatFixtureElement {
  kind: string;
  helperInput: Record<string, unknown>;
  expectedNormalizedElement: Record<string, unknown>;
  expectedClientElement: Record<string, unknown>;
}

/**
 * One of the four old/new helper × old/new client compatibility scenarios
 * required by plan.md §4.2 step 7.
 */
export interface PayloadCompatFixture {
  scenario: string;
  description: string;
  planRef: string;
  helperVersion: PayloadCompatHelperVersion;
  clientCapability: PayloadCompatClientCapability;
  elements: PayloadCompatFixtureElement[];
}
