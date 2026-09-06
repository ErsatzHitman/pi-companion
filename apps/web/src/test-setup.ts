import { toHaveNoViolations } from "jest-axe";
import { expect } from "vitest";

import { ensureDesignTokensCss } from "./styles/design-tokens.js";

// jsdom does not implement `window.scrollTo`; TanStack Router's scroll
// restoration calls it on every navigation. Stub it so test output isn't
// full of "Not implemented" noise from a browser API jsdom never had.
if (typeof window !== "undefined") {
  window.scrollTo = () => {};
}

// plan.md §10.5: "Web runs axe checks." `expect(...).toHaveNoViolations()`
// is available to every component test in this app from this one setup.
expect.extend(toHaveNoViolations);

// Every primitive reads colour/spacing/motion tokens through CSS custom
// properties (plan.md §10.2); inject them once so component tests render
// with real token values instead of unresolved `var(...)` fallbacks.
ensureDesignTokensCss();
document.documentElement.setAttribute("data-theme", "light");
