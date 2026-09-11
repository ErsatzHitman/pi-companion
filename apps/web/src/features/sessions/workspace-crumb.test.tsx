import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { DaemonAgentSnapshot } from "./daemon-sessions-client.js";
import type { SessionChromeClient, WorkspaceGitSource } from "./workspace-crumb.js";
import { SessionWorkspaceCrumb, WorkspaceCrumb, workspaceBasename } from "./workspace-crumb.js";

afterEach(cleanup);

describe("workspaceBasename", () => {
  it("takes the last segment of POSIX and Windows paths", () => {
    expect(workspaceBasename("/home/me/pi-companion")).toBe("pi-companion");
    expect(workspaceBasename("D:\\pi-companion")).toBe("pi-companion");
    expect(workspaceBasename("/home/me/pi-companion/")).toBe("pi-companion");
    expect(workspaceBasename("D:\\")).toBe("D:");
  });
});

describe("WorkspaceCrumb", () => {
  it("renders the directory basename and the daemon-reported branch", async () => {
    const client: WorkspaceGitSource = {
      getCheckoutStatus: async () => ({ currentBranch: "main" }),
    };
    render(<WorkspaceCrumb cwd="D:\\pi-companion" client={client} />);

    const crumb = await screen.findByRole("navigation", { name: "Workspace" });
    expect(crumb.textContent).toContain("pi-companion");
    expect(crumb.textContent).toContain("main");
  });

  it("shows only the directory when the daemon reports no branch", async () => {
    const client: WorkspaceGitSource = {
      getCheckoutStatus: async () => ({ currentBranch: null }),
    };
    render(<WorkspaceCrumb cwd="/repo/pi-companion" client={client} />);

    const crumb = await screen.findByRole("navigation", { name: "Workspace" });
    expect(crumb.textContent).toContain("pi-companion");
    expect(crumb.textContent).not.toContain("/");
  });

  it("omits the branch rather than inventing one when the read fails", async () => {
    const client: WorkspaceGitSource = {
      getCheckoutStatus: async () => {
        throw new Error("not a git checkout");
      },
    };
    render(<WorkspaceCrumb cwd="/repo/pi-companion" client={client} />);

    const crumb = await screen.findByRole("navigation", { name: "Workspace" });
    expect(crumb.textContent).toBe("pi-companion");
  });

  it("renders nothing without a real cwd", () => {
    render(<WorkspaceCrumb cwd={null} client={null} />);
    expect(screen.queryByRole("navigation", { name: "Workspace" })).toBeNull();
  });
});

describe("SessionWorkspaceCrumb", () => {
  it("resolves basename and branch from one real session snapshot", async () => {
    const snapshot: DaemonAgentSnapshot = {
      id: "agent-1",
      provider: "pi",
      cwd: "D:\\pi-companion",
      status: "running",
      title: null,
      updatedAt: "2026-01-01T00:00:00.000Z",
      model: null,
      currentModeId: null,
      availableModes: [],
    };
    const client: SessionChromeClient = {
      fetchAgent: async () => ({ agent: snapshot }),
      subscribeAgentUpdates: () => () => {},
      getCheckoutStatus: async () => ({ currentBranch: "main" }),
    };

    render(<SessionWorkspaceCrumb agentId="agent-1" client={client} />);

    const crumb = await screen.findByRole("navigation", { name: "Workspace" });
    expect(crumb.textContent).toContain("pi-companion");
    // The branch arrives from a second read (`getCheckoutStatus`), so
    // wait for it rather than assuming one microtask ordering.
    await waitFor(() => expect(crumb.textContent).toContain("main"));
  });
});
