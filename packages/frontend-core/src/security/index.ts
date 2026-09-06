/**
 * Security domain — plan.md §7/§14.
 *
 * Owns the shared "is this key or value secret-shaped?" detection used
 * by both apps' defence-in-depth call sites (T60A). See
 * `./secret-shape.ts`'s doc comment for what this is a control for, and
 * what it is not.
 *
 * Repository invariant: this module must never import React, React
 * Native, Expo, DOM types, or browser globals.
 */

export { isSecretShaped, isSecretShapedKey, isSecretShapedValue } from "./secret-shape.js";
