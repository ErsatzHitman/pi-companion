import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

// Load package-local .env.test first for integration/E2E credentials, then repo-root .env fallback.
const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
dotenv.config({ path: path.resolve(serverRoot, ".env.test"), override: true });
dotenv.config({ path: path.resolve(serverRoot, "../.env") });

// The Pi provider's session watcher and live tail resolve `~/.pi/agent/sessions`
// by default. Without an override the suite would watch — and auto-import — the
// developer's real Pi sessions, which makes daemon bootstrap tests slow, flaky
// and machine-dependent. Pin the agent directory to an empty scratch tree unless
// the caller already chose one.
//
// Only `PI_CODING_AGENT_DIR` is pinned: `PI_CODING_AGENT_SESSION_DIR` takes
// precedence over a provider's own `runtimeSettings.env.PI_CODING_AGENT_DIR`
// (see `resolvePiSessionsDir`), so setting it here would override per-test
// provider configuration.
if (!process.env.PI_CODING_AGENT_DIR?.trim()) {
  const piAgentDir = path.join(os.tmpdir(), `paseo-test-pi-agent-${process.pid}`);
  fs.mkdirSync(path.join(piAgentDir, "sessions"), { recursive: true });
  process.env.PI_CODING_AGENT_DIR = piAgentDir;
}

process.env.PASEO_SUPERVISED = "0";
process.env.GIT_TERMINAL_PROMPT = "0";
process.env.GIT_SSH_COMMAND = "ssh -oBatchMode=yes";
process.env.SSH_ASKPASS = "/usr/bin/false";
process.env.SSH_ASKPASS_REQUIRE = "force";
process.env.DISPLAY = process.env.DISPLAY ?? "1";
