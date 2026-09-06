/**
 * Module augmentation for jest-axe's `toHaveNoViolations` matcher (plan.md
 * §10.5 axe checks) against Vitest's `expect`, since `jest-axe` only ships
 * Jest-shaped ambient types.
 */
import "vitest";

interface AxeMatchers<R = unknown> {
  toHaveNoViolations(): R;
}

declare module "vitest" {
  interface Assertion<T = unknown> extends AxeMatchers<T> {}
  interface AsymmetricMatchersContaining extends AxeMatchers {}
}
