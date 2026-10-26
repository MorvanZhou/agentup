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

  it("does not render raw HTML", () => {
    const html = renderMarkdown('<script>alert(1)</script>');
    expect(html).not.toContain("<script>");
  });
});
