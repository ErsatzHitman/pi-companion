import { cleanup, render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { afterEach, describe, expect, it } from "vitest";

import type { FileReadResult } from "./file-read-client.js";
import { FileContentView } from "./file-content-view.js";

afterEach(cleanup);

function textFile(overrides: Partial<FileReadResult> = {}): FileReadResult {
  return {
    path: "src/example.ts",
    kind: "text",
    bytes: new TextEncoder().encode("const answer = 42;\n"),
    mime: "text/plain",
    size: 20,
    modifiedAt: "2026-02-01T12:00:00.000Z",
    ...overrides,
  };
}

describe("FileContentView (T30B2)", () => {
  it("renders a text file's content, path, and metadata", () => {
    render(<FileContentView file={textFile()} />);

    expect(screen.getByTestId("file-content-code").textContent).toContain("const answer = 42;");
    expect(screen.getByText("src/example.ts")).toBeTruthy();
    expect(screen.getByText("20 B")).toBeTruthy();
  });

  it("shows the file extension as a language label", () => {
    render(<FileContentView file={textFile({ path: "src/example.ts" })} />);
    expect(screen.getByText("ts")).toBeTruthy();
  });

  it("applies the design-token syntax class to a highlighted keyword token", () => {
    render(<FileContentView file={textFile()} />);
    const code = screen.getByTestId("file-content-code");
    const keywordToken = Array.from(code.querySelectorAll("span")).find(
      (span) => span.textContent === "const",
    );
    expect(keywordToken).toBeTruthy();
    expect(keywordToken?.className).toBe("pc-syntax-keyword");
  });

  it("leaves plain (unstyled) tokens without a syntax class", () => {
    render(<FileContentView file={textFile()} />);
    const code = screen.getByTestId("file-content-code");
    const spaceToken = Array.from(code.querySelectorAll("span")).find(
      (span) => span.textContent === " ",
    );
    expect(spaceToken).toBeTruthy();
    expect(spaceToken?.className).toBe("");
  });

  it("composes the CodeBlock primitive's markup rather than duplicating it", () => {
    render(<FileContentView file={textFile()} />);
    const code = screen.getByTestId("file-content-code");
    // CodeBlock (ui/primitives/CodeBlock.tsx) always renders its language
    // label as a preceding sibling `span.pc-code-block__language`, then the
    // `pre.pc-code-block[data-testid]` itself.
    expect(code.tagName).toBe("PRE");
    expect(code.className).toBe("pc-code-block");
    const language = code.previousElementSibling;
    expect(language?.className).toBe("pc-code-block__language");
    expect(language?.textContent).toBe("ts");
  });

  it("shows an empty-file message for zero-length text content", () => {
    render(<FileContentView file={textFile({ bytes: new Uint8Array(), size: 0 })} />);
    expect(screen.getByTestId("file-content-empty")).toBeTruthy();
    expect(screen.queryByTestId("file-content-code")).toBeNull();
  });

  it("refuses to preview a binary file", () => {
    render(<FileContentView file={textFile({ kind: "binary" })} />);
    const refusal = screen.getByTestId("file-content-refused");
    expect(refusal.textContent).toMatch(/binary file/i);
    expect(screen.queryByTestId("file-content-code")).toBeNull();
  });

  it("refuses to preview an image file", () => {
    render(<FileContentView file={textFile({ kind: "image" })} />);
    const refusal = screen.getByTestId("file-content-refused");
    expect(refusal.textContent).toMatch(/image file/i);
  });

  it("refuses to preview a text file over the previewable size cap", () => {
    render(<FileContentView file={textFile({ size: 2 * 1024 * 1024 })} />);
    const refusal = screen.getByTestId("file-content-refused");
    expect(refusal.textContent).toMatch(/too large to preview/i);
  });

  it("decodes UTF-8 bytes rather than assuming string content", () => {
    render(<FileContentView file={textFile({ bytes: new TextEncoder().encode("café\n") })} />);
    expect(screen.getByTestId("file-content-code").textContent).toContain("café");
  });

  it("has no axe violations rendering text content", async () => {
    const { container } = render(<FileContentView file={textFile()} />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  }, 20_000);

  it("has no axe violations on a refused (binary) file", async () => {
    const { container } = render(<FileContentView file={textFile({ kind: "binary" })} />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  }, 20_000);
});
