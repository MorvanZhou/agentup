import { test as base, expect, type ConsoleMessage, type Page } from "@playwright/test";

export { expect, type Page };

/**
 * 冒烟结束时把页面抛错和 console.error 当成失败。
 * 资源 404 / 网络失败留给对应用例自己断言，不在这里算脚本错误。
 * spec 从本文件引入 `test`，不要直接从 `@playwright/test` 引入。
 */
export function isPageFault(text: string): boolean {
  if (text.startsWith("Failed to load resource:")) return false;
  if (text.includes("net::ERR_")) return false;
  return true;
}

export const test = base.extend({
  page: async ({ page }, use) => {
    const faults: string[] = [];
    const onPageError = (error: Error) => {
      const text = error.stack || error.message;
      if (isPageFault(text)) faults.push(text);
    };
    const onConsole = (message: ConsoleMessage) => {
      if (message.type() !== "error") return;
      const text = message.text();
      if (!isPageFault(text)) return;
      faults.push(text);
    };
    page.on("pageerror", onPageError);
    page.on("console", onConsole);
    await use(page);
    expect(faults, `页面出现未捕获异常:\n${faults.join("\n\n")}`).toEqual([]);
  },
});
