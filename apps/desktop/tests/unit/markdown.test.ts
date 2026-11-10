import { describe, expect, it } from "vitest";

import { renderMarkdown } from "../../src/shared/model/markdown/render.js";

describe("renderMarkdown", () => {
  it("renders GFM table and strikethrough", () => {
    const html = renderMarkdown("| a | b |\n| --- | --- |\n| 1 | 2 |\n\n~~old~~");
    expect(html).toContain("<table>");
    expect(html).toContain("<s>");
  });

  it("wraps fenced code with language header and copy control", () => {
    const html = renderMarkdown("```ts\nconst n = 1;\n```");
    expect(html).toContain('class="aui-code-block"');
    expect(html).toContain('class="aui-code-lang">ts</span>');
    expect(html).toContain('class="aui-code-copy"');
    expect(html).toContain("hljs");
    expect(html).toContain("language-ts");
  });

  it("emits mermaid placeholders instead of code blocks", () => {
    const html = renderMarkdown("```mermaid\nflowchart LR\n  A-->B\n```");
    expect(html).toContain('class="aui-mermaid"');
    expect(html).toContain('class="aui-mermaid-source"');
    expect(html).toContain("flowchart LR");
    expect(html).not.toContain('class="aui-code-block"');
  });

  it("marks markdown images as previewable", () => {
    const html = renderMarkdown("![cat](https://example.com/cat.png)");
    expect(html).toContain("aui-md-img");
    expect(html).toContain('src="https://example.com/cat.png"');
  });

  it("opens external links in a new tab", () => {
    const html = renderMarkdown("[docs](https://example.com)");
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain("aui-md-a");
  });

  it("does not linkify local paths until linkLocalPaths is on", () => {
    const plain = renderMarkdown("见 src/foo.ts");
    expect(plain).not.toContain("data-local-path");
    const linked = renderMarkdown("见 src/foo.ts", { linkLocalPaths: true });
    expect(linked).toContain('data-local-path="src/foo.ts"');
    expect(linked).toContain('data-local-kind="relative"');
    expect(linked).toContain('title="src/foo.ts"');
    expect(linked).toContain("aui-md-path");
    expect(linked).toContain("aui-md-path-icon");
    // chip 可见文案用 basename，全路径放 title / data-local-path
    expect(linked).toMatch(/>foo\.ts<\/a>/);
    expect(linked).not.toContain('target="_blank"');
  });

  it("keeps http links external when linkLocalPaths is on", () => {
    const html = renderMarkdown("[docs](https://example.com) 与 src/a.md", {
      linkLocalPaths: true,
    });
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('data-local-path="src/a.md"');
    expect(html).toMatch(/>a\.md<\/a>/);
  });

  it("does not turn bare `file://` into a local-path chip", () => {
    const html = renderMarkdown("无头 Chrome 以 `file://` 直接打开：**15/15**", {
      linkLocalPaths: true,
    });
    expect(html).not.toContain("data-local-path");
    expect(html).not.toContain("aui-md-path");
    expect(html).toContain("<code>");
    expect(html).toContain("file://");
  });

  it("does not render raw HTML", () => {
    const html = renderMarkdown('<script>alert(1)</script>');
    expect(html).not.toContain("<script>");
  });
});
