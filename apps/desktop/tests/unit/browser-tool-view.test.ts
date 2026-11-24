import { expect, it } from "vitest";

import {
  browserClickMarker,
  browserClickSummary,
  browserScreenshotSummary,
  browserSnapshotSummary,
  browserToolDetail,
  browserToolTitle,
  resolveBrowserToolName,
  shortBrowserUrl,
} from "../../src/pages/conversation/components/chat-main/shared/thread/assistant-ui/tools/browser/browser-tool-view.js";

it("认 mcp__playwright__* / mcp__browser__* 与大小写裸名", () => {
  expect(resolveBrowserToolName("mcp__playwright__browser_navigate")).toBe("browser_navigate");
  expect(resolveBrowserToolName("mcp__browser__browser_click")).toBe("browser_click");
  expect(resolveBrowserToolName("Browser_navigate")).toBe("browser_navigate");
  expect(resolveBrowserToolName("browser_click")).toBe("browser_click");
  expect(resolveBrowserToolName("mcp__agentup__delegate_to_agent")).toBeNull();
  expect(resolveBrowserToolName("web_search")).toBeNull();
});

it("从 args/result 抽出点击准星比例", () => {
  expect(browserClickMarker({ xRatio: 0.25, yRatio: 0.5 })).toEqual({ x: 0.25, y: 0.5 });
  expect(
    browserClickMarker({ coordinate: [100, 200], viewportWidth: 400, viewportHeight: 400 }),
  ).toEqual({ x: 0.25, y: 0.5 });
  expect(browserClickMarker({ element: "Submit" })).toBeNull();
  expect(browserClickMarker({}, { text: "clicked at (50, 100)", viewportWidth: 200, viewportHeight: 200 })).toBeNull();
  expect(
    browserClickMarker(
      {},
      { text: "ok", x: 50, y: 100, viewportWidth: 200, viewportHeight: 200 },
    ),
  ).toEqual({ x: 0.25, y: 0.5 });
});

it("标题与 URL 摘要", () => {
  expect(browserToolTitle("browser_navigate")).toBe("Navigate");
  expect(browserToolTitle("browser_take_screenshot")).toBe("Screenshot");
  expect(shortBrowserUrl("https://example.com/app/home")).toBe("example.com/app/home");
  expect(shortBrowserUrl("https://example.com/")).toBe("example.com");
  expect(shortBrowserUrl("not a url")).toBe("not a url");
});

it("按工具挑可读 detail", () => {
  expect(browserToolDetail("browser_navigate", { url: "https://localhost:5173/zh/" })).toBe(
    "localhost:5173/zh/",
  );
  expect(browserToolDetail("browser_click", { element: "Submit button", target: "e12" })).toBe(
    "Submit button",
  );
  expect(browserToolDetail("browser_type", { text: "hello world", element: "Search" })).toContain(
    "hello world",
  );
  expect(browserToolDetail("browser_wait_for", { time: 2 })).toBe("2s");
  expect(browserToolDetail("browser_tabs", { action: "list" })).toBe("list");
});

it("Click 无图时只抽一条操作摘要，不依赖整段 Page state", () => {
  expect(browserClickSummary({ element: "报名数" })).toBe("报名数");
  expect(
    browserClickSummary(
      {},
      {
        text: `### Ran Playwright code\n\`\`\`js\nawait page.getByRole('button', { name: '报名数' }).click();\n\`\`\`\n\n### Page state\n${"x".repeat(2000)}`,
      },
    ),
  ).toBe("报名数");
  expect(
    browserClickSummary(
      {},
      { text: "### Result\nError: Extension connection timeout. Make sure the bridge is installed." },
    ),
  ).toContain("Extension connection timeout");
});

it("Snapshot 抽标题/URL 一行；Screenshot 抽 viewport/路径一行", () => {
  expect(
    browserSnapshotSummary(
      {},
      {
        text: "- Page URL: https://tcampos.qq.com/v2/camps/topic/list\n- Page Title: TcampOS\n- Page Snapshot:\n```yaml\n- generic\n```",
      },
    ),
  ).toBe("TcampOS · tcampos.qq.com/v2/camps/topic/list");
  expect(
    browserScreenshotSummary(
      {},
      { text: "### Result\nTook the viewport screenshot and saved it as /tmp/a/b/tcampos-1.png" },
    ),
  ).toBe("viewport");
});
