import { watch, type FSWatcher } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Logger } from "pino";
import type { AgentManager } from "../../agent-manager.js";
import type { AgentStorage } from "../../agent-storage.js";
import type { ProviderSnapshotManager } from "../../provider-snapshot-manager.js";
import { resolvePiSessionsDir } from "./session-descriptor.js";
import { importProviderSession } from "../../import-sessions.js";

import type { WorkspaceProvisioningService } from "../../../session/workspace-provisioning/workspace-provisioning-service.js";

export interface PiSessionWatcherOptions {
  logger: Logger;
  agentManager: AgentManager;
  agentStorage: AgentStorage;
  providerSnapshotManager?: ProviderSnapshotManager;
  workspaceProvisioning?: Pick<WorkspaceProvisioningService, "runInImportWorkspace">;
  broadcast?: (message: unknown) => void;
  paseoHome?: string;
  worktreesRoot?: string;
  debounceMs?: number;
  pollIntervalMs?: number;
  liveThresholdMs?: number;
}

const DEFAULT_DEBOUNCE_MS = 500;
const DEFAULT_POLL_MS = 30_000;
const DEFAULT_LIVE_THRESHOLD_MS = 5 * 60 * 1000;

export class PiSessionWatcher {
  private readonly logger: Logger;
  private readonly agentManager: AgentManager;
  private readonly agentStorage: AgentStorage;
  private readonly workspaceProvisioning?: Pick<
    WorkspaceProvisioningService,
    "runInImportWorkspace"
  >;
  private readonly broadcast?: (message: unknown) => void;
  private readonly debounceMs: number;
  private readonly pollIntervalMs: number;
  private readonly liveThresholdMs: number;

  private sessionsDir: string | null = null;
  private watchers: FSWatcher[] = [];
  private debounceTimer: NodeJS.Timeout | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private handling = false;
  private stopped = false;
  private knownImportableHandles = new Set<string>();
  private lastPollHandles = new Set<string>();

  constructor(options: PiSessionWatcherOptions) {
    this.logger = options.logger.child({ module: "pi-session-watcher" });
    this.agentManager = options.agentManager;
    this.agentStorage = options.agentStorage;
    this.workspaceProvisioning = options.workspaceProvisioning;
    this.broadcast = options.broadcast;
    this.debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_MS;
    this.liveThresholdMs = options.liveThresholdMs ?? DEFAULT_LIVE_THRESHOLD_MS;
  }

  async start(): Promise<void> {
    this.stopped = false;
    this.sessionsDir = await resolvePiSessionsDir({});
    this.logger.info({ sessionsDir: this.sessionsDir }, "Starting Pi session watcher");

    // Ensure directory exists before watching; walkJsonlFiles handles missing gracefully
    try {
      await this.setupWatchers(this.sessionsDir);
    } catch (error) {
      this.logger.warn({ err: error, sessionsDir: this.sessionsDir }, "Failed to setup Pi watcher");
    }

    this.pollTimer = setInterval(() => {
      void this.handleChange("poll");
    }, this.pollIntervalMs);
    (this.pollTimer as unknown as { unref?: () => void }).unref?.();

    // Initial scan
    await this.handleChange("initial");
  }

  stop(): void {
    this.stopped = true;
    for (const w of this.watchers) {
      try {
        w.close();
      } catch {}
    }
    this.watchers = [];
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private async setupWatchers(root: string): Promise<void> {
    // Try recursive watch first (Windows supports it, Linux ignores or errors)
    try {
      const watcher = watch(root, { recursive: true }, () => this.scheduleDebounced());
      watcher.on("error", (err) => {
        this.logger.warn({ err, root }, "Pi watcher error, falling back to poll + shallow watch");
        void this.fallbackToShallowWatch(root);
      });
      this.watchers.push(watcher);
      // Test if recursive actually works by checking if watcher is closed immediately? On Linux, recursive true may throw.
      // If not thrown, we consider it success.
      this.logger.debug({ root }, "Pi watcher recursive watch established");
      return;
    } catch (error) {
      this.logger.debug({ err: error, root }, "Recursive watch failed, using shallow fallback");
    }
    await this.fallbackToShallowWatch(root);
  }

  private async fallbackToShallowWatch(root: string): Promise<void> {
    // Clear existing watchers except primary if any
    for (const w of this.watchers) {
      try {
        w.close();
      } catch {}
    }
    this.watchers = [];

    // Watch root non-recursive
    try {
      const rootWatcher = watch(root, () => this.scheduleDebounced());
      rootWatcher.on("error", (err) => this.logger.warn({ err }, "Root watcher error"));
      this.watchers.push(rootWatcher);
    } catch {}

    // Watch each immediate subdirectory (encoded-cwd dirs) non-recursive
    try {
      const entries = await readdir(root, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const sub = path.join(root, entry.name);
        try {
          const subWatcher = watch(sub, () => this.scheduleDebounced());
          subWatcher.on("error", () => {});
          this.watchers.push(subWatcher);
        } catch {}
        // Also watch one level deeper if needed (pi may nest under encoded cwd + session subfolder? but walkJsonlFiles recurses arbitrarily)
        // For safety, watch second level too
        try {
          const subEntries = await readdir(sub, { withFileTypes: true });
          for (const se of subEntries) {
            if (!se.isDirectory()) continue;
            const deep = path.join(sub, se.name);
            try {
              const deepWatcher = watch(deep, () => this.scheduleDebounced());
              deepWatcher.on("error", () => {});
              this.watchers.push(deepWatcher);
            } catch {}
          }
        } catch {}
      }
    } catch {}
    this.logger.debug(
      { root, watchCount: this.watchers.length },
      "Pi shallow watchers established",
    );
  }

  private scheduleDebounced(): void {
    if (this.stopped) return;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.handleChange("fs");
    }, this.debounceMs);
  }

  private async handleChange(reason: string): Promise<void> {
    if (this.handling || this.stopped) return;
    this.handling = true;
    try {
      this.logger.trace({ reason }, "Pi watcher handling change");
      const sessions = await this.agentManager.listImportableSessions({
        limit: 20,
        providerFilter: new Set(["pi"]),
      });

      const currentHandles = new Set(sessions.map((s) => s.providerHandleId));
      const newHandles = sessions.filter(
        (s) => !this.knownImportableHandles.has(s.providerHandleId),
      );

      // Update known set
      this.knownImportableHandles = currentHandles;

      // Broadcast if new sessions detected or poll reason with change
      const hasNew = newHandles.length > 0;
      const pollChanged = reason === "poll" && !setsEqual(this.lastPollHandles, currentHandles);
      this.lastPollHandles = new Set(currentHandles);

      if (hasNew || pollChanged) {
        this.logger.info(
          { reason, newCount: newHandles.length, total: sessions.length },
          "Pi sessions changed",
        );
        // Broadcast recent_provider_sessions_changed to all clients if broadcaster available
        if (this.broadcast) {
          try {
            this.broadcast({
              type: "recent_provider_sessions_changed",
              payload: {
                provider: "pi",
                count: sessions.length,
                newCount: newHandles.length,
              },
            });
          } catch (error) {
            this.logger.warn({ err: error }, "Failed to broadcast pi sessions changed");
          }
        }
      }

      // Auto-import live sessions (mtime < 5min)
      if (this.workspaceProvisioning) {
        const now = Date.now();
        for (const s of newHandles) {
          const ageMs = now - s.lastActivityAt.getTime();
          if (ageMs > this.liveThresholdMs) continue;
          // Check if already imported (race with storage)
          const alreadyImported = await this.isAlreadyImported(s.providerHandleId);
          if (alreadyImported) continue;
          this.logger.info(
            { handle: s.providerHandleId, cwd: s.cwd, ageMs },
            "Auto-importing live Pi session",
          );
          try {
            await this.autoImportSession(s);
          } catch (error) {
            this.logger.warn(
              { err: error, handle: s.providerHandleId },
              "Failed to auto-import live Pi session",
            );
          }
        }
      } else if (hasNew) {
        // Without workspace provisioning, log that auto-import skipped
        this.logger.debug("Skipping auto-import: no workspace provisioning available");
      }
    } catch (error) {
      this.logger.warn({ err: error }, "Pi watcher handleChange failed");
    } finally {
      this.handling = false;
    }
  }

  private async isAlreadyImported(providerHandleId: string): Promise<boolean> {
    const records = await this.agentStorage.list();
    return records.some(
      (r) =>
        !r.archivedAt &&
        r.persistence?.provider === "pi" &&
        (r.persistence.sessionId === providerHandleId ||
          r.persistence.nativeHandle === providerHandleId),
    );
  }

  private async autoImportSession(session: {
    providerHandleId: string;
    cwd: string;
  }): Promise<void> {
    if (!this.workspaceProvisioning) return;
    const requestId = randomUUID();
    await importProviderSession({
      request: {
        provider: "pi",
        providerHandleId: session.providerHandleId,
        cwd: session.cwd,
        requestId,
      },
      workspaceProvisioning: this.workspaceProvisioning,
      agentManager: this.agentManager,
      agentStorage: this.agentStorage,
      logger: this.logger,
    });
  }
}

function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}
