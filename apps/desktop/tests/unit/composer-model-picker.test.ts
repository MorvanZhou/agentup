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
  // 一对一：没有「共用」前缀，供应商标仍在模型名左边
  expect(trigger?.querySelector("[data-model-prefix]")).toBeNull();
  const directLogo = trigger?.querySelector(".provider-logo");
  const directName = trigger?.querySelector("[data-model-name]");
  expect(directLogo?.querySelector("svg")).not.toBeNull();
  expect(directName?.textContent).toContain("Hy4 preview");
  expect(
    directLogo!.compareDocumentPosition(directName!) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();

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

it("群统一：前缀在供应商标前，模型名在标后", () => {
  const host = mountView(ComposerModelPicker, {
    props: {
      models: MODELS,
      current: { templateId: "openai", modelId: "gpt-5" },
      currentLabel: "GPT-5",
      labelPrefix: "共用",
      scope: "group",
    },
  });
  const trigger = host.querySelector<HTMLButtonElement>("button[aria-expanded]");
  const prefix = trigger?.querySelector("[data-model-prefix]");
  const logo = trigger?.querySelector(".provider-logo");
  const name = trigger?.querySelector("[data-model-name]");
  expect(prefix?.textContent).toBe("共用");
  expect(name?.textContent).toBe("GPT-5");
  expect(prefix!.compareDocumentPosition(logo!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(logo!.compareDocumentPosition(name!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
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

it("一对一单配只列出当前这位，其他人是不可点的示意", async () => {
  const host = mountView(ComposerModelPicker, {
    props: {
      models: MODELS,
      current: { templateId: "openai", modelId: "gpt-5" },
      currentLabel: "GPT-5",
      mode: "perAgent",
      scope: "direct",
      speakerId: "me",
      members: [{ id: "me", name: "小A" }],
    },
  });
  host.querySelector<HTMLButtonElement>("button[aria-expanded]")?.click();
  await nextTick();
  const members = [...host.querySelectorAll<HTMLButtonElement>("[data-member-id]")];
  expect(members).toHaveLength(1);
  expect(members[0]?.getAttribute("data-member-id")).toBe("me");
  expect(members[0]?.textContent).toContain("小A");
  expect(members[0]?.textContent).toContain("GPT-5");
  const placeholder = host.querySelector("[data-member-placeholder]");
  expect(placeholder).not.toBeNull();
  expect(placeholder?.querySelector("button")).toBeNull();
  expect(host.querySelector("[data-model-mode='perAgent']")?.getAttribute("aria-pressed")).toBe("true");
  expect(host.querySelector("[data-member-providers]")).toBeNull();

  members[0]?.click();
  await nextTick();
  const options = [...host.querySelectorAll<HTMLButtonElement>('[role="option"]')];
  expect(options).toHaveLength(2);
  options[0]?.click();
  await nextTick();
  expect(host.querySelector("button[aria-expanded]")?.getAttribute("aria-expanded")).toBe("true");
  expect(host.querySelectorAll("[data-member-id]")).toHaveLength(1);
  expect(host.querySelector("[data-member-placeholder]")).not.toBeNull();
});

it("群单配先列成员，点进去才是模型列表", async () => {
  const host = mountView(ComposerModelPicker, {
    props: {
      models: MODELS,
      current: { templateId: "openai", modelId: "gpt-5" },
      currentLabel: "各用各的",
      mode: "perAgent",
      showLogo: false,
      speakerId: "pm",
      members: [
        { id: "pm", name: "产品" },
        { id: "dev", name: "开发" },
      ],
      memberModels: {
        pm: { templateId: "openai", modelId: "gpt-5", name: "GPT-5" },
        dev: { templateId: "codebuddy-sdk", modelId: "hy4", name: "Hy4 preview" },
      },
    },
  });
  host.querySelector<HTMLButtonElement>("button[aria-expanded]")?.click();
  await nextTick();
  const members = [...host.querySelectorAll<HTMLButtonElement>("[data-member-id]")];
  expect(members).toHaveLength(2);
  expect(members[0]?.getAttribute("data-speaking")).toBe("true");
  expect(members[1]?.textContent).toContain("Hy4 preview");
  // 每人模型名左侧是供应商标；叠放在发送旁的「各用各的」上，不在菜单切换项里
  for (const row of members) {
    const mark = row.querySelector("[data-member-model] .provider-logo");
    const name = row.querySelector("[data-member-model] .truncate");
    expect(mark).not.toBeNull();
    expect(mark!.compareDocumentPosition(name!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  }
  const trigger = host.querySelector("button[aria-expanded]");
  expect(trigger?.querySelectorAll("[data-member-providers] .provider-logo")).toHaveLength(2);
  expect(host.querySelector("[data-model-mode='perAgent'] [data-member-providers]")).toBeNull();
  expect(host.querySelector("[data-model-detail]")).toBeNull();

  members[1]?.click();
  await nextTick();
  expect(host.querySelector("[data-member-id]")).toBeNull();
  expect(host.querySelector("[data-model-back]")).not.toBeNull();
  expect(host.querySelector("[data-model-private]")).not.toBeNull();
  const options = [...host.querySelectorAll<HTMLButtonElement>('[role="option"]')];
  expect(options.some((option) => option.getAttribute("aria-selected") === "true")).toBe(true);

  options[0]?.click();
  await nextTick();
  expect(host.querySelector("button[aria-expanded]")?.getAttribute("aria-expanded")).toBe("true");
  expect(host.querySelectorAll("[data-member-id]")).toHaveLength(2);
  expect(host.querySelector("[data-model-back]")).toBeNull();
});
