/**
 * The non-rail Pi UI placement destinations (plan.md §11.3, §11.5).
 *
 * `pinned` and `status` live under `features/rail/` (the right rail and its
 * status strip); this module is the barrel for the three placements that
 * were unselected before it existed — `inline`, `sheet`, and `screen` —
 * plus their pure placement selectors. Consumers import from here rather
 * than reaching into individual host modules.
 */
export {
  selectInlineElements,
  selectScreenElements,
  selectSheetElements,
} from "./select-placement-elements.js";
export {
  PiExtensionInlineStack,
  type PiExtensionInlineStackProps,
} from "./PiExtensionInlineStack.js";
export { PiExtensionScreenHost, type PiExtensionScreenHostProps } from "./PiExtensionScreenHost.js";
export { PiExtensionSheetHost, type PiExtensionSheetHostProps } from "./PiExtensionSheetHost.js";
