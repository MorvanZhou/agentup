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
    credits: 0,
  },
  {
    templateId: "openai",
    modelId: "gpt-5",
    name: "GPT-5",
    vendorId: "openai",
    vendorLabel: "OpenAI",
    optionLabel: "官方 API",
  },
];

it("下拉行：单色标、倍率、当前项打勾", async () => {
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
  expect(options[0]?.textContent).toContain("0.00x");
  expect(options[0]?.querySelector(".text-success-foreground")).not.toBeNull();
  expect(options[1]?.getAttribute("aria-selected")).toBe("false");
  expect(options[1]?.textContent).not.toContain("x");

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
