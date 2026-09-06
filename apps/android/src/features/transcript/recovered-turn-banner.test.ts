import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * `recovered-turn-banner.tsx` imports `react-native` (via
 * `../../ui/primitives`' `Banner`/`Button`), which cannot be rendered
 * under this workspace's plain `vitest` setup — see `./thinking-row.
 * test.ts`'s doc comment for the identical constraint and the
 * `readCode()` pattern this file copies. All real logic
 * (`selectRecoveredTurnsForSession`, `describeRecoveredTurn`,
 * `confirmRecoveredTurn`, `discardRecoveredTurn`) already has
 * render-free proof, including against a real recovery pass and a real,
 * unmocked `OutboxController`, in `./recovered-turn-model.test.ts`; this
 * file only proves the .tsx actually wires that into the render tree —
 * the empty-renders-null gate, the per-turn `Banner` mapping, and (T106)
 * the per-turn Resend/Discard `Button`s — rather than silently dropping
 * any of it.
 *
 * `readComponentCode()` anchors every assertion below to the one
 * top-level `RecoveredTurnBanner` function (CLAUDE.md's "a sibling
 * occurrence of the same code satisfying a whole-file toMatch" defect
 * class) — this file declares no second top-level function today, but
 * the anchor costs nothing and stops that defect class from ever
 * silently reappearing.
 *
 * Every assertion below was mutation-checked by hand (delete the real
 * construct, re-run this file, confirm the specific `it` fails, restore
 * byte-identically). See this task's (T106) report for the run log,
 * including the two mutations the P6-W3 review already re-ran against
 * this file's T95 shape (`return null` in the component body, and — a
 * separate file's concern — deleting the mount in `session/[agentId]/
 * index.tsx`).
 */
function readSource(): string {
  return readFileSync(
    fileURLToPath(new URL("./recovered-turn-banner.tsx", import.meta.url)),
    "utf8",
  );
}

function readCode(): string {
  return readSource()
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

/** Slices `readCode()` down to the one top-level `function RecoveredTurnBanner(...)` declaration. */
function readComponentCode(): string {
  const code = readCode();
  const body = code
    .split(/^(?:export default |export )?function /m)
    .map((part) => `function ${part}`)
    .find((part) => part.startsWith("function RecoveredTurnBanner("));
  expect(
    body,
    "recovered-turn-banner.tsx should declare a top-level function RecoveredTurnBanner",
  ).toBeDefined();
  return body ?? "";
}

describe("RecoveredTurnBanner: empty case renders nothing", () => {
  it("returns null (not an empty wrapping element) when turns.length === 0", () => {
    expect(readComponentCode()).toMatch(/if \(turns\.length === 0\) \{\s*return null;\s*\}/);
  });
});

describe("RecoveredTurnBanner: one Banner per recovered turn", () => {
  it("maps every turn to a warning-tone Banner, testId'd by the turn's own id, inside a keyed Fragment", () => {
    const code = readComponentCode();
    expect(code).toMatch(/\{turns\.map\(\(turn\) => \(/);
    expect(code).toMatch(/<Fragment key=\{turn\.id\}>/);
    expect(code).toMatch(/<Banner\s+tone="warning"/);
    expect(code).toMatch(/message=\{describeRecoveredTurn\(turn\)\}/);
    expect(code).toMatch(/testId=\{`recovered-turn-banner-\$\{turn\.id\}`\}/);
  });

  it("imports Banner and Button from the shared ui/primitives, never a private re-implementation", () => {
    expect(readCode()).toMatch(/import \{ Banner, Button \} from "\.\.\/\.\.\/ui\/primitives";/);
  });

  it("derives message text from the model's describeRecoveredTurn, never an inline literal", () => {
    expect(readComponentCode()).not.toMatch(/message="/);
  });
});

describe("RecoveredTurnBanner: outbox is optional and defaults to display-only (T95's shipped behaviour)", () => {
  it("declares outbox as an optional prop", () => {
    const code = readCode();
    expect(code).toMatch(/outbox\?:\s*RecoveredTurnOutbox;/);
  });

  it("renders no action row at all when outbox is omitted — the actions block is gated on outbox, not always rendered", () => {
    const code = readComponentCode();
    expect(code).toMatch(/\{outbox \? \(/);
  });
});

describe("RecoveredTurnBanner: T106's Resend/Discard actions, wired to the model's confirm/discard functions", () => {
  it("imports confirmRecoveredTurn and discardRecoveredTurn from the model, never reimplementing either call", () => {
    const code = readCode();
    expect(code).toMatch(/confirmRecoveredTurn/);
    expect(code).toMatch(/discardRecoveredTurn/);
  });

  it("Resend calls confirmRecoveredTurn(outbox, turn), testId'd '-confirm', kind secondary", () => {
    const code = readComponentCode();
    expect(code).toMatch(
      /<Button\s+kind="secondary"\s+label="Resend"\s+onPress=\{\(\) => void confirmRecoveredTurn\(outbox, turn\)\.catch\(\(\) => undefined\)\}\s+testId=\{`recovered-turn-banner-\$\{turn\.id\}-confirm`\}/,
    );
  });

  it("Discard calls discardRecoveredTurn(outbox, turn), testId'd '-discard', kind danger", () => {
    const code = readComponentCode();
    expect(code).toMatch(
      /<Button\s+kind="danger"\s+label="Discard"\s+onPress=\{\(\) => void discardRecoveredTurn\(outbox, turn\)\.catch\(\(\) => undefined\)\}\s+testId=\{`recovered-turn-banner-\$\{turn\.id\}-discard`\}/,
    );
  });

  it("both actions live in one row per turn, testId'd '-actions', never rendered when outbox is absent", () => {
    const code = readComponentCode();
    expect(code).toMatch(
      /<View style=\{styles\.actions\} testID=\{`recovered-turn-banner-\$\{turn\.id\}-actions`\}>/,
    );
  });
});
