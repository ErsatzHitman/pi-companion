// Re-export protocol types and define PIUI wire constants
export * from "@picompanion/protocol/pi-ui-bridge/schema";

export const PIUI_MARKER = "PIUI ";
export const PIUI_MAX_REASSEMBLED_BYTES = 1_048_576; // 1 MiB
export const PIUI_CHUNK_TTL_MS = 30_000;
