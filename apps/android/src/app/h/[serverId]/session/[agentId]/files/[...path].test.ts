import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * `/h/:serverId/session/:agentId/files/*` route stub coverage — T32S1C,
 * extended by T32S4 for the real `client`/`workspaceRoot` wiring.
 * Source-level contract test, same reason as `../index.test.ts`.
 */
describe("SessionFilesRoute source", () => {
  const source = readFileSync(fileURLToPath(new URL("./[...path].tsx", import.meta.url)), "utf8");

  it("imports its screen from features/files rather than containing feature logic itself", () => {
    expect(source).toMatch(/from "\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/features\/files"/);
    expect(source).toMatch(/<FilesScreen\b/);
  });

  it("defaults the catch-all path to an empty array at the files root", () => {
    expect(source).toMatch(/path\s*\?\?\s*\[\]/);
  });

  it("passes a real client from AppCore.fileBrowserClient, never a locally constructed one", () => {
    expect(source).toMatch(/from "\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/core-context"/);
    expect(source).toMatch(/const core = useAppCore\(\)/);
    expect(source).toMatch(/client=\{core\.fileBrowserClient\}/);
  });

  it("passes a workspaceRoot prop, so FilesScreen's client-and-workspaceRoot 'not connected' gate no longer trips on this route alone", () => {
    expect(source).toMatch(/workspaceRoot="/);
  });

  // T32S13 (P5-W19): `downloadOrigin` used to be omitted entirely, so
  // `FilesScreen`'s `DownloadPanel` was never reachable.
  it("derives downloadOrigin from the live AppCore.connection snapshot's daemonAddress via buildDaemonHttpOrigin, never a hardcoded/omitted value", () => {
    expect(source).toMatch(
      /from "\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/features\/connect\/daemon-connection-store\.js"/,
    );
    expect(source).toMatch(/from "\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/features\/connect"/);
    // T66 widened this destructure to also pull `path` (aliased
    // `connectionPath`) off the same snapshot — one contiguous match,
    // not two independent ones, so a mutation that drops either half
    // fails this test.
    expect(source).toMatch(
      /const \{ daemonAddress, path: connectionPath \} = useConnectionStatus\(core\.connection\);/,
    );
    expect(source).toMatch(
      /const downloadOrigin = daemonAddress \? buildDaemonHttpOrigin\(daemonAddress\) : null;/,
    );
    expect(source).toMatch(/downloadOrigin=\{downloadOrigin\}/);
  });

  // T66: relay-paired connections have no HTTP origin to derive a
  // download URL from (daemonAddress is always null on that path) — this
  // route forwards `connectionPath` so `FilesScreen`/`file-download-
  // model.ts` can tell that permanent, by-design refusal apart from a
  // session that simply isn't connected yet.
  it("T66: forwards connectionPath so a relay-paired session's missing download origin gets its own named refusal", () => {
    expect(source).toMatch(/connectionPath=\{connectionPath\}/);
  });

  // T32S14: `fetchImpl` used to be omitted entirely, so `FilesScreen`'s
  // `!fetchImpl` guard always suppressed `DownloadPanel` regardless of
  // connection state — the download button was silently absent rather
  // than visibly refused, even once T66's named relay/no-origin
  // refusals existed to show.
  it("mounts a real fetchImpl from platform/file-download-fetch.ts, built once via useMemo rather than a fresh closure every render", () => {
    expect(source).toMatch(
      /import \{ createFetchDownload \} from "\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/platform\/file-download-fetch\.js";/,
    );
    expect(source).toMatch(/const fetchImpl = useMemo\(\(\) => createFetchDownload\(\), \[\]\);/);
    expect(source).toMatch(/fetchImpl=\{fetchImpl\}/);
  });

  // T78: `filePicker`/`sharing` used to be omitted entirely, so
  // `FilesScreen`'s upload affordance never rendered and a completed
  // download's bytes never reached a `Sharing` sink. These two
  // assertions each look for the exact JSX prop text — deleting either
  // prop line (not just this route's own `core` reference) fails the
  // assertion, so a mutation that reverts the mount is caught even if
  // some other `core.filePicker`/`core.sharing` mention survived
  // elsewhere in this file (there is none — grep confirms each string
  // appears exactly once, in the JSX itself).
  it("T78: passes a real filePicker from AppCore.filePicker, never omitted or locally constructed", () => {
    expect(source).toMatch(/filePicker=\{core\.filePicker\}/);
  });

  it("T78: passes a real sharing from AppCore.sharing, never omitted or locally constructed", () => {
    expect(source).toMatch(/sharing=\{core\.sharing\}/);
  });
});
