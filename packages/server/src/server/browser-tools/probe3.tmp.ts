import type { BrowserToolsExecuteInput } from "./broker.js";
import type { BrowserToolsResponsePayload } from "./errors.js";
import type { PaseoToolResult } from "../agent/tools/types.js";

const BROWSER_ID = "11111111-1111-4111-8111-111111111111";

function screenshotPayload(): Extract<BrowserToolsResponsePayload, { ok: true }> {
  return {
    requestId: "req-screenshot",
    ok: true,
    result: {
      command: "screenshot",
      browserId: BROWSER_ID,
      mimeType: "image/png",
      dataBase64: "iVBORw0KGgo=",
      width: 800,
      height: 600,
    },
  };
}

interface RoutedToolCaseBase {
  name: string;
  toolName: string;
  input: Record<string, unknown>;
  command: BrowserToolsExecuteInput["command"];
  payload: Extract<BrowserToolsResponsePayload, { ok: true }>;
  content: PaseoToolResult["content"];
}

type RoutedToolCase =
  | (RoutedToolCaseBase & { structuredResult?: undefined })
  | (RoutedToolCaseBase & { structuredResult: Record<string, unknown> });

const routedToolCases: RoutedToolCase[] = [
  {
    name: "screenshot",
    toolName: "browser_screenshot",
    input: { browserId: BROWSER_ID },
    command: { command: "screenshot", args: { browserId: BROWSER_ID, fullPage: false } },
    payload: screenshotPayload(),
    content: [
      { type: "text", text: "Captured browser screenshot (800x600)." },
      { type: "image", data: "iVBORw0KGgo=", mimeType: "image/png" },
    ],
    structuredResult: {
      command: "screenshot",
      browserId: BROWSER_ID,
      mimeType: "image/png",
      width: 800,
      height: 600,
    },
  },
];
console.log(routedToolCases);
