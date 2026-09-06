import type { z } from "zod";
import { WSOutboundMessageSchema } from "../messages.js";
import type { WSOutboundMessage } from "../messages.js";

type WSOutboundValidationResult =
  | { success: true; data: WSOutboundMessage }
  | { success: false; error: z.ZodError };

// BROWSER BUILD TARGET (package.json "exports" -> "browser" condition, see
// ../../package.json). Same WSOutboundMessageSchema as the Node/daemon build
// (../messages.ts), validated through zod's normal interpreter instead of the
// zod-aot generated module that ./ws-outbound.ts imports for the "default" condition.
//
// That AOT module is a ~12MB / ~517KB gzip standalone artifact: T58B measured it as
// ~84% of the session route's over-budget bundle. It exists purely as a Node-side
// throughput optimization for the daemon's own message loop; browsers validate one
// received frame at a time and pay zod's ordinary (much smaller, already-bundled-
// elsewhere-in-shape) interpreter cost instead. The schema — and therefore what is
// accepted or rejected — is identical; only the validator implementation differs.
// Do not reintroduce a static import of the generated/*.aot.js module here.
export function validateWSOutboundMessage(input: unknown): WSOutboundValidationResult {
  return WSOutboundMessageSchema.safeParse(input);
}
