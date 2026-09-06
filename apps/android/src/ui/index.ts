/**
 * Native primitives and recipes — plan.md §6/§10, T26A.
 *
 * `theme/` resolves `@picompanion/design-tokens`'s typed theme objects
 * against the platform's colour scheme and reduce-motion settings.
 * `primitives/` is the §10.3 primitive layer built from those tokens.
 * `recipes/` is the §10.4 product-recipe layer built on top of the
 * primitives (T26B).
 */
export { ThemeProvider, useTheme } from "./theme/theme-context";
export type { ThemeContextValue } from "./theme/theme-context";
export * from "./primitives/index";
export * from "./recipes/index";
