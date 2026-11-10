import { expect, it } from "vitest";

import {
  canEmbedPreviewInIframe,
  createPreviewNavHistory,
  normalizePreviewAddress,
  previewNavBack,
  previewNavCanGoBack,
  previewNavCanGoForward,
  previewNavCurrent,
  previewNavForward,
  previewNavPush,
} from "../../src/pages/conversation/model/message/preview-nav-history.js";

it("初始只有一条时后退前进都不可用", () => {
  const h = createPreviewNavHistory("http://127.0.0.1:5173/");
  expect(previewNavCurrent(h)).toBe("http://127.0.0.1:5173/");
  expect(previewNavCanGoBack(h)).toBe(false);
  expect(previewNavCanGoForward(h)).toBe(false);
});

it("压入新地址后可后退；后退后再前进；再压入会截断前进栈", () => {
  let h = createPreviewNavHistory("http://a/");
  h = previewNavPush(h, "http://b/");
  h = previewNavPush(h, "http://c/");
  expect(previewNavCanGoBack(h)).toBe(true);
  expect(previewNavCanGoForward(h)).toBe(false);

  h = previewNavBack(h);
  expect(previewNavCurrent(h)).toBe("http://b/");
  expect(previewNavCanGoForward(h)).toBe(true);

  h = previewNavForward(h);
  expect(previewNavCurrent(h)).toBe("http://c/");

  h = previewNavBack(h);
  h = previewNavPush(h, "http://d/");
  expect(previewNavCurrent(h)).toBe("http://d/");
  expect(previewNavCanGoForward(h)).toBe(false);
  expect(h.stack).toEqual(["http://a/", "http://b/", "http://d/"]);
});

it("地址栏无 scheme 时补 http://", () => {
  expect(normalizePreviewAddress("127.0.0.1:3000")).toBe("http://127.0.0.1:3000");
  expect(normalizePreviewAddress("https://example.com")).toBe("https://example.com");
  expect(normalizePreviewAddress("  ")).toBe("");
});

it("仅本机与 about:blank 可内嵌；外站须降级系统浏览器", () => {
  expect(canEmbedPreviewInIframe("http://127.0.0.1:5173/")).toBe(true);
  expect(canEmbedPreviewInIframe("http://localhost:3000")).toBe(true);
  expect(canEmbedPreviewInIframe("about:blank#preview")).toBe(true);
  expect(canEmbedPreviewInIframe("https://qq.com")).toBe(false);
  expect(canEmbedPreviewInIframe("https://example.com/path")).toBe(false);
  expect(canEmbedPreviewInIframe("file:///tmp/x")).toBe(false);
});
