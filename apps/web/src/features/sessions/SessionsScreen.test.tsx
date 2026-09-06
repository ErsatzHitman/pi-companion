import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { axe } from "jest-axe";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SessionsScreen } from "./SessionsScreen.js";
import type { SessionsScreenProps } from "./SessionsScreen.js";
import type { DiscoveredSession, DiscoveredSessionsClient } from "./discovered-sessions-client.js";
import type { SessionsClient } from "./sessions-client.js";
import type { SessionSummary } from "./types.js";

afterEach(cleanup);

const EXISTING_SESSION: SessionSummary = {
  id: "s-existing",
  title: "Refactor router",
  provider: "pi",
  cwd: "/repo/existing",
  status: "idle",
  updatedAt: "2026-01-02T00:00:00.000Z",
};

function renderSessionsScreenAt(props: Omit<SessionsScreenProps, "serverId">) {
  const rootRoute = createRootRoute();
  const sessionsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/h/$serverId/sessions",
    component: () => {
      const { serverId } = sessionsRoute.useParams();
      return <SessionsScreen serverId={serverId} {...props} />;
    },
  });
  const sessionRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/h/$serverId/session/$agentId",
    component: () => {
      const { serverId, agentId } = sessionRoute.useParams();
      return <div data-testid="opened-session">{`${serverId}/${agentId}`}</div>;
    },
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([sessionsRoute, sessionRoute]),
    history: createMemoryHistory({ initialEntries: ["/h/host-1/sessions"] }),
  });
  const result = render(<RouterProvider router={router} />);
  return { ...result, router };
}

describe("SessionsScreen (T27B2)", () => {
  it("creating a session round-trips through the injected client and opens it", async () => {
    const created: SessionSummary = {
      id: "s-new",
      title: null,
      provider: "pi",
      cwd: "/repo/new",
      status: "initializing",
      updatedAt: "2026-02-01T00:00:00.000Z",
    };
    const createSession = vi.fn(async () => created);
    const client: SessionsClient = { createSession };
    const { router } = renderSessionsScreenAt({
      client,
      initialState: { kind: "ready", sessions: [] },
    });
    const user = userEvent.setup();

    await user.click(await screen.findByTestId("create-session-trigger"));
    await user.type(screen.getByTestId("create-session-cwd-field"), "/repo/new");
    await user.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() =>
      expect(createSession).toHaveBeenCalledWith({ provider: "pi", cwd: "/repo/new" }),
    );
    await waitFor(() => expect(router.state.location.pathname).toBe("/h/host-1/session/s-new"));
    expect(screen.getByTestId("opened-session").textContent).toBe("host-1/s-new");
  });

  it("opening an existing session navigates and loads its timeline route", async () => {
    const client: SessionsClient = { createSession: vi.fn() };
    const { router } = renderSessionsScreenAt({
      client,
      initialState: { kind: "ready", sessions: [EXISTING_SESSION] },
    });
    const user = userEvent.setup();

    await user.click(await screen.findByTestId(`session-row-${EXISTING_SESSION.id}`));

    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/h/host-1/session/s-existing"),
    );
    expect(screen.getByTestId("opened-session").textContent).toBe("host-1/s-existing");
  });

  it("a failed create surfaces an error and keeps the typed working directory", async () => {
    const createSession = vi.fn(async () => {
      throw new Error("cwd is required");
    });
    const client: SessionsClient = { createSession };
    const { router } = renderSessionsScreenAt({
      client,
      initialState: { kind: "ready", sessions: [] },
    });
    const user = userEvent.setup();

    await user.click(await screen.findByTestId("create-session-trigger"));
    const cwdField = screen.getByTestId("create-session-cwd-field") as HTMLInputElement;
    await user.type(cwdField, "/repo/typed-value");
    await user.click(screen.getByRole("button", { name: "Create" }));

    const banner = await screen.findByTestId("create-session-error-banner");
    expect(banner.textContent).toMatch(/missing session details/i);
    expect(cwdField.value).toBe("/repo/typed-value");
    // The dialog stays open and the URL never changes on a failed create.
    expect(screen.getByTestId("create-session-dialog")).toBeTruthy();
    expect(router.state.location.pathname).toBe("/h/host-1/sessions");
  });

  it("rejects an empty working directory without calling the client", async () => {
    const createSession = vi.fn();
    const client: SessionsClient = { createSession };
    renderSessionsScreenAt({ client, initialState: { kind: "ready", sessions: [] } });
    const user = userEvent.setup();

    await user.click(await screen.findByTestId("create-session-trigger"));
    await user.click(screen.getByRole("button", { name: "Create" }));

    expect(await screen.findByText(/enter a working directory/i)).toBeTruthy();
    expect(createSession).not.toHaveBeenCalled();
  });

  describe("reconnect and gap recovery (T27B6)", () => {
    it("reconciles the list against the daemon on connect without duplicating the seeded row", async () => {
      const fetchSessions = vi.fn(async () => [
        { ...EXISTING_SESSION, status: "running" as const },
      ]);
      const client: SessionsClient = { createSession: vi.fn(), fetchSessions };
      renderSessionsScreenAt({
        client,
        initialState: { kind: "ready", sessions: [EXISTING_SESSION] },
        connectionState: "connected",
      });

      await waitFor(() => expect(fetchSessions).toHaveBeenCalledTimes(1));
      await waitFor(() =>
        expect(screen.getByTestId(`session-row-${EXISTING_SESSION.id}`).textContent).toContain(
          "Running",
        ),
      );
      // Exactly one row for the session — reconciliation never duplicates it.
      expect(screen.getAllByTestId(`session-row-${EXISTING_SESSION.id}`)).toHaveLength(1);
      expect(screen.queryByTestId("session-list-stale-banner")).toBeNull();
    });

    it("marks the rail stale rather than silently current while disconnected", async () => {
      const client: SessionsClient = { createSession: vi.fn() };
      renderSessionsScreenAt({
        client,
        initialState: { kind: "ready", sessions: [EXISTING_SESSION] },
        connectionState: "disconnected",
      });

      const banner = await screen.findByTestId("session-list-stale-banner");
      expect(banner.textContent).toMatch(/reconnecting/i);
      // The known row still renders underneath the banner.
      expect(screen.getByTestId(`session-row-${EXISTING_SESSION.id}`)).toBeTruthy();
    });
  });

  it("has no axe violations with the create dialog open", async () => {
    const client: SessionsClient = { createSession: vi.fn() };
    const { container } = renderSessionsScreenAt({
      client,
      initialState: { kind: "ready", sessions: [EXISTING_SESSION] },
    });
    const user = userEvent.setup();

    await user.click(await screen.findByTestId("create-session-trigger"));
    await screen.findByTestId("create-session-dialog");

    expect(await axe(container)).toHaveNoViolations();
  }, 20_000);

  describe("archive and delete (T27B4)", () => {
    it("archives a session against the injected client and reconciles the optimistic timestamp", async () => {
      let resolveArchive!: (result: { archivedAt: string }) => void;
      const archiveSession = vi.fn(
        () =>
          new Promise<{ archivedAt: string }>((resolve) => {
            resolveArchive = resolve;
          }),
      );
      const client: SessionsClient = { createSession: vi.fn(), archiveSession };
      renderSessionsScreenAt({
        client,
        initialState: { kind: "ready", sessions: [EXISTING_SESSION] },
      });
      const user = userEvent.setup();

      await user.click(
        await screen.findByTestId(`session-row-actions-trigger-${EXISTING_SESSION.id}`),
      );
      await user.click(screen.getByTestId(`session-row-archive-${EXISTING_SESSION.id}`));

      expect(archiveSession).toHaveBeenCalledWith(EXISTING_SESSION.id);
      // Optimistic: the session already reads as archived before the
      // daemon responds.
      await waitFor(() => expect(screen.getByRole("heading", { name: "Archived" })).toBeTruthy());

      resolveArchive({ archivedAt: "2026-05-01T00:00:00.000Z" });
      await waitFor(() => expect(screen.getByRole("heading", { name: "Archived" })).toBeTruthy());
      // The row survives reconciliation (still rendered, now archived).
      expect(screen.getByTestId(`session-row-${EXISTING_SESSION.id}`)).toBeTruthy();
    });

    it("rolls an archive failure back and shows a toast, leaving the session live", async () => {
      const archiveSession = vi.fn(async () => {
        throw new Error("agent is closed");
      });
      const client: SessionsClient = { createSession: vi.fn(), archiveSession };
      renderSessionsScreenAt({
        client,
        initialState: { kind: "ready", sessions: [EXISTING_SESSION] },
      });
      const user = userEvent.setup();

      await user.click(
        await screen.findByTestId(`session-row-actions-trigger-${EXISTING_SESSION.id}`),
      );
      await user.click(screen.getByTestId(`session-row-archive-${EXISTING_SESSION.id}`));

      const toast = await screen.findByTestId("sessions-action-error-toast");
      expect(toast.textContent).toMatch(/agent is closed/i);
      // Rolled back: the session is no longer grouped under "Archived".
      await waitFor(() => expect(screen.queryByRole("heading", { name: "Archived" })).toBeNull());
    });

    it("deleting a session requires an explicit confirmation before the client is called", async () => {
      const deleteSession = vi.fn(async () => undefined);
      const client: SessionsClient = { createSession: vi.fn(), deleteSession };
      renderSessionsScreenAt({
        client,
        initialState: { kind: "ready", sessions: [EXISTING_SESSION] },
      });
      const user = userEvent.setup();

      await user.click(
        await screen.findByTestId(`session-row-actions-trigger-${EXISTING_SESSION.id}`),
      );
      await user.click(screen.getByTestId(`session-row-delete-${EXISTING_SESSION.id}`));

      const dialog = await screen.findByTestId("delete-session-dialog");
      expect(dialog.getAttribute("role")).toBe("alertdialog");
      expect(deleteSession).not.toHaveBeenCalled();
      // The row is still present: nothing happens until the user confirms.
      expect(screen.getByTestId(`session-row-${EXISTING_SESSION.id}`)).toBeTruthy();

      await user.click(within(dialog).getByRole("button", { name: "Delete" }));

      expect(deleteSession).toHaveBeenCalledWith(EXISTING_SESSION.id);
      await waitFor(() =>
        expect(screen.queryByTestId(`session-row-${EXISTING_SESSION.id}`)).toBeNull(),
      );
      expect(screen.queryByTestId("delete-session-dialog")).toBeNull();
    });

    it("cancelling the delete confirmation leaves the session untouched", async () => {
      const deleteSession = vi.fn();
      const client: SessionsClient = { createSession: vi.fn(), deleteSession };
      renderSessionsScreenAt({
        client,
        initialState: { kind: "ready", sessions: [EXISTING_SESSION] },
      });
      const user = userEvent.setup();

      await user.click(
        await screen.findByTestId(`session-row-actions-trigger-${EXISTING_SESSION.id}`),
      );
      await user.click(screen.getByTestId(`session-row-delete-${EXISTING_SESSION.id}`));
      const dialog = await screen.findByTestId("delete-session-dialog");

      await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

      expect(screen.queryByTestId("delete-session-dialog")).toBeNull();
      expect(deleteSession).not.toHaveBeenCalled();
      expect(screen.getByTestId(`session-row-${EXISTING_SESSION.id}`)).toBeTruthy();
    });

    it("re-inserts the session and shows a toast when a confirmed delete fails", async () => {
      const deleteSession = vi.fn(async () => {
        throw new Error("Agent not found: s-existing");
      });
      const client: SessionsClient = { createSession: vi.fn(), deleteSession };
      renderSessionsScreenAt({
        client,
        initialState: { kind: "ready", sessions: [EXISTING_SESSION] },
      });
      const user = userEvent.setup();

      await user.click(
        await screen.findByTestId(`session-row-actions-trigger-${EXISTING_SESSION.id}`),
      );
      await user.click(screen.getByTestId(`session-row-delete-${EXISTING_SESSION.id}`));
      const dialog = await screen.findByTestId("delete-session-dialog");
      await user.click(within(dialog).getByRole("button", { name: "Delete" }));

      // The session is briefly removed optimistically (proven directly,
      // with a controlled/deferred client, by `use-session-actions.test.ts`);
      // here, once the rejected `deleteSession` call settles, it is
      // re-inserted with a visible error.
      const toast = await screen.findByTestId("sessions-action-error-toast");
      expect(toast.textContent).toMatch(/already been removed/i);
      await waitFor(() =>
        expect(screen.getByTestId(`session-row-${EXISTING_SESSION.id}`)).toBeTruthy(),
      );
    });

    it("has no axe violations with the delete-confirmation dialog open", async () => {
      const client: SessionsClient = { createSession: vi.fn(), deleteSession: vi.fn() };
      const { container } = renderSessionsScreenAt({
        client,
        initialState: { kind: "ready", sessions: [EXISTING_SESSION] },
      });
      const user = userEvent.setup();

      await user.click(
        await screen.findByTestId(`session-row-actions-trigger-${EXISTING_SESSION.id}`),
      );
      await user.click(screen.getByTestId(`session-row-delete-${EXISTING_SESSION.id}`));
      await screen.findByTestId("delete-session-dialog");

      expect(await axe(container)).toHaveNoViolations();
    }, 20_000);
  });

  describe("fork and clone, and the mounted session tree (T38A3)", () => {
    it("renders the real SessionTree on this screen with the existing session as a root — not merely registered in the barrel", async () => {
      const client: SessionsClient = { createSession: vi.fn() };
      renderSessionsScreenAt({
        client,
        initialState: { kind: "ready", sessions: [EXISTING_SESSION] },
      });

      // This is the mounting proof T38A2 was missing: the tree is found
      // by rendering the real screen, not by asserting on source text or
      // on the barrel's export list.
      const tree = await screen.findByRole("tree");
      expect(tree).toBeTruthy();
      expect(within(tree).getByText(EXISTING_SESSION.title!)).toBeTruthy();
    });

    it("forking a session round-trips through the injected client and places the new session under its parent in the tree", async () => {
      const forked: SessionSummary = {
        id: "s-forked",
        title: "Branch A",
        provider: "pi",
        cwd: "/repo/existing",
        status: "idle",
        updatedAt: "2026-01-03T00:00:00.000Z",
      };
      const forkSession = vi.fn(async () => ({
        session: forked,
        forkPoint: { messageId: "tip", index: 0 },
      }));
      const client: SessionsClient = { createSession: vi.fn(), forkSession };
      renderSessionsScreenAt({
        client,
        initialState: { kind: "ready", sessions: [EXISTING_SESSION] },
      });
      const user = userEvent.setup();

      await user.click(
        await screen.findByTestId(`session-row-actions-trigger-${EXISTING_SESSION.id}`),
      );
      await user.click(screen.getByTestId(`session-row-fork-${EXISTING_SESSION.id}`));

      expect(forkSession).toHaveBeenCalledWith(EXISTING_SESSION.id, {
        entryId: "tip",
        entryIndex: 0,
      });

      // New session appears in the plain list...
      await screen.findByTestId(`session-row-${forked.id}`);

      // ...and, specifically, nested one level under its parent in the
      // rendered tree (the acceptance criterion "the new session appears
      // in the tree in the right place" — proved by DOM structure, not
      // just presence).
      const tree = screen.getByRole("tree");
      const parentItem = within(tree).getByTestId(`session-tree-item-${EXISTING_SESSION.id}`);
      const childItem = within(tree).getByTestId(`session-tree-item-${forked.id}`);
      expect(parentItem.getAttribute("aria-level")).toBe("1");
      expect(childItem.getAttribute("aria-level")).toBe("2");
      expect(within(tree).getByTestId(`session-tree-kind-${forked.id}`).textContent).toBe("fork");
    });

    it("cloning a session round-trips through the injected client and places the new session as its own root in the tree", async () => {
      const cloned: SessionSummary = {
        id: "s-cloned",
        title: "Copy",
        provider: "pi",
        cwd: "/repo/existing",
        status: "idle",
        updatedAt: "2026-01-03T00:00:00.000Z",
      };
      const cloneSession = vi.fn(async () => ({ session: cloned }));
      const client: SessionsClient = { createSession: vi.fn(), cloneSession };
      renderSessionsScreenAt({
        client,
        initialState: { kind: "ready", sessions: [EXISTING_SESSION] },
      });
      const user = userEvent.setup();

      await user.click(
        await screen.findByTestId(`session-row-actions-trigger-${EXISTING_SESSION.id}`),
      );
      await user.click(screen.getByTestId(`session-row-clone-${EXISTING_SESSION.id}`));

      expect(cloneSession).toHaveBeenCalledWith(EXISTING_SESSION.id, undefined);

      await screen.findByTestId(`session-row-${cloned.id}`);

      const tree = screen.getByRole("tree");
      const clonedItem = within(tree).getByTestId(`session-tree-item-${cloned.id}`);
      // A clone is its own root: level 1, same as the source, never
      // nested under it (`tree.ts`'s "a clone is a different tree by
      // design" rule, mirrored here through the whole stack).
      expect(clonedItem.getAttribute("aria-level")).toBe("1");
      expect(within(tree).getByTestId(`session-tree-kind-${cloned.id}`).textContent).toBe("clone");
    });

    it("a failed fork leaves the original session's row and tree position untouched and shows a toast", async () => {
      const forkSession = vi.fn(async () => {
        throw new Error("cannot fork a session while it is initializing");
      });
      const client: SessionsClient = { createSession: vi.fn(), forkSession };
      renderSessionsScreenAt({
        client,
        initialState: { kind: "ready", sessions: [EXISTING_SESSION] },
      });
      const user = userEvent.setup();

      const treeBefore = await screen.findByRole("tree");
      const originalItemBefore = within(treeBefore).getByTestId(
        `session-tree-item-${EXISTING_SESSION.id}`,
      );
      const originalHtmlBefore = originalItemBefore.outerHTML;

      await user.click(screen.getByTestId(`session-row-actions-trigger-${EXISTING_SESSION.id}`));
      await user.click(screen.getByTestId(`session-row-fork-${EXISTING_SESSION.id}`));

      const toast = await screen.findByTestId("sessions-action-error-toast");
      expect(toast.textContent).toMatch(/cannot fork a session while it is initializing/i);

      // The original's row and its tree entry are exactly as they were:
      // no new row, no new tree item, no change to the existing one.
      expect(screen.getAllByTestId(`session-row-${EXISTING_SESSION.id}`)).toHaveLength(1);
      const tree = screen.getByRole("tree");
      expect(within(tree).getAllByTestId(`session-tree-item-${EXISTING_SESSION.id}`)).toHaveLength(
        1,
      );
      expect(within(tree).getByTestId(`session-tree-item-${EXISTING_SESSION.id}`).outerHTML).toBe(
        originalHtmlBefore,
      );
    });

    it("a failed clone leaves the original session's row and tree position untouched and shows a toast", async () => {
      const cloneSession = vi.fn(async () => {
        throw new Error("host is full");
      });
      const client: SessionsClient = { createSession: vi.fn(), cloneSession };
      renderSessionsScreenAt({
        client,
        initialState: { kind: "ready", sessions: [EXISTING_SESSION] },
      });
      const user = userEvent.setup();

      await user.click(
        await screen.findByTestId(`session-row-actions-trigger-${EXISTING_SESSION.id}`),
      );
      await user.click(screen.getByTestId(`session-row-clone-${EXISTING_SESSION.id}`));

      const toast = await screen.findByTestId("sessions-action-error-toast");
      expect(toast.textContent).toMatch(/host is full/i);

      expect(screen.getAllByTestId(`session-row-${EXISTING_SESSION.id}`)).toHaveLength(1);
      const tree = screen.getByRole("tree");
      expect(within(tree).getAllByTestId(`session-tree-item-${EXISTING_SESSION.id}`)).toHaveLength(
        1,
      );
    });

    it("still offers Fork and Clone when the injected client does not implement them, and surfaces the unsupported error through the toast instead of silently doing nothing", async () => {
      const client: SessionsClient = { createSession: vi.fn() };
      renderSessionsScreenAt({
        client,
        initialState: { kind: "ready", sessions: [EXISTING_SESSION] },
      });
      const user = userEvent.setup();

      // Row actions are still offered (SessionsScreen always passes
      // onForkSession/onCloneSession — SessionRow renders the buttons
      // regardless; the *hook* is what falls back to
      // SESSIONS_ACTION_UNSUPPORTED when the client can't do it, proved
      // directly by `use-fork-clone-session.test.ts`), so clicking Fork
      // here surfaces that failure through the same toast path rather
      // than silently doing nothing.
      await user.click(
        await screen.findByTestId(`session-row-actions-trigger-${EXISTING_SESSION.id}`),
      );
      await user.click(screen.getByTestId(`session-row-fork-${EXISTING_SESSION.id}`));

      const toast = await screen.findByTestId("sessions-action-error-toast");
      expect(toast.textContent).toMatch(/can't fork sessions yet/i);
    });
  });

  describe("rename (T38A4)", () => {
    it("renaming a session round-trips through the injected client and updates the row", async () => {
      const renameSession = vi.fn(async (_id: string, input: { name: string }) => ({
        session: { ...EXISTING_SESSION, title: input.name },
      }));
      const client: SessionsClient = { createSession: vi.fn(), renameSession };
      renderSessionsScreenAt({
        client,
        initialState: { kind: "ready", sessions: [EXISTING_SESSION] },
      });
      const user = userEvent.setup();

      await user.click(
        await screen.findByTestId(`session-row-actions-trigger-${EXISTING_SESSION.id}`),
      );
      await user.click(screen.getByTestId(`session-row-rename-${EXISTING_SESSION.id}`));

      const dialog = await screen.findByTestId("rename-session-dialog");
      const field = within(dialog).getByTestId("rename-session-name-field");
      await user.clear(field);
      await user.type(field, "My new name");
      await user.click(within(dialog).getByRole("button", { name: "Rename" }));

      expect(renameSession).toHaveBeenCalledWith(EXISTING_SESSION.id, { name: "My new name" });
      await waitFor(() => expect(screen.queryByTestId("rename-session-dialog")).toBeNull());
      const row = screen.getByTestId(`session-row-${EXISTING_SESSION.id}`);
      expect(row.textContent).toContain("My new name");
    });

    it("a validation error is shown inline and never calls the client", async () => {
      const renameSession = vi.fn();
      const client: SessionsClient = { createSession: vi.fn(), renameSession };
      renderSessionsScreenAt({
        client,
        initialState: { kind: "ready", sessions: [EXISTING_SESSION] },
      });
      const user = userEvent.setup();

      await user.click(
        await screen.findByTestId(`session-row-actions-trigger-${EXISTING_SESSION.id}`),
      );
      await user.click(screen.getByTestId(`session-row-rename-${EXISTING_SESSION.id}`));

      const dialog = await screen.findByTestId("rename-session-dialog");
      const field = within(dialog).getByTestId("rename-session-name-field");
      await user.clear(field);
      await user.click(within(dialog).getByRole("button", { name: "Rename" }));

      expect(within(dialog).getByRole("alert").textContent).toBe("Enter a name for this session.");
      expect(renameSession).not.toHaveBeenCalled();
      // Still open: an invalid draft never closes the dialog.
      expect(screen.getByTestId("rename-session-dialog")).toBeTruthy();
    });

    it("a failed rename rolls the row back to its previous name and shows a toast", async () => {
      const renameSession = vi.fn(async () => {
        throw new Error("session is archived");
      });
      const client: SessionsClient = { createSession: vi.fn(), renameSession };
      renderSessionsScreenAt({
        client,
        initialState: { kind: "ready", sessions: [EXISTING_SESSION] },
      });
      const user = userEvent.setup();

      await user.click(
        await screen.findByTestId(`session-row-actions-trigger-${EXISTING_SESSION.id}`),
      );
      await user.click(screen.getByTestId(`session-row-rename-${EXISTING_SESSION.id}`));
      const dialog = await screen.findByTestId("rename-session-dialog");
      const field = within(dialog).getByTestId("rename-session-name-field");
      await user.clear(field);
      await user.type(field, "Attempted name");
      await user.click(within(dialog).getByRole("button", { name: "Rename" }));

      const toast = await screen.findByTestId("sessions-action-error-toast");
      expect(toast.textContent).toMatch(/session is archived/i);
      const row = await screen.findByTestId(`session-row-${EXISTING_SESSION.id}`);
      expect(row.textContent).toContain(EXISTING_SESSION.title);
      expect(row.textContent).not.toContain("Attempted name");
    });

    it("still offers Rename when the injected client does not implement it, and surfaces the unsupported error through the toast instead of silently doing nothing", async () => {
      const client: SessionsClient = { createSession: vi.fn() };
      renderSessionsScreenAt({
        client,
        initialState: { kind: "ready", sessions: [EXISTING_SESSION] },
      });
      const user = userEvent.setup();

      await user.click(
        await screen.findByTestId(`session-row-actions-trigger-${EXISTING_SESSION.id}`),
      );
      await user.click(screen.getByTestId(`session-row-rename-${EXISTING_SESSION.id}`));
      const dialog = await screen.findByTestId("rename-session-dialog");
      const field = within(dialog).getByTestId("rename-session-name-field");
      await user.clear(field);
      await user.type(field, "New name");
      await user.click(within(dialog).getByRole("button", { name: "Rename" }));

      const toast = await screen.findByTestId("sessions-action-error-toast");
      expect(toast.textContent).toMatch(/can't rename sessions yet/i);
    });

    it("a rename this client loses to a concurrent write elsewhere shows a plain, non-error notice once the next sync reveals it", async () => {
      let resolveFetch!: (sessions: SessionSummary[]) => void;
      const fetchSessions = vi.fn(
        () =>
          new Promise<SessionSummary[]>((resolve) => {
            resolveFetch = resolve;
          }),
      );
      const renameSession = vi.fn(async (_id: string, input: { name: string }) => ({
        session: { ...EXISTING_SESSION, title: input.name },
      }));
      const client: SessionsClient = { createSession: vi.fn(), fetchSessions, renameSession };
      renderSessionsScreenAt({
        client,
        initialState: { kind: "ready", sessions: [EXISTING_SESSION] },
        connectionState: "connected",
      });
      const user = userEvent.setup();

      // T27B6's reconcile-on-connect fetch is in flight when this
      // client submits its own rename — exactly the race
      // `use-rename-session.ts`'s module doc describes.
      await waitFor(() => expect(fetchSessions).toHaveBeenCalledTimes(1));

      await user.click(
        await screen.findByTestId(`session-row-actions-trigger-${EXISTING_SESSION.id}`),
      );
      await user.click(screen.getByTestId(`session-row-rename-${EXISTING_SESSION.id}`));
      const dialog = await screen.findByTestId("rename-session-dialog");
      const field = within(dialog).getByTestId("rename-session-name-field");
      await user.clear(field);
      await user.type(field, "My new name");
      await user.click(within(dialog).getByRole("button", { name: "Rename" }));

      await waitFor(() =>
        expect(renameSession).toHaveBeenCalledWith(EXISTING_SESSION.id, { name: "My new name" }),
      );
      const rowAfterSubmit = screen.getByTestId(`session-row-${EXISTING_SESSION.id}`);
      expect(rowAfterSubmit.textContent).toContain("My new name");

      // The in-flight reconcile now resolves, revealing another
      // client's later write actually won at the daemon.
      resolveFetch([{ ...EXISTING_SESSION, title: "Someone else's name" }]);

      const notice = await screen.findByTestId(
        `session-row-rename-superseded-${EXISTING_SESSION.id}`,
      );
      expect(notice.getAttribute("role")).toBe("status");
      expect(notice.textContent).toMatch(/my new name/i);
      expect(notice.textContent).toMatch(/someone else's name/i);
      // The row now shows the daemon's authoritative (winning) title...
      const row = screen.getByTestId(`session-row-${EXISTING_SESSION.id}`);
      expect(row.textContent).toContain("Someone else's name");
      // ...and this is never rendered as an error.
      expect(screen.queryByTestId("sessions-action-error-toast")).toBeNull();
    });
  });

  describe("discovery and import (T27B5)", () => {
    const DISCOVERED: DiscoveredSession = {
      providerId: "pi",
      providerLabel: "Pi",
      providerHandleId: "pi-terminal-handle-0001",
      cwd: "/repo/terminal-project",
      title: null,
      firstPromptPreview: "help me refactor this",
      lastPromptPreview: "run the tests",
      lastActivityAt: "2026-08-31T09:00:00.000Z",
    };
    const IMPORTED: SessionSummary = {
      id: "agt-imported-1",
      title: "Imported terminal session",
      provider: "pi",
      cwd: "/repo/terminal-project",
      status: "idle",
      updatedAt: "2026-08-31T09:05:00.000Z",
    };

    it("finds discovered sessions, listed distinctly from the imported session list", async () => {
      const client: SessionsClient = { createSession: vi.fn() };
      const discoveredClient: DiscoveredSessionsClient = {
        listDiscoveredSessions: vi.fn(async () => [DISCOVERED]),
        importSession: vi.fn(),
      };
      renderSessionsScreenAt({
        client,
        discoveredClient,
        initialState: { kind: "ready", sessions: [EXISTING_SESSION] },
      });
      const user = userEvent.setup();

      await user.click(await screen.findByTestId("discover-sessions-trigger"));

      const discoveredList = await screen.findByTestId("discovered-session-list");
      expect(
        within(discoveredList).getByTestId(`discovered-session-row-${DISCOVERED.providerHandleId}`),
      ).toBeTruthy();
      // The existing, already-imported session still renders in the
      // ordinary grouped list, not the discovered one.
      expect(within(discoveredList).queryByTestId(`session-row-${EXISTING_SESSION.id}`)).toBeNull();
      expect(screen.getByTestId(`session-row-${EXISTING_SESSION.id}`)).toBeTruthy();
    });

    it("imports a discovered terminal session, which then appears in the session list and can be opened", async () => {
      const client: SessionsClient = { createSession: vi.fn() };
      const importSession = vi.fn(async () => IMPORTED);
      const discoveredClient: DiscoveredSessionsClient = {
        listDiscoveredSessions: vi.fn(async () => [DISCOVERED]),
        importSession,
      };
      const { router } = renderSessionsScreenAt({
        client,
        discoveredClient,
        initialState: { kind: "ready", sessions: [] },
      });
      const user = userEvent.setup();

      await user.click(await screen.findByTestId("discover-sessions-trigger"));
      await user.click(
        await screen.findByTestId(`discovered-session-import-${DISCOVERED.providerHandleId}`),
      );

      expect(importSession).toHaveBeenCalledWith({
        providerId: "pi",
        providerHandleId: "pi-terminal-handle-0001",
        cwd: "/repo/terminal-project",
      });
      // Removed from "discovered" and now present, openable, in the
      // ordinary session list (T27B5's second acceptance criterion).
      await waitFor(() => expect(screen.queryByTestId("discovered-session-list")).toBeNull());
      const row = await screen.findByTestId(`session-row-${IMPORTED.id}`);
      expect(row.textContent).toContain("Imported terminal session");

      await user.click(row);
      await waitFor(() =>
        expect(router.state.location.pathname).toBe("/h/host-1/session/agt-imported-1"),
      );
      expect(screen.getByTestId("opened-session").textContent).toBe("host-1/agt-imported-1");
    });

    it("importing the same discovered session twice sends only one import request", async () => {
      const client: SessionsClient = { createSession: vi.fn() };
      let resolveImport!: (session: SessionSummary) => void;
      const importSession = vi.fn(
        () =>
          new Promise<SessionSummary>((resolve) => {
            resolveImport = resolve;
          }),
      );
      const discoveredClient: DiscoveredSessionsClient = {
        listDiscoveredSessions: vi.fn(async () => [DISCOVERED]),
        importSession,
      };
      renderSessionsScreenAt({
        client,
        discoveredClient,
        initialState: { kind: "ready", sessions: [] },
      });
      const user = userEvent.setup();

      await user.click(await screen.findByTestId("discover-sessions-trigger"));
      const importButton = await screen.findByTestId(
        `discovered-session-import-${DISCOVERED.providerHandleId}`,
      );

      await user.click(importButton);
      // The button disables itself the instant importing starts, so a
      // second click while the first request is still in flight cannot
      // reach the client a second time either way — this proves both
      // halves of "import is idempotent when run twice".
      expect(importButton).toHaveProperty("disabled", true);

      resolveImport(IMPORTED);
      await waitFor(() => expect(screen.queryByTestId("discovered-session-list")).toBeNull());
      expect(importSession).toHaveBeenCalledTimes(1);
    });

    it("has no axe violations with discovered sessions listed", async () => {
      const client: SessionsClient = { createSession: vi.fn() };
      const discoveredClient: DiscoveredSessionsClient = {
        listDiscoveredSessions: vi.fn(async () => [DISCOVERED]),
        importSession: vi.fn(),
      };
      const { container } = renderSessionsScreenAt({
        client,
        discoveredClient,
        initialState: { kind: "ready", sessions: [EXISTING_SESSION] },
      });
      const user = userEvent.setup();

      await user.click(await screen.findByTestId("discover-sessions-trigger"));
      await screen.findByTestId("discovered-session-list");

      expect(await axe(container)).toHaveNoViolations();
    }, 20_000);
  });
});
