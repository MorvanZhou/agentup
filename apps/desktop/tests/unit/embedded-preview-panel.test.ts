/**
 * @vitest-environment happy-dom
 */
import { nextTick } from "vue";
import { afterEach, expect, it, vi } from "vitest";

import EmbeddedPreviewPanel from "../../src/pages/conversation/components/chat-main/shared/preview/EmbeddedPreviewPanel.vue";
import type { AgentUpPreviewRecipe } from "../../src/pages/conversation/model/message/message-preview.js";
import { mountView } from "./mount-view.js";

afterEach(() => {
  Reflect.deleteProperty(window, "agentUp");
});

const recipe: AgentUpPreviewRecipe = {
  id: "demo",
  title: "Demo site",
  command: "npm run dev",
  cwd: ".",
  // about:blank：挂载测不真拉页面，避免 happy-dom iframe fetch 噪音
  preview_url: "about:blank#preview",
};

function mount(props: {
  recipe: AgentUpPreviewRecipe | null;
  open: boolean;
  busy?: boolean;
}): HTMLElement {
  return mountView(EmbeddedPreviewPanel, { props });
}

it("打开时画出浏览器壳：地址栏与后退/前进/刷新/关闭；初始无栈时后退前进禁用", () => {
  const host = mount({ recipe, open: true });
  const iframe = host.querySelector("iframe");
  expect(iframe?.getAttribute("src")).toBe(recipe.preview_url);
  const address = host.querySelector<HTMLInputElement>('input[aria-label="预览地址"]');
  expect(address?.value).toBe(recipe.preview_url);
  const back = host.querySelector<HTMLButtonElement>('[aria-label="后退"]');
  const forward = host.querySelector<HTMLButtonElement>('[aria-label="前进"]');
  expect(back?.disabled).toBe(true);
  expect(forward?.disabled).toBe(true);
  expect(host.querySelector('[aria-label="刷新预览"]')).toBeTruthy();
  expect(host.querySelector('[aria-label="关闭预览"]')).toBeTruthy();
});

it("地址栏回车跳转后可后退；后退后可前进", async () => {
  const host = mount({ recipe, open: true });
  const address = host.querySelector<HTMLInputElement>('input[aria-label="预览地址"]');
  expect(address).toBeTruthy();
  address!.value = "about:blank#other";
  address!.dispatchEvent(new Event("input", { bubbles: true }));
  address!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  await nextTick();

  const iframe = host.querySelector("iframe");
  expect(iframe?.getAttribute("src")).toBe("about:blank#other");
  const back = host.querySelector<HTMLButtonElement>('[aria-label="后退"]');
  expect(back?.disabled).toBe(false);

  back!.click();
  await nextTick();
  expect(iframe?.getAttribute("src")).toBe(recipe.preview_url);
  const forward = host.querySelector<HTMLButtonElement>('[aria-label="前进"]');
  expect(forward?.disabled).toBe(false);
});

it("外站地址回车走 openExternal，不改 iframe，地址栏回到本机页", async () => {
  const openExternal = vi.fn(async (_url: string) => undefined);
  // 测例外站降级只需 openExternal；其余桥接用空实现满足类型
  window.agentUp = {
    openExternal,
    readSession: async () => null,
    saveSession: async () => {},
    clearSession: async () => {},
    selectSkillPackage: async () => null,
    openVisitDirectory: async () => {},
    revealInFolder: async () => {},
    openPath: async () => {},
  };

  const host = mount({ recipe, open: true });
  const address = host.querySelector<HTMLInputElement>('input[aria-label="预览地址"]');
  expect(address).toBeTruthy();
  address!.value = "https://qq.com";
  address!.dispatchEvent(new Event("input", { bubbles: true }));
  address!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  // openExternal 是 async：先等调用，再等地址栏草稿回写到 input
  await vi.waitFor(() => {
    expect(openExternal).toHaveBeenCalledWith("https://qq.com");
  });
  await nextTick();
  expect(host.querySelector("iframe")?.getAttribute("src")).toBe(recipe.preview_url);
  expect(address!.value).toBe(recipe.preview_url);
  const back = host.querySelector<HTMLButtonElement>('[aria-label="后退"]');
  expect(back?.disabled).toBe(true);
});

it("未打开或无配方时不渲染预览面板", () => {
  const closed = mount({ recipe, open: false });
  expect(closed.querySelector("iframe")).toBeNull();
  expect(closed.querySelector('[aria-label="内嵌预览"]')).toBeNull();

  const empty = mount({ recipe: null, open: true });
  expect(empty.querySelector("iframe")).toBeNull();
  expect(empty.querySelector('[aria-label="内嵌预览"]')).toBeNull();
});
