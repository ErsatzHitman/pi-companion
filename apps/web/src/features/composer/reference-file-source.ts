/**
 * `@file` reference listing for the composer (T389).
 *
 * Plan.md §12.4 says the frontend must never touch a laptop path itself:
 * every directory read goes through the daemon's `listDirectory` RPC. This
 * module turns that existing port (`features/files/file-browser-client.ts`,
 * whose `FileBrowserClient` a real `DaemonClient` already satisfies
 * structurally) into a bounded, cached `ReferenceFileSource` the
 * platform-neutral reference model can consume.
 *
 * It is deliberately *not* a second search implementation: the walk reuses
 * the same shape `use-file-search.ts` already established — breadth-first
 * from the workspace root, every dequeued path through
 * `authorizeWorkspacePath` before `listDirectory` is called — but with its
 * own, smaller caps, because the `@` list is a completion menu rather than
 * a search panel. A source that cannot list anything (no connection, an
 * unauthorized root) resolves to an empty list; core never fabricates a
 * path to fill the gap.
 */
import { composer as coreComposer } from "@picompanion/frontend-core";

import type { FileBrowserClient } from "../files/file-browser-client.js";
import { authorizeWorkspacePath } from "../files/path-authorization.js";

/** Maximum file candidates a single walk collects before it stops early. */
export const REFERENCE_FILE_MAX_RESULTS = 200;
/** Maximum directories a single walk lists before it stops early. */
export const REFERENCE_FILE_MAX_DIRECTORIES = 60;

export interface ReferenceFileSourceOptions {
  /** The daemon-side workspace root (protocol `cwd`). Defaults to the workspace root itself (`""`). */
  workspaceRoot?: string;
  /** Overridable for tests; defaults to `REFERENCE_FILE_MAX_RESULTS`. */
  maxResults?: number;
  /** Overridable for tests; defaults to `REFERENCE_FILE_MAX_DIRECTORIES`. */
  maxDirectories?: number;
}

/**
 * Builds a lazily-loaded, cached `ReferenceFileSource` over `client`. The
 * first `listFiles()` walks the workspace; later calls over the same source
 * reuse that result, so opening the `@` list repeatedly costs one walk.
 */
export function createReferenceFileSource(
  client: FileBrowserClient,
  options: ReferenceFileSourceOptions = {},
): coreComposer.ReferenceFileSource {
  const workspaceRoot = options.workspaceRoot ?? "";
  const maxResults = options.maxResults ?? REFERENCE_FILE_MAX_RESULTS;
  const maxDirectories = options.maxDirectories ?? REFERENCE_FILE_MAX_DIRECTORIES;
  let cache: Promise<readonly coreComposer.ReferenceCandidate[]> | null = null;

  async function walk(): Promise<readonly coreComposer.ReferenceCandidate[]> {
    const queue: string[] = [""];
    const results: coreComposer.ReferenceCandidate[] = [];
    let visited = 0;

    while (queue.length > 0 && results.length < maxResults && visited < maxDirectories) {
      const directoryPath = queue.shift() as string;
      let authorized: string;
      try {
        authorized = authorizeWorkspacePath(directoryPath).path;
      } catch {
        // An unauthorized entry is skipped, never handed to the client.
        continue;
      }

      let directory;
      try {
        // eslint-disable-next-line no-await-in-loop -- sequential by design: bounds request volume.
        directory = await client.listDirectory(workspaceRoot, authorized);
      } catch {
        // One unreadable subtree (permission, race) must not hide the rest.
        continue;
      }
      visited += 1;

      for (const entry of directory.entries) {
        if (entry.kind === "directory") {
          queue.push(entry.path);
        } else if (results.length < maxResults) {
          results.push({ kind: "file", id: entry.path, label: entry.path });
        }
      }
    }

    return results;
  }

  return {
    listFiles(): Promise<readonly coreComposer.ReferenceCandidate[]> {
      cache ??= walk();
      return cache;
    },
  };
}
