import { describe, expect, it } from "vitest";

import {
  domToComposerText,
  domToPlainText,
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

  it("drops a synthetic image caption from copied user text", () => {
    expect(
      sanitizeCopiedText(
        "这个文件名是什么\n\n[Image: original 5112x2314, displayed at 2000x905. Multiply coordinates by 2.56 to map to original image.]",
      ),
    ).toBe("这个文件名是什么");
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

  it("skips data-copy-ignore subtrees", () => {
    const root: { childNodes: ComposerDomNode[] } = {
      childNodes: [
        { nodeType: 3, textContent: "正文" },
        {
          nodeType: 1,
          tagName: "DIV",
          dataset: { copyIgnore: "" },
          childNodes: [{ nodeType: 3, textContent: "操作栏" }],
        },
      ],
    };
    expect(domToComposerText(root)).toBe("正文");
  });
});

describe("domToPlainText", () => {
  it("joins block elements with newlines and trims trailing blanks", () => {
    const root: { childNodes: ComposerDomNode[] } = {
      childNodes: [
        {
          nodeType: 1,
          tagName: "P",
          childNodes: [{ nodeType: 3, textContent: "第一段" }],
        },
        {
          nodeType: 1,
          tagName: "P",
          childNodes: [{ nodeType: 3, textContent: "第二段" }],
        },
        {
          nodeType: 1,
          tagName: "DIV",
          childNodes: [],
        },
        {
          nodeType: 1,
          tagName: "DIV",
          childNodes: [{ nodeType: 3, textContent: "\n\n" }],
        },
      ],
    };
    expect(domToPlainText(root)).toBe("第一段\n第二段");
  });

  it("skips data-copy-ignore chrome such as tab labels", () => {
    const root: { childNodes: ComposerDomNode[] } = {
      childNodes: [
        {
          nodeType: 1,
          tagName: "DIV",
          dataset: { copyIgnore: "" },
          childNodes: [{ nodeType: 3, textContent: "过程" }],
        },
        {
          nodeType: 1,
          tagName: "P",
          childNodes: [{ nodeType: 3, textContent: "回答正文" }],
        },
      ],
    };
    expect(domToPlainText(root)).toBe("回答正文");
  });

  it("keeps br as a single newline", () => {
    const root: { childNodes: ComposerDomNode[] } = {
      childNodes: [
        { nodeType: 3, textContent: "上" },
        { nodeType: 1, tagName: "BR" },
        { nodeType: 3, textContent: "下" },
      ],
    };
    expect(domToPlainText(root)).toBe("上\n下");
  });
});
