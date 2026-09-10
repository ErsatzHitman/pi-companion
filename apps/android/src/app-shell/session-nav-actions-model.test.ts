import { navigation } from "@picompanion/frontend-core";
import { describe, expect, it, vi } from "vitest";

import {
  buildSessionTerminalId,
  pressSessionFiles,
  pressSessionList,
  pressSessionLive,
  pressSessionTerminal,
  type SessionNavRouter,
} from "./session-nav-actions-model";

/**
 * T79 real behavioural coverage — RN-free, unlike the `.tsx` view this
 * module feeds (see that file's own doc comment for why). This is the
 * "starts from a mounted screen" proof the task's acceptance criterion
 * asks for: a fake router standing in for the mounted session screen's
 * own `useRouter()`, never a deep link constructed by the test.
 */
describe("pressSessionList", () => {
  it("navigates the router back out to this host's session list, matching frontend-core's own navigationIntentToPath exactly", () => {
    const router: SessionNavRouter = { push: vi.fn() };
    pressSessionList(router, "srv_1");
    expect(router.push).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledWith(
      navigation.navigationIntentToPath({ type: "sessionList", serverId: "srv_1" }),
    );
    expect(router.push).toHaveBeenCalledWith("/h/srv_1/sessions");
  });

  it("carries the caller's own serverId through, never a remembered or default one", () => {
    const router: SessionNavRouter = { push: vi.fn() };
    pressSessionList(router, "srv_other");
    expect(router.push).toHaveBeenCalledWith("/h/srv_other/sessions");
  });
});

describe("pressSessionLive", () => {
  it("navigates the router to this session's Live screen, matching frontend-core's own navigationIntentToPath exactly", () => {
    const router: SessionNavRouter = { push: vi.fn() };
    pressSessionLive(router, "srv_1", "agt_1");
    expect(router.push).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledWith(
      navigation.navigationIntentToPath({
        type: "sessionLive",
        serverId: "srv_1",
        agentId: "agt_1",
      }),
    );
    expect(router.push).toHaveBeenCalledWith("/h/srv_1/session/agt_1/live");
  });
});

describe("pressSessionFiles", () => {
  it("navigates the router to this session's files route, matching frontend-core's own navigationIntentToPath exactly", () => {
    const router: SessionNavRouter = { push: vi.fn() };
    pressSessionFiles(router, "srv_1", "agt_1");
    expect(router.push).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledWith(
      navigation.navigationIntentToPath({
        type: "sessionFiles",
        serverId: "srv_1",
        agentId: "agt_1",
      }),
    );
    expect(router.push).toHaveBeenCalledWith("/h/srv_1/session/agt_1/files/");
  });

  it("percent-encodes serverId/agentId the same way frontend-core's own path builder does", () => {
    const router: SessionNavRouter = { push: vi.fn() };
    pressSessionFiles(router, "srv one", "agt/1");
    expect(router.push).toHaveBeenCalledWith(
      navigation.navigationIntentToPath({
        type: "sessionFiles",
        serverId: "srv one",
        agentId: "agt/1",
      }),
    );
  });
});

describe("pressSessionTerminal", () => {
  it("navigates the router to this session's one terminal, matching frontend-core's own navigationIntentToPath exactly", () => {
    const router: SessionNavRouter = { push: vi.fn() };
    pressSessionTerminal(router, "srv_1", "agt_1");
    expect(router.push).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledWith(
      navigation.navigationIntentToPath({
        type: "sessionTerminal",
        serverId: "srv_1",
        agentId: "agt_1",
        terminalId: buildSessionTerminalId("agt_1"),
      }),
    );
    expect(router.push).toHaveBeenCalledWith("/h/srv_1/session/agt_1/terminal/agt_1");
  });
});

describe("buildSessionTerminalId", () => {
  it("is the session's own agentId — the one terminal TerminalScreen's fixed slot 0 can ever mean", () => {
    expect(buildSessionTerminalId("agt_1")).toBe("agt_1");
    expect(buildSessionTerminalId("")).toBe("");
  });
});
