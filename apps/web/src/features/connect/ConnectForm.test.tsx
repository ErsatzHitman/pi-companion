import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ConnectForm } from "./ConnectForm.js";
import type { ApplyConnectionOfferOutcome } from "./apply-connection-offer.js";
import type { ConnectAndAuthenticateOutcome } from "./authenticate-host.js";

/**
 * `QrCaptureSheet`'s own camera/decode behavior is covered directly by
 * `QrCaptureSheet.test.tsx`; here it is replaced with a minimal fake so
 * `ConnectForm`'s wiring (T27A4: open/close the sheet, feed a scanned
 * value through the same offer-apply path a pasted link uses) can be
 * exercised without a real `getUserMedia`/`jsqr`.
 */
vi.mock("./QrCaptureSheet.js", () => ({
  QrCaptureSheet: ({
    open,
    onClose,
    onScanned,
  }: {
    open: boolean;
    onClose: () => void;
    onScanned: (value: string) => void;
  }) =>
    open ? (
      <div data-testid="fake-qr-sheet">
        <button type="button" onClick={() => onScanned("https://app.paseo.sh/#offer=scanned")}>
          Simulate scan
        </button>
        <button type="button" onClick={onClose}>
          Fake close
        </button>
      </div>
    ) : null,
}));

afterEach(cleanup);

const reachable: ConnectAndAuthenticateOutcome = {
  ok: true,
  reachable: true,
  authenticated: true,
  savedProfileId: "profile-1",
  error: null,
};
const unreachable: ConnectAndAuthenticateOutcome = {
  ok: false,
  reachable: false,
  authenticated: false,
  savedProfileId: null,
  error: "Could not reach the daemon. Check the address and try again.",
};
const authFailed: ConnectAndAuthenticateOutcome = {
  ok: false,
  reachable: true,
  authenticated: false,
  savedProfileId: null,
  error: "Incorrect password",
};

describe("ConnectForm (T27A1)", () => {
  it("exposes labeled, keyboard-operable fields", () => {
    render(<ConnectForm onAttempt={vi.fn()} />);

    expect(screen.getByLabelText("Host label")).toBeTruthy();
    expect(screen.getByLabelText(/^Host address/)).toBeTruthy();
    expect(screen.getByRole("switch", { name: "Use TLS" })).toBeTruthy();
    expect(screen.getByLabelText("Access token")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Connect" })).toBeTruthy();
  });

  it("rejects invalid host input with a visible, named error and never attempts a connection", async () => {
    const user = userEvent.setup();
    const onAttempt = vi.fn();
    render(<ConnectForm onAttempt={onAttempt} />);

    await user.type(screen.getByLabelText(/^Host address/), "not-an-address");
    await user.click(screen.getByRole("button", { name: "Connect" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Enter a host and port, like localhost:6767.");
    const address = screen.getByLabelText(/^Host address/);
    expect(address.getAttribute("aria-invalid")).toBe("true");
    expect(address.getAttribute("aria-describedby")).toBe(alert.id);
    expect(onAttempt).not.toHaveBeenCalled();
  });

  it("is fully keyboard operable: tab, type, and submit with Enter", async () => {
    const user = userEvent.setup();
    const onAttempt = vi.fn().mockResolvedValue(reachable);
    render(<ConnectForm onAttempt={onAttempt} />);

    await user.tab(); // host label
    expect(document.activeElement).toBe(screen.getByLabelText("Host label"));
    await user.keyboard("My daemon");
    await user.tab(); // host address
    expect(document.activeElement).toBe(screen.getByLabelText(/^Host address/));
    await user.keyboard("localhost:6767{Enter}");

    expect(onAttempt).toHaveBeenCalledWith({
      label: "My daemon",
      direct: { endpoint: "localhost:6767", useTls: false },
      preferDirect: true,
    });
  });

  it("toggles TLS with the keyboard", async () => {
    const user = userEvent.setup();
    render(<ConnectForm onAttempt={vi.fn()} />);

    const toggle = screen.getByRole("switch", { name: "Use TLS" });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    toggle.focus();
    await user.keyboard(" ");
    expect(toggle.getAttribute("aria-checked")).toBe("true");
  });

  it("reports a successful attempt through a visible, non-colour status banner", async () => {
    const user = userEvent.setup();
    const onAttempt = vi.fn().mockResolvedValue(reachable);
    render(<ConnectForm onAttempt={onAttempt} />);

    await user.type(screen.getByLabelText(/^Host address/), "localhost:6767");
    await user.click(screen.getByRole("button", { name: "Connect" }));

    const status = await screen.findByRole("status");
    expect(status.textContent).toContain("Reached");
  });

  it("reports an unreachable attempt through a visible, non-colour status banner", async () => {
    const user = userEvent.setup();
    const onAttempt = vi.fn().mockResolvedValue(unreachable);
    render(<ConnectForm onAttempt={onAttempt} />);

    await user.type(screen.getByLabelText(/^Host address/), "localhost:6767");
    await user.click(screen.getByRole("button", { name: "Connect" }));

    const status = await screen.findByRole("status");
    expect(status.textContent).toContain("Could not reach");
  });

  it("surfaces a rejected attempt's error message instead of throwing", async () => {
    const user = userEvent.setup();
    const onAttempt = vi.fn().mockRejectedValue(new Error("network unreachable"));
    render(<ConnectForm onAttempt={onAttempt} />);

    await user.type(screen.getByLabelText(/^Host address/), "localhost:6767");
    await user.click(screen.getByRole("button", { name: "Connect" }));

    const status = await screen.findByRole("status");
    expect(status.textContent).toContain("network unreachable");
  });

  it("has no axe violations, idle or with a field error", async () => {
    const user = userEvent.setup();
    const { container } = render(<ConnectForm onAttempt={vi.fn()} />);
    expect(await axe(container)).toHaveNoViolations();

    await user.click(screen.getByRole("button", { name: "Connect" }));
    await screen.findByRole("alert");
    expect(await axe(container)).toHaveNoViolations();
  }, 20_000);
});

describe("ConnectForm bearer-token authentication and credential storage (T27A2)", () => {
  it("sends a typed access token as part of the connect draft, never in the address field", async () => {
    const user = userEvent.setup();
    const onAttempt = vi.fn().mockResolvedValue(reachable);
    render(<ConnectForm onAttempt={onAttempt} />);

    await user.type(screen.getByLabelText(/^Host address/), "localhost:6767");
    await user.type(screen.getByLabelText("Access token"), "secret-token");
    await user.click(screen.getByRole("button", { name: "Connect" }));

    await screen.findByRole("status");
    expect(onAttempt).toHaveBeenCalledWith({
      label: "localhost",
      direct: { endpoint: "localhost:6767", useTls: false },
      preferDirect: true,
      password: "secret-token",
    });
  });

  it("omits the password field entirely when no token was entered", async () => {
    const user = userEvent.setup();
    const onAttempt = vi.fn().mockResolvedValue(reachable);
    render(<ConnectForm onAttempt={onAttempt} />);

    await user.type(screen.getByLabelText(/^Host address/), "localhost:6767");
    await user.click(screen.getByRole("button", { name: "Connect" }));

    await screen.findByRole("status");
    const draft = onAttempt.mock.calls[0]?.[0];
    expect(draft).not.toHaveProperty("password");
  });

  it("masks the access token input so it never appears in plain text on screen", () => {
    render(<ConnectForm onAttempt={vi.fn()} />);
    expect(screen.getByLabelText("Access token").getAttribute("type")).toBe("password");
  });

  it("reports a signed-in success distinctly from a plain reachable connection", async () => {
    const user = userEvent.setup();
    const onAttempt = vi.fn().mockResolvedValue(reachable);
    render(<ConnectForm onAttempt={onAttempt} />);

    await user.type(screen.getByLabelText(/^Host address/), "localhost:6767");
    await user.type(screen.getByLabelText("Access token"), "secret-token");
    await user.click(screen.getByRole("button", { name: "Connect" }));

    const status = await screen.findByRole("status");
    expect(status.textContent).toContain("Signed in");
  });

  it("reports a rejected token through a visible, non-colour status banner, distinct from unreachable", async () => {
    const user = userEvent.setup();
    const onAttempt = vi.fn().mockResolvedValue(authFailed);
    render(<ConnectForm onAttempt={onAttempt} />);

    await user.type(screen.getByLabelText(/^Host address/), "localhost:6767");
    await user.type(screen.getByLabelText("Access token"), "wrong-token");
    await user.click(screen.getByRole("button", { name: "Connect" }));

    const status = await screen.findByRole("status");
    expect(status.textContent).toContain("Incorrect password");
    expect(status.textContent).not.toContain("Could not reach");
  });

  it("offers to forget saved credentials after a successful, persisted connection", async () => {
    const user = userEvent.setup();
    const onAttempt = vi.fn().mockResolvedValue(reachable);
    const onForget = vi.fn().mockResolvedValue(undefined);
    render(<ConnectForm onAttempt={onAttempt} onForget={onForget} />);

    await user.type(screen.getByLabelText(/^Host address/), "localhost:6767");
    await user.click(screen.getByRole("button", { name: "Connect" }));
    await screen.findByRole("status");

    const forgetButton = await screen.findByRole("button", { name: "Forget saved credentials" });
    await user.click(forgetButton);

    expect(onForget).toHaveBeenCalledWith("profile-1");
    const status = await screen.findByRole("status");
    expect(status.textContent).toContain("Forgot the saved credentials");
    expect(screen.queryByRole("button", { name: "Forget saved credentials" })).toBeNull();
  });

  it("does not offer to forget credentials when no onForget handler is wired", async () => {
    const user = userEvent.setup();
    const onAttempt = vi.fn().mockResolvedValue(reachable);
    render(<ConnectForm onAttempt={onAttempt} />);

    await user.type(screen.getByLabelText(/^Host address/), "localhost:6767");
    await user.click(screen.getByRole("button", { name: "Connect" }));
    await screen.findByRole("status");

    expect(screen.queryByRole("button", { name: "Forget saved credentials" })).toBeNull();
  });

  it("has no axe violations with the token field filled or after an auth failure", async () => {
    const user = userEvent.setup();
    const onAttempt = vi.fn().mockResolvedValue(authFailed);
    const { container } = render(<ConnectForm onAttempt={onAttempt} onForget={vi.fn()} />);

    await user.type(screen.getByLabelText(/^Host address/), "localhost:6767");
    await user.type(screen.getByLabelText("Access token"), "wrong-token");
    await user.click(screen.getByRole("button", { name: "Connect" }));
    await screen.findByRole("status");

    expect(await axe(container)).toHaveNoViolations();
  }, 20_000);
});

const offerSuccess: ApplyConnectionOfferOutcome = {
  ok: true,
  kind: "success",
  label: "relay.paseo.sh",
  savedProfileId: "offer-profile-1",
  error: null,
};
const offerMalformed: ApplyConnectionOfferOutcome = {
  ok: false,
  kind: "malformed",
  label: null,
  savedProfileId: null,
  error: "This pairing link isn't valid. Check it was copied in full and try again.",
};
const offerExpired: ApplyConnectionOfferOutcome = {
  ok: false,
  kind: "expired",
  label: "relay.paseo.sh",
  savedProfileId: null,
  error: "This pairing link is no longer valid. Ask for a new one and try again.",
};
const offerWrongDaemonKey: ApplyConnectionOfferOutcome = {
  ok: false,
  kind: "wrong-daemon-key",
  label: "relay.paseo.sh",
  savedProfileId: null,
  error: "This pairing link's daemon key no longer matches. Ask for a new pairing link.",
};

describe("ConnectForm pairing-link offers (T27A3)", () => {
  it("does not render the pairing-link affordance when onApplyOffer is not wired", () => {
    render(<ConnectForm onAttempt={vi.fn()} />);
    expect(screen.queryByLabelText("Pairing link")).toBeNull();
  });

  it("exposes a labeled, keyboard-operable pairing-link field and button", () => {
    render(<ConnectForm onAttempt={vi.fn()} onApplyOffer={vi.fn()} />);
    expect(screen.getByLabelText("Pairing link")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Pair" })).toBeTruthy();
  });

  it("disables Pair until a link is entered, and never calls onApplyOffer for empty input", async () => {
    const onApplyOffer = vi.fn();
    render(<ConnectForm onAttempt={vi.fn()} onApplyOffer={onApplyOffer} />);

    expect(screen.getByRole("button", { name: "Pair" }).hasAttribute("disabled")).toBe(true);
    expect(onApplyOffer).not.toHaveBeenCalled();
  });

  it("applies a valid offer, populates the host label, and reports success distinctly", async () => {
    const user = userEvent.setup();
    const onApplyOffer = vi.fn().mockResolvedValue(offerSuccess);
    render(<ConnectForm onAttempt={vi.fn()} onApplyOffer={onApplyOffer} />);

    await user.type(screen.getByLabelText("Pairing link"), "https://app.paseo.sh/#offer=abc");
    await user.click(screen.getByRole("button", { name: "Pair" }));

    expect(onApplyOffer).toHaveBeenCalledWith("https://app.paseo.sh/#offer=abc");
    const status = await screen.findByRole("status");
    expect(status.textContent).toContain("Paired with relay.paseo.sh");
    expect((screen.getByLabelText("Host label") as HTMLInputElement).value).toBe("relay.paseo.sh");
  });

  it("rejects a malformed offer with a distinct, visible error and no host-label change", async () => {
    const user = userEvent.setup();
    const onApplyOffer = vi.fn().mockResolvedValue(offerMalformed);
    render(<ConnectForm onAttempt={vi.fn()} onApplyOffer={onApplyOffer} />);

    await user.type(screen.getByLabelText("Pairing link"), "not a pairing link");
    await user.click(screen.getByRole("button", { name: "Pair" }));

    const status = await screen.findByRole("status");
    expect(status.textContent).toContain("isn't valid");
    expect((screen.getByLabelText("Host label") as HTMLInputElement).value).toBe("");
  });

  it("reports an expired offer distinctly from a malformed one", async () => {
    const user = userEvent.setup();
    const onApplyOffer = vi.fn().mockResolvedValue(offerExpired);
    render(<ConnectForm onAttempt={vi.fn()} onApplyOffer={onApplyOffer} />);

    await user.type(screen.getByLabelText("Pairing link"), "https://app.paseo.sh/#offer=abc");
    await user.click(screen.getByRole("button", { name: "Pair" }));

    const status = await screen.findByRole("status");
    expect(status.textContent).toContain("no longer valid");
    expect(status.textContent).not.toContain("isn't valid");
  });

  it("reports a wrong daemon key with its own message, distinct from a merely-expired link and announced through the same live region (T27A6)", async () => {
    const user = userEvent.setup();
    const onApplyOffer = vi.fn().mockResolvedValue(offerWrongDaemonKey);
    render(<ConnectForm onAttempt={vi.fn()} onApplyOffer={onApplyOffer} />);

    await user.type(screen.getByLabelText("Pairing link"), "https://app.paseo.sh/#offer=abc");
    await user.click(screen.getByRole("button", { name: "Pair" }));

    // `role="status"` (Banner's polite live region) is how this reaches a
    // screen reader; the message text itself — not merely the banner's
    // tone colour — is what distinguishes this from every other outcome.
    const status = await screen.findByRole("status");
    expect(status.textContent).toContain("daemon key no longer matches");
    expect(status.textContent).not.toContain("no longer valid");
    expect(status.textContent).not.toContain("isn't valid");
  });

  it("surfaces a thrown apply error instead of crashing", async () => {
    const user = userEvent.setup();
    const onApplyOffer = vi.fn().mockRejectedValue(new Error("network unreachable"));
    render(<ConnectForm onAttempt={vi.fn()} onApplyOffer={onApplyOffer} />);

    await user.type(screen.getByLabelText("Pairing link"), "https://app.paseo.sh/#offer=abc");
    await user.click(screen.getByRole("button", { name: "Pair" }));

    const status = await screen.findByRole("status");
    expect(status.textContent).toContain("network unreachable");
  });

  it("offers to forget saved credentials after a successful pairing, independent of the direct-connect banner", async () => {
    const user = userEvent.setup();
    const onApplyOffer = vi.fn().mockResolvedValue(offerSuccess);
    const onForget = vi.fn().mockResolvedValue(undefined);
    render(<ConnectForm onAttempt={vi.fn()} onApplyOffer={onApplyOffer} onForget={onForget} />);

    await user.type(screen.getByLabelText("Pairing link"), "https://app.paseo.sh/#offer=abc");
    await user.click(screen.getByRole("button", { name: "Pair" }));
    await screen.findByRole("status");

    const forgetButton = await screen.findByRole("button", { name: "Forget saved credentials" });
    await user.click(forgetButton);

    expect(onForget).toHaveBeenCalledWith("offer-profile-1");
    const status = await screen.findByRole("status");
    expect(status.textContent).toContain("Forgot the saved credentials");
  });

  it("has no axe violations idle, after a malformed offer, or after a successful pairing", async () => {
    const user = userEvent.setup();
    const onApplyOffer = vi.fn().mockResolvedValue(offerMalformed);
    const { container } = render(
      <ConnectForm onAttempt={vi.fn()} onApplyOffer={onApplyOffer} onForget={vi.fn()} />,
    );
    expect(await axe(container)).toHaveNoViolations();

    await user.type(screen.getByLabelText("Pairing link"), "not a pairing link");
    await user.click(screen.getByRole("button", { name: "Pair" }));
    await screen.findByRole("status");
    expect(await axe(container)).toHaveNoViolations();
  }, 20_000);

  it("has no axe violations after a wrong-daemon-key offer outcome (T27A6)", async () => {
    const user = userEvent.setup();
    const onApplyOffer = vi.fn().mockResolvedValue(offerWrongDaemonKey);
    const { container } = render(<ConnectForm onAttempt={vi.fn()} onApplyOffer={onApplyOffer} />);

    await user.type(screen.getByLabelText("Pairing link"), "https://app.paseo.sh/#offer=abc");
    await user.click(screen.getByRole("button", { name: "Pair" }));
    await screen.findByRole("status");
    expect(await axe(container)).toHaveNoViolations();
  }, 20_000);
});

describe("ConnectForm QR pairing capture (T27A4)", () => {
  it("does not render a QR scan trigger when the offer affordance is not wired", () => {
    render(<ConnectForm onAttempt={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Scan QR code" })).toBeNull();
  });

  it("opens the QR capture sheet from the offer section", async () => {
    const user = userEvent.setup();
    render(<ConnectForm onAttempt={vi.fn()} onApplyOffer={vi.fn()} />);

    expect(screen.queryByTestId("fake-qr-sheet")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Scan QR code" }));
    expect(screen.getByTestId("fake-qr-sheet")).toBeTruthy();
  });

  it("completes pairing from a scanned offer through the same apply path a pasted link uses", async () => {
    const user = userEvent.setup();
    const onApplyOffer = vi.fn().mockResolvedValue(offerSuccess);
    render(<ConnectForm onAttempt={vi.fn()} onApplyOffer={onApplyOffer} />);

    await user.click(screen.getByRole("button", { name: "Scan QR code" }));
    await user.click(screen.getByRole("button", { name: "Simulate scan" }));

    expect(onApplyOffer).toHaveBeenCalledWith("https://app.paseo.sh/#offer=scanned");
    expect(screen.queryByTestId("fake-qr-sheet")).toBeNull();
    const status = await screen.findByRole("status");
    expect(status.textContent).toContain("Paired with relay.paseo.sh");
    expect((screen.getByLabelText("Pairing link") as HTMLInputElement).value).toBe(
      "https://app.paseo.sh/#offer=scanned",
    );
  });

  it("closes the sheet without pairing when it reports back without a scan", async () => {
    const user = userEvent.setup();
    const onApplyOffer = vi.fn();
    render(<ConnectForm onAttempt={vi.fn()} onApplyOffer={onApplyOffer} />);

    await user.click(screen.getByRole("button", { name: "Scan QR code" }));
    await user.click(screen.getByRole("button", { name: "Fake close" }));

    expect(screen.queryByTestId("fake-qr-sheet")).toBeNull();
    expect(onApplyOffer).not.toHaveBeenCalled();
  });

  it("has no axe violations with the QR scan trigger present", async () => {
    const { container } = render(<ConnectForm onAttempt={vi.fn()} onApplyOffer={vi.fn()} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
