/**
 * One-shot daemon smoke check (no watch mode, always exits).
 *
 * Spawns the built daemon worker against a scratch `PASEO_HOME`, waits for the
 * HTTP health endpoint, performs the WebSocket `hello` handshake and asserts the
 * daemon answers with a `server_info` status, then terminates the daemon and
 * removes the scratch home. Exits non-zero on any failure.
 *
 * Requires `npm run build` in this package first.
 *
 * Usage: npm run smoke:daemon --workspace @picompanion/server
 */
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { spawn, type ChildProcess } from "node:child_process";

import { WebSocket } from "ws";

const HEALTH_TIMEOUT_MS = 60_000;
const HANDSHAKE_TIMEOUT_MS = 20_000;

function resolveWorkerEntry(): string {
  const candidates = [
    fileURLToPath(new URL("../dist/server/server/daemon-worker.js", import.meta.url)),
    fileURLToPath(new URL("../server/server/daemon-worker.js", import.meta.url)),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(
    `Daemon worker bundle not found (looked in ${candidates.join(", ")}). Run "npm run build" first.`,
  );
}

async function findFreePort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Expected a TCP address"));
        return;
      }
      const { port } = address;
      server.close(() => resolve(port));
    });
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

async function waitForHealth(port: number, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  let lastError = "no attempt made";
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`Daemon exited early (code=${child.exitCode} signal=${child.signalCode})`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`);
      const body = (await response.json()) as { status?: string };
      if (response.ok && body.status === "ok") return;
      lastError = `status=${response.status} body=${JSON.stringify(body)}`;
    } catch (error) {
      lastError = String(error);
    }
    await delay(250);
  }
  throw new Error(`Daemon health endpoint never became ready: ${lastError}`);
}

async function helloHandshake(port: number): Promise<Record<string, unknown>> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  try {
    return await withTimeout(
      new Promise<Record<string, unknown>>((resolve, reject) => {
        ws.on("error", reject);
        ws.on("close", (code) => reject(new Error(`socket closed early with code ${code}`)));
        ws.on("open", () => {
          ws.send(
            JSON.stringify({
              type: "hello",
              clientId: "smoke-daemon-hello",
              clientType: "cli",
              protocolVersion: 1,
            }),
          );
        });
        ws.on("message", (data: Buffer) => {
          let parsed: Record<string, unknown>;
          try {
            parsed = JSON.parse(data.toString("utf8")) as Record<string, unknown>;
          } catch {
            return;
          }
          // The daemon answers `hello` with a wrapped session status message:
          // { type: "session", message: { type: "status", payload: { status: "server_info", ... } } }
          const message = (parsed.message ?? parsed) as Record<string, unknown>;
          const payload = (message.payload ?? message) as Record<string, unknown>;
          if (payload.status === "server_info") resolve(payload);
        });
      }),
      HANDSHAKE_TIMEOUT_MS,
      "WebSocket hello handshake",
    );
  } finally {
    ws.removeAllListeners();
    ws.close();
  }
}

async function stopDaemon(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  child.kill("SIGTERM");
  const timer = setTimeout(() => child.kill("SIGKILL"), 10_000);
  await exited;
  clearTimeout(timer);
}

async function main(): Promise<void> {
  const workerEntry = resolveWorkerEntry();
  const root = await mkdtemp(path.join(os.tmpdir(), "paseo-smoke-home-"));
  const paseoHome = path.join(root, ".paseo");
  await mkdir(paseoHome, { recursive: true });
  // Keep the Pi session watcher inside the scratch tree so the smoke run never
  // touches (or auto-imports) the developer's real ~/.pi sessions.
  const piAgentDir = path.join(root, "pi-agent");
  await mkdir(path.join(piAgentDir, "sessions"), { recursive: true });
  const port = await findFreePort();

  const child = spawn(process.execPath, [workerEntry], {
    env: {
      ...process.env,
      PASEO_HOME: paseoHome,
      PASEO_LISTEN: `127.0.0.1:${port}`,
      PASEO_NODE_ENV: "production",
      PI_CODING_AGENT_DIR: piAgentDir,
      PI_CODING_AGENT_SESSION_DIR: path.join(piAgentDir, "sessions"),
      // Local speech models are multi-hundred-MB downloads; the smoke check is
      // about daemon startup and the WebSocket hello, not voice.
      PASEO_VOICE_MODE_ENABLED: "false",
      PASEO_DICTATION_ENABLED: "false",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const daemonOutput: string[] = [];
  child.stdout?.on("data", (chunk: Buffer) => daemonOutput.push(chunk.toString("utf8")));
  child.stderr?.on("data", (chunk: Buffer) => daemonOutput.push(chunk.toString("utf8")));

  let failure: unknown = null;
  try {
    await waitForHealth(port, child);
    const serverInfo = await helloHandshake(port);
    process.stdout.write(
      `daemon smoke OK  home=${paseoHome} listen=127.0.0.1:${port} ` +
        `serverId=${String(serverInfo.serverId)} version=${String(serverInfo.version)}\n`,
    );
  } catch (error) {
    failure = error;
    process.stderr.write(
      `--- daemon output ---\n${daemonOutput.join("")}\n---------------------\n`,
    );
  } finally {
    await stopDaemon(child);
    await rm(root, { recursive: true, force: true }).catch(() => undefined);
  }

  if (failure) throw failure;
}

main().then(
  () => process.exit(0),
  (error: unknown) => {
    process.stderr.write(`daemon smoke FAILED: ${String(error)}\n`);
    process.exit(1);
  },
);
