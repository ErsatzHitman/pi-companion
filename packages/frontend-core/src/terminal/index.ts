/**
 * Terminal domain — plan.md §8.4/§12.4/§14.5, T30A1.
 *
 * Owns the framework-neutral `TerminalController` over one terminal's
 * binary stream (`packages/protocol/src/binary-frames/terminal.ts`)
 * and its client-side output backpressure buffer
 * (`TerminalOutputBuffer`). `apps/web` (T30A2/T30A3) and `apps/android`
 * (T35B) mount this on their own renderer; this module never touches
 * React, DOM, or a concrete transport.
 *
 * Resize *ownership* (T30A3) and terminal listing/creation UI are
 * deliberately out of scope here — see `terminal-controller.ts`'s
 * module doc.
 *
 * Repository invariant: this module must never import React, React
 * Native, Expo, DOM types, or browser globals.
 */

export {
  TERMINAL_OUTPUT_HARD_BUFFER_BYTES,
  TERMINAL_OUTPUT_SOFT_BUFFER_BYTES,
  TerminalController,
} from "./terminal-controller.js";
export type {
  TerminalControllerEvent,
  TerminalControllerEventListener,
  TerminalControllerOptions,
  TerminalControllerStatus,
  TerminalControllerStatusListener,
  TerminalRestoreOptions,
  TerminalRpcClient,
  TerminalSubscribeOutcome,
} from "./terminal-controller.js";

export { TerminalOutputBuffer } from "./terminal-output-buffer.js";
export type {
  TerminalOutputBufferEvent,
  TerminalOutputBufferEventListener,
  TerminalOutputBufferOptions,
  TerminalOutputChunk,
  TerminalOutputSink,
} from "./terminal-output-buffer.js";
