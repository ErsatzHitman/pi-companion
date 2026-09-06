import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { axe } from "jest-axe";
import { afterEach, describe, expect, it } from "vitest";

import type {
  FileBrowserClient,
  FileBrowserDirectory,
  FileBrowserEntry,
} from "./file-browser-client.js";
import { FileSearchPanel } from "./file-search-panel.js";
import { FILE_SEARCH_MAX_RESULTS } from "./use-file-search.js";

afterEach(cleanup);

function entry(path: string, kind: FileBrowserEntry["kind"] = "file"): FileBrowserEntry {
  const name = path.split("/").at(-1) as string;
  return { name, path, kind, size: 12, modifiedAt: "2026-01-01T00:00:00.000Z" };
}

function treeClient(tree: Record<string, FileBrowserEntry[]>): FileBrowserClient {
  return {
    listDirectory: async (_cwd: string, path: string): Promise<FileBrowserDirectory> => {
      const entries = tree[path];
      if (entries === undefined) throw new Error(`ENOENT: no such directory '${path}'`);
      return { path, entries };
    },
  };
}

/**
 * Mounts `FileSearchPanel` under the same `/files/*` route its result
 * links target, plus a second, distinguishable route to land on, so a
 * click can be proven to actually navigate (not just render a link).
 */
function renderPanel(client: FileBrowserClient) {
  const rootRoute = createRootRoute();
  const filesRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/h/$serverId/session/$agentId/files/$",
    component: () => {
      const { serverId, agentId } = filesRoute.useParams();
      return (
        <div>
          <span data-testid="on-files-route">files</span>
          <FileSearchPanel
            serverId={serverId}
            agentId={agentId}
            workspaceRoot="/workspace"
            client={client}
          />
        </div>
      );
    },
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([filesRoute]),
    history: createMemoryHistory({ initialEntries: ["/h/host-1/session/agent-1/files"] }),
  });
  const result = render(<RouterProvider router={router} />);
  return { ...result, router };
}

async function renderReadyPanel(client: FileBrowserClient) {
  const rendered = renderPanel(client);
  await screen.findByTestId("on-files-route");
  return rendered;
}

describe("FileSearchPanel (T30B5)", () => {
  it("renders no results section until a query is typed", async () => {
    await renderReadyPanel(treeClient({ "": [entry("README.md")] }));

    expect(screen.queryByRole("list")).toBeNull();
    expect(screen.queryByTestId("file-search-empty")).toBeNull();
  });

  it("returns results and navigates to a hit", async () => {
    const client = treeClient({
      "": [entry("src", "directory"), entry("README.md")],
      src: [entry("src/notes.ts")],
    });
    const { router } = await renderReadyPanel(client);
    const user = userEvent.setup();

    await user.type(screen.getByTestId("file-search-field"), "notes");

    const hit = await screen.findByTestId("file-search-result-src/notes.ts");
    expect(hit.textContent).toContain("src/notes.ts");
    expect(hit.getAttribute("href")).toBe("/h/host-1/session/agent-1/files/src/notes.ts");

    await user.click(hit);
    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/h/host-1/session/agent-1/files/src/notes.ts"),
    );
  });

  it("shows an explicit no-match state for a query with no hits", async () => {
    const client = treeClient({ "": [entry("README.md")] });
    await renderReadyPanel(client);
    const user = userEvent.setup();

    await user.type(screen.getByTestId("file-search-field"), "nope");

    const empty = await screen.findByTestId("file-search-empty");
    expect(empty.textContent).toMatch(/no matches/i);
  });

  it("bounds the result count with an explicit truncation notice", async () => {
    const many = Array.from({ length: FILE_SEARCH_MAX_RESULTS + 5 }, (_, i) =>
      entry(`match-${String(i).padStart(3, "0")}.txt`),
    );
    const client = treeClient({ "": many });
    await renderReadyPanel(client);
    const user = userEvent.setup();

    await user.type(screen.getByTestId("file-search-field"), "match");

    const notice = await screen.findByTestId("file-search-truncated");
    expect(notice.textContent).toMatch(/first \d+ matches/i);
    expect(screen.getAllByRole("link")).toHaveLength(FILE_SEARCH_MAX_RESULTS);
  });

  it("surfaces a search error and recovers via retry", async () => {
    let attempt = 0;
    const client: FileBrowserClient = {
      listDirectory: async (_cwd, path) => {
        attempt += 1;
        if (attempt === 1) throw new Error("EACCES: permission denied, scandir '/workspace'");
        return { path, entries: [entry("README.md")] };
      },
    };
    await renderReadyPanel(client);
    const user = userEvent.setup();

    await user.type(screen.getByTestId("file-search-field"), "readme");

    const error = await screen.findByTestId("file-search-error");
    expect(error.textContent).toMatch(/permission/i);

    await user.click(screen.getByRole("button", { name: "Retry search" }));
    await screen.findByTestId("file-search-result-README.md");
  });

  it("is keyboard operable: type via the field and Tab to a focusable, activatable hit", async () => {
    const client = treeClient({ "": [entry("README.md")] });
    await renderReadyPanel(client);
    const user = userEvent.setup();

    const field = screen.getByTestId("file-search-field");
    field.focus();
    await user.keyboard("readme");

    const hit = await screen.findByTestId("file-search-result-README.md");
    await user.tab();
    expect(document.activeElement).toBe(hit);
  });

  it("has an accessible name on the search field even though it is visually unlabelled", async () => {
    await renderReadyPanel(treeClient({ "": [] }));
    expect(screen.getByRole("searchbox", { name: "Search files by name" })).toBeTruthy();
  });

  it("has no axe violations idle, with results, empty, or truncated", async () => {
    const many = Array.from({ length: FILE_SEARCH_MAX_RESULTS + 5 }, (_, i) =>
      entry(`match-${String(i).padStart(3, "0")}.txt`),
    );
    const client = treeClient({ "": many });
    const { container } = await renderReadyPanel(client);
    expect(await axe(container)).toHaveNoViolations();

    const user = userEvent.setup();
    await user.type(screen.getByTestId("file-search-field"), "match");
    await screen.findByTestId("file-search-truncated");
    expect(await axe(container)).toHaveNoViolations();

    await user.clear(screen.getByTestId("file-search-field"));
    await user.type(screen.getByTestId("file-search-field"), "zzz-nope");
    await screen.findByTestId("file-search-empty");
    expect(await axe(container)).toHaveNoViolations();
  }, 20_000);
});
