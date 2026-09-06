/**
 * @picompanion/design-tokens
 *
 * Shared design tokens for the web and Android clients (plan.md §10.2).
 * Web consumes `web.ts`'s generated CSS custom properties; Android
 * consumes `native.ts`'s typed theme objects. Neither platform, nor any
 * product component, should hold a raw hex color, spacing pixel value, or
 * motion duration outside this package.
 */

export * from "./tokens.js";
export * from "./web.js";
export * from "./native.js";
