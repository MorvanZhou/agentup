import { afterEach, expect } from "vitest";
import { createApp, type App, type Component } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";

import { i18n } from "../../src/shared/i18n/index.js";

const stub = { template: "<div />" };

/** 组件里的 RouterLink 需要注入。不挂整棵应用路由，只留设置页这个名字。 */
function mountRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", name: "conversation", component: stub },
      { path: "/settings", name: "settings", component: stub },
    ],
  });
}

type ProvidePair = readonly [symbol | string, unknown];

const mounted: { app: App; host: HTMLElement }[] = [];
const faults: string[] = [];
let patched = false;

function formatArg(value: unknown): string {
  if (value instanceof Error) return value.stack || value.message;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/** console.warn 里要当成失败的 Vue / 词条警告。console.error 一律记入。 */
export function isViewFault(text: string): boolean {
  return /\[Vue warn\]|\[intlify\]|\[vue-i18n\]/.test(text);
}

function tapConsole(): void {
  if (patched) return;
  patched = true;
  const originalWarn = console.warn.bind(console);
  const originalError = console.error.bind(console);
  console.warn = (...args: Parameters<typeof console.warn>) => {
    const text = args.map(formatArg).join(" ");
    if (isViewFault(text)) faults.push(text);
    originalWarn(...args);
  };
  console.error = (...args: Parameters<typeof console.error>) => {
    faults.push(args.map(formatArg).join(" "));
    originalError(...args);
  };
}

/**
 * 挂载一个组件。文件顶部需要 `@vitest-environment happy-dom`。
 * 用例结束时若出现渲染抛错、Vue 警告或缺词条，整例失败。
 * 调用方准备两份数据：接近真实的一份，以及缺字段或空列表的一份。
 */
export function mountView(
  component: Component,
  options?: {
    props?: Record<string, unknown>;
    provide?: readonly ProvidePair[];
  },
): HTMLElement {
  tapConsole();
  const host = document.createElement("div");
  document.body.appendChild(host);
  const app = createApp(component, options?.props ?? {});
  app.use(i18n);
  app.use(mountRouter());
  for (const [key, value] of options?.provide ?? []) app.provide(key, value);
  app.config.errorHandler = (error) => {
    faults.push(error instanceof Error ? error.stack || error.message : String(error));
  };
  app.mount(host);
  mounted.push({ app, host });
  return host;
}

afterEach(() => {
  const found = faults.splice(0);
  while (mounted.length > 0) {
    const item = mounted.pop();
    item?.app.unmount();
    item?.host.remove();
  }
  document.body.replaceChildren();
  expect(found, "组件渲染出现报错或 Vue 警告").toEqual([]);
});
