import { expect, it } from "vitest";

import {
  browserToolDetail,
  browserToolTitle,
  resolveBrowserToolName,
  shortBrowserUrl,
} from "../../src/pages/conversation/components/chat-main/shared/thread/assistant-ui/tools/browser/browser-tool-view.js";

it("认 mcp__playwright__browser_* 与大小写裸名", () => {
  expect(resolveBrowserToolName("mcp__playwright__browser_navigate")).toBe("browser_navigate");
  expect(resolveBrowserToolName("Browser_navigate")).toBe("browser_navigate");
  expect(resolveBrowserToolName("browser_click")).toBe("browser_click");
  expect(resolveBrowserToolName("mcp__agentup__delegate_to_agent")).toBeNull();
  expect(resolveBrowserToolName("web_search")).toBeNull();
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
