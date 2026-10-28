import { describe, expect, it } from "vitest";

import {
  domToComposerText,
  sanitizeCopiedText,
  type ComposerDomNode,
} from "../../src/pages/conversation/model/composer/copy-text";

describe("sanitizeCopiedText", () => {
  it("collapses blank lines and trims edges", () => {
    expect(sanitizeCopiedText("\n\nhello\n\n\nworld\n")).toBe("hello\nworld");
  });

  it("keeps single newlines between lines", () => {
    expect(sanitizeCopiedText("a\nb\nc")).toBe("a\nb\nc");
  });

  it("normalizes CRLF", () => {
    expect(sanitizeCopiedText("a\r\n\r\nb")).toBe("a\nb");
  });
});

describe("domToComposerText", () => {
  it("serializes skill and file chips to composer tokens", () => {
    const root: { childNodes: ComposerDomNode[] } = {
      childNodes: [
        { nodeType: 1, tagName: "SPAN", dataset: { file: "ATTACHMENTS/a1b2c3d4-note.txt" } },
        { nodeType: 3, textContent: " " },
        { nodeType: 1, tagName: "SPAN", dataset: { skill: "check-weather" } },
        { nodeType: 3, textContent: " 杭州" },
      ],
    };
    expect(domToComposerText(root)).toBe("@ATTACHMENTS/a1b2c3d4-note.txt /check-weather 杭州");
  });

  it("serializes mention chips to @name tokens", () => {
    const root: { childNodes: ComposerDomNode[] } = {
      childNodes: [
        { nodeType: 1, tagName: "SPAN", dataset: { mention: "设计师" } },
        { nodeType: 3, textContent: "做稿" },
      ],
    };
    expect(domToComposerText(root)).toBe("@设计师 做稿");
  });
});
