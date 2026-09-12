import { describe, expect, test } from "vitest";
import { AgentRewindResponseMessageSchema } from "@picompanion/protocol/messages";
import {
  REWIND_CONFLICT_ERROR_MARKER,
  REWIND_UNSUPPORTED_ERROR_MARKER,
} from "@picompanion/protocol/rewind-errors";
import type { RewindClientPort, RewindMode } from "./rewind-controller.js";
import { RewindController } from "./rewind-controller.js";

interface PortCall {
  agentId: string;
  messageId: string;
  mode: RewindMode;
  options: { force?: boolean } | undefined;
}

function recordingPort(rejection?: unknown): {
  port: RewindClientPort;
  calls: PortCall[];
} {
  const calls: PortCall[] = [];
  const port: RewindClientPort = {
    async rewindAgent(agentId, messageId, mode, options) {
      calls.push({ agentId, messageId, mode, options });
      if (rejection !== undefined) {
        throw rejection;
      }
    },
  };
  return { port, calls };
}

const request = { agentId: "agent-1", messageId: "message-1", mode: "files" } as const;

describe("RewindController", () => {
  test("reports success and forwards the request to the port", async () => {
    const recording = recordingPort();
    const controller = new RewindController(recording.port);

    await expect(controller.rewind(request)).resolves.toEqual({ status: "success" });
    expect(recording.calls).toEqual([
      { agentId: "agent-1", messageId: "message-1", mode: "files", options: undefined },
    ]);
  });

  test("maps a checkpoint refusal to `conflict` and strips the marker", async () => {
    const human =
      "The workspace changed after the checkpoint was taken. Re-run the rewind with force to discard those changes.";
    const controller = new RewindController(
      recordingPort(new Error(`${REWIND_CONFLICT_ERROR_MARKER}${human}`)).port,
    );

    await expect(controller.rewind(request)).resolves.toEqual({
      status: "conflict",
      message: human,
    });
  });

  test("maps an unavailable mode to `unsupported` and strips the marker", async () => {
    const human = "Provider does not support rewinding files";
    const controller = new RewindController(
      recordingPort(new Error(`${REWIND_UNSUPPORTED_ERROR_MARKER}${human}`)).port,
    );

    await expect(controller.rewind(request)).resolves.toEqual({
      status: "unsupported",
      message: human,
    });
  });

  test("maps an unclassified error to `failed` carrying the daemon's own message", async () => {
    const controller = new RewindController(recordingPort(new Error("daemon exploded")).port);

    await expect(controller.rewind(request)).resolves.toEqual({
      status: "failed",
      message: "daemon exploded",
    });
  });

  test("maps a non-Error rejection to `failed` with a stable fallback", async () => {
    const controller = new RewindController(recordingPort("not an error").port);

    await expect(controller.rewind(request)).resolves.toEqual({
      status: "failed",
      message: "not an error",
    });
  });

  test("forwards `force: true` to the port when the caller asks to override", async () => {
    const recording = recordingPort();
    const controller = new RewindController(recording.port);

    await controller.rewind({ ...request, force: true });

    expect(recording.calls).toEqual([
      { agentId: "agent-1", messageId: "message-1", mode: "files", options: { force: true } },
    ]);
  });

  test("forwards `force: false` explicitly when the caller supplies it", async () => {
    const recording = recordingPort();
    const controller = new RewindController(recording.port);

    await controller.rewind({ ...request, force: false });

    expect(recording.calls).toEqual([
      { agentId: "agent-1", messageId: "message-1", mode: "files", options: { force: false } },
    ]);
  });

  test("passes `undefined` options when the caller omits `force`", async () => {
    const recording = recordingPort();
    const controller = new RewindController(recording.port);

    await controller.rewind(request);

    expect(recording.calls[0]?.options).toBeUndefined();
  });

  test("classifies a conflict marker carried through the real response schema and JSON", async () => {
    const human = "The workspace changed after the checkpoint was taken.";
    const parsed = AgentRewindResponseMessageSchema.parse({
      type: "agent.rewind.response",
      payload: {
        requestId: "req-1",
        agentId: "agent-1",
        ok: false,
        error: `${REWIND_CONFLICT_ERROR_MARKER}${human}`,
      },
    });
    // The client surfaces exactly the string the schema parsed back off the
    // wire, so round-trip through JSON the way the WebSocket frame does.
    const wire = JSON.parse(JSON.stringify(parsed)) as typeof parsed;

    const controller = new RewindController(recordingPort(new Error(wire.payload.error)).port);

    await expect(controller.rewind(request)).resolves.toEqual({
      status: "conflict",
      message: human,
    });
  });
});
