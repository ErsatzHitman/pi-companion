import { describe, expect, test } from "vitest";

import {
  SessionInboundMessageSchema,
  SessionOutboundMessageSchema,
  TrustedDeviceRevokeRequestSchema,
  TrustedDeviceRevokeResponseSchema,
  TrustedDeviceUnrevokeRequestSchema,
  TrustedDeviceUnrevokeResponseSchema,
} from "./messages.js";

describe("trusted_device.unrevoke messages", () => {
  test("trusted_device.unrevoke.request round-trips the full shape", () => {
    const request = {
      type: "trusted_device.unrevoke.request",
      requestId: "unrevoke-1",
      clientId: "clid_target_0001",
    };
    expect(TrustedDeviceUnrevokeRequestSchema.parse(request)).toEqual(request);
    expect(SessionInboundMessageSchema.parse(request)).toEqual(request);
  });

  test("trusted_device.unrevoke.request mirrors the revoke request shape exactly", () => {
    // The un-revoke pair exists to undo `trusted_device.revoke` — its
    // request carries the same fields under its own `type` literal, so a
    // caller can reuse the same `requestId`/`clientId` pair. Removing a
    // field from one side without the other breaks that symmetry.
    const revokeKeys = Object.keys(TrustedDeviceRevokeRequestSchema.shape).sort();
    const unrevokeKeys = Object.keys(TrustedDeviceUnrevokeRequestSchema.shape).sort();
    expect(unrevokeKeys).toEqual(revokeKeys);
  });

  test("trusted_device.unrevoke.request rejects a blank requestId or clientId", () => {
    expect(() =>
      TrustedDeviceUnrevokeRequestSchema.parse({
        type: "trusted_device.unrevoke.request",
        requestId: "",
        clientId: "clid_target_0001",
      }),
    ).toThrow();
    expect(() =>
      TrustedDeviceUnrevokeRequestSchema.parse({
        type: "trusted_device.unrevoke.request",
        requestId: "unrevoke-1",
        clientId: "",
      }),
    ).toThrow();
  });

  test("trusted_device.unrevoke.response round-trips the success shape", () => {
    const response = {
      type: "trusted_device.unrevoke.response",
      payload: {
        requestId: "unrevoke-1",
        clientId: "clid_target_0001",
        success: true,
        error: null,
      },
    };
    expect(TrustedDeviceUnrevokeResponseSchema.parse(response)).toEqual(response);
    expect(SessionOutboundMessageSchema.parse(response)).toEqual(response);
  });

  test("trusted_device.unrevoke.response round-trips the failure envelope", () => {
    const response = {
      type: "trusted_device.unrevoke.response",
      payload: {
        requestId: "unrevoke-2",
        clientId: "clid_target_0001",
        success: false,
        error: "Invalid clientId",
      },
    };
    expect(TrustedDeviceUnrevokeResponseSchema.parse(response)).toEqual(response);
    expect(SessionOutboundMessageSchema.parse(response)).toEqual(response);
  });

  test("trusted_device.unrevoke.response mirrors the revoke response payload keys", () => {
    const revokeKeys = Object.keys(TrustedDeviceRevokeResponseSchema.shape.payload.shape).sort();
    const unrevokeKeys = Object.keys(
      TrustedDeviceUnrevokeResponseSchema.shape.payload.shape,
    ).sort();
    expect(unrevokeKeys).toEqual(revokeKeys);
  });
});
