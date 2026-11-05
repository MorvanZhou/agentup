/** @vitest-environment happy-dom */
import { expect, it } from "vitest";
import { nextTick } from "vue";

import ComposerModelPicker from "../../src/pages/conversation/components/chat-main/shared/thread/composer/toolbar/ComposerModelPicker.vue";
import { mountView } from "./mount-view.js";

const MODELS = [
  {
    templateId: "codebuddy-sdk",
    modelId: "hy4",
    name: "Hy4 preview",
    vendorId: "codebuddy",
    vendorLabel: "WorkBuddy",
    optionLabel: "本地 Agent App",
    label: "WorkBuddy",
    credits: 0,
    contextWindow: 1_000_000,
  },
  {
    templateId: "openai",
    modelId: "gpt-5",
    name: "GPT-5",
    vendorId: "openai",
    vendorLabel: "OpenAI",
    optionLabel: "官方 API",
    label: "OpenAI · 官方 API",
  },
];

it("主列表精简：名+倍率+勾选；接入/ctx 在 hover 二级面板", async () => {
  const host = mountView(ComposerModelPicker, {
    props: {
      models: MODELS,
      current: { templateId: "codebuddy-sdk", modelId: "hy4" },
      currentLabel: "Hy4 preview",
    },
  });

  const trigger = host.querySelector<HTMLButtonElement>("button[aria-expanded]");
  expect(trigger).not.toBeNull();
  expect(trigger?.querySelector("svg")).not.toBeNull();

  trigger?.click();
  await nextTick();

  const options = [...host.querySelectorAll<HTMLButtonElement>('[role="option"]')];
  expect(options).toHaveLength(2);
  expect(options[0]?.getAttribute("aria-selected")).toBe("true");
  expect(options[0]?.textContent).toContain("Hy4 preview");
  expect(options[0]?.textContent).toContain("0.00x");
  // 主行不露 modelId / 接入标签 / ctx
  expect(options[0]?.textContent).not.toContain("hy4");
  expect(options[0]?.textContent).not.toContain("WorkBuddy");
  expect(options[0]?.textContent).not.toContain("ctx");
  expect(options[1]?.textContent).toContain("GPT-5");
  expect(options[1]?.textContent).not.toContain("gpt-5");
  expect(options[1]?.textContent).not.toContain("OpenAI · 官方 API");
  expect(options[0]?.querySelector(".text-success-foreground")).not.toBeNull();
  expect(options[1]?.getAttribute("aria-selected")).toBe("false");
  expect(options[1]?.textContent).not.toContain("x");

  // hover 才出二级详情：接入 + 上下文 + 倍率；top 跟行对齐
  expect(host.querySelector("[data-model-detail]")).toBeNull();
  options[0]?.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
  await nextTick();
  const detail = host.querySelector<HTMLElement>("[data-model-detail]");
  expect(detail).not.toBeNull();
  expect(detail?.textContent).toContain("WorkBuddy");
  expect(detail?.textContent).toContain("0.00x");
  expect(detail?.textContent).toMatch(/1\s*M/i);
  expect(detail?.style.top).toMatch(/^\d+(\.\d+)?px$/);

  // 换行 hover：侧栏仍在，内容切到第二项
  options[1]?.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
  await nextTick();
  const detail2 = host.querySelector<HTMLElement>("[data-model-detail]");
  expect(detail2?.textContent).toContain("OpenAI · 官方 API");
  expect(detail2?.textContent).not.toContain("WorkBuddy");
  expect(detail2?.style.top).toMatch(/^\d+(\.\d+)?px$/);

  // 列表底部恒有去 Provider 设置的次要入口（疑问时能跳转配置）
  const settingsLink = host.querySelector<HTMLAnchorElement>('a[href*="settings"]');
  expect(settingsLink).not.toBeNull();
  expect(settingsLink?.getAttribute("href")).toContain("section=provider");
});

it("没有可用模型时回落到设置入口，不炸渲染", () => {
  const host = mountView(ComposerModelPicker, {
    props: {
      models: [],
      current: null,
      currentLabel: "",
    },
  });
  expect(host.querySelector("a")?.getAttribute("href")).toContain("settings");
});
