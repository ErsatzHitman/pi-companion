import { afterEach, describe, expect, it, vi } from "vitest";

import { createConsoleLogger } from "./logging.js";

describe("createConsoleLogger", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("logs at each level through console", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const logger = createConsoleLogger();
    logger.info("hello", { count: 1 });
    expect(info).toHaveBeenCalledWith("hello", { count: 1 });
  });

  it("omits the fields argument when there are none", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const logger = createConsoleLogger();
    logger.warn("careful");
    expect(warn).toHaveBeenCalledWith("careful");
  });

  it("child() merges base fields into subsequent calls", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const logger = createConsoleLogger({ platform: "web" }).child({ sessionId: "s1" });
    logger.error("boom", { code: 500 });
    expect(error).toHaveBeenCalledWith("boom", { platform: "web", sessionId: "s1", code: 500 });
  });
});
