import { describe, expect, it } from "vitest";

import { CameraUnavailableError, classifyCameraError } from "./classify-camera-error.js";

function domException(name: string): DOMException {
  return new DOMException("boom", name);
}

describe("classifyCameraError (T27A4)", () => {
  it("classifies a CameraUnavailableError as unavailable", () => {
    expect(classifyCameraError(new CameraUnavailableError())).toBe("unavailable");
  });

  it.each(["NotAllowedError", "PermissionDeniedError", "SecurityError"])(
    "classifies %s as denied",
    (name) => {
      expect(classifyCameraError(domException(name))).toBe("denied");
    },
  );

  it.each([
    "NotFoundError",
    "DevicesNotFoundError",
    "OverconstrainedError",
    "ConstraintNotSatisfiedError",
  ])("classifies %s as unavailable", (name) => {
    expect(classifyCameraError(domException(name))).toBe("unavailable");
  });

  it("classifies an unrecognized error name as error", () => {
    expect(classifyCameraError(domException("AbortError"))).toBe("error");
  });

  it("classifies a non-Error value as error", () => {
    expect(classifyCameraError("nope")).toBe("error");
    expect(classifyCameraError(undefined)).toBe("error");
  });
});
