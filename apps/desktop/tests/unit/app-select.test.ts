/** @vitest-environment happy-dom */
import { createApp, h, nextTick, ref, type App, type Ref } from "vue";
import { afterEach, expect, it } from "vitest";

import AppSelect from "../../src/shared/components/AppSelect.vue";
import type { AppSelectOption } from "../../src/shared/components/AppSelect.vue";

const OPTIONS: AppSelectOption[] = [
  { value: "openai", label: "OpenAI", active: true },
  { value: "ollama", label: "Ollama" },
];

type Harness = {
  host: HTMLElement;
  model: Ref<string>;
  app: App;
};

let harness: Harness | null = null;

const CASCADE_OPTIONS: AppSelectOption[] = [
  { value: "cursor-sdk", label: "Cursor", group: "本地 Agent App 接入", hint: "可用", active: true },
  { value: "codebuddy-sdk", label: "Workbuddy", group: "本地 Agent App 接入" },
  { value: "openai", label: "OpenAI", group: "API Key 接入", active: true },
  { value: "ollama", label: "Ollama", group: "API Key 接入" },
];

function mountSelect(
  opts?: {
    modelValue?: string;
    disabled?: boolean;
    options?: AppSelectOption[];
    cascade?: boolean;
    groupLabel?: string;
    defaultGroup?: string;
    searchable?: boolean;
    searchPlaceholder?: string;
    searchEmpty?: string;
  },
): Harness {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const model = ref(opts?.modelValue ?? "openai");
  const app = createApp({
    setup() {
      return () =>
        h(AppSelect, {
          modelValue: model.value,
          label: opts?.cascade ? "接入商" : "供应商",
          groupLabel: opts?.groupLabel ?? (opts?.cascade ? "接入方式" : undefined),
          defaultGroup: opts?.defaultGroup,
          cascade: opts?.cascade,
          options: opts?.options ?? OPTIONS,
          disabled: opts?.disabled,
          searchable: opts?.searchable,
          searchPlaceholder: opts?.searchPlaceholder,
          searchEmpty: opts?.searchEmpty,
          activeHint: "已配置并生效",
          "onUpdate:modelValue": (value: string) => {
            model.value = value;
          },
        });
    },
  });
  app.mount(host);
  harness = { host, model, app };
  return harness;
}

afterEach(() => {
  harness?.app.unmount();
  harness?.host.remove();
  harness = null;
  document.body.replaceChildren();
});

function triggerOf(host: HTMLElement, index = 0): HTMLButtonElement {
  const buttons = host.querySelectorAll<HTMLButtonElement>("button[aria-haspopup='true']");
  const button = buttons[index];
  if (!button) throw new Error(`missing AppSelect trigger #${index}`);
  return button;
}

function listboxOf(host: HTMLElement): HTMLElement | null {
  return host.querySelector('[role="listbox"]');
}

/** 菜单外壳（含翻转 / 限高）；搜索开启后 listbox 不再承担定位 class */
function menuPanelOf(host: HTMLElement): HTMLElement | null {
  return host.querySelector("[data-placement]");
}

function optionNamed(host: HTMLElement, name: string): HTMLButtonElement {
  const option = [...host.querySelectorAll<HTMLButtonElement>('[role="option"]')].find((el) =>
    (el.textContent ?? "").includes(name),
  );
  if (!option) throw new Error(`missing option ${name}`);
  return option;
}

it("点击触发器打开选项列表", async () => {
  const { host } = mountSelect();
  expect(listboxOf(host)).toBeNull();

  triggerOf(host).click();
  await nextTick();

  expect(listboxOf(host)).not.toBeNull();
  expect(host.querySelectorAll('[role="option"]')).toHaveLength(2);
});

it("选择选项后更新值并收起，且不会再次打开", async () => {
  const { host, model } = mountSelect({ modelValue: "openai" });
  triggerOf(host).click();
  await nextTick();

  optionNamed(host, "Ollama").click();
  await nextTick();
  await nextTick();

  expect(model.value).toBe("ollama");
  expect(listboxOf(host)).toBeNull();
  expect(triggerOf(host).getAttribute("aria-expanded")).toBe("false");
});

it("已配置的当前项在触发器上显示状态提示，选项带无障碍说明", async () => {
  const { host } = mountSelect({ modelValue: "openai" });
  expect(host.querySelector('[title="已配置并生效"]')).not.toBeNull();

  triggerOf(host).click();
  await nextTick();

  expect(optionNamed(host, "OpenAI").getAttribute("aria-label")).toBe("OpenAI, 已配置并生效");
  expect(optionNamed(host, "Ollama").getAttribute("aria-label")).toBeNull();
});

it("同 group 的连续项归为一组，并显示分组标题与次要说明", async () => {
  const { host } = mountSelect({
    modelValue: "ollama",
    options: [
      { value: "openai", label: "OpenAI", group: "API Key 接入" },
      { value: "codebuddy-sdk", label: "Workbuddy / CodeBuddy", group: "本地 Agent App 接入", hint: "可用" },
    ],
  });
  triggerOf(host).click();
  await nextTick();

  const groups = [...host.querySelectorAll('[role="presentation"]')].map((el) => el.textContent);
  expect(groups).toEqual(["API Key 接入", "本地 Agent App 接入"]);
  expect(optionNamed(host, "Workbuddy / CodeBuddy").textContent).toContain("可用");
  expect(optionNamed(host, "OpenAI").textContent).not.toContain("可用");
});

it("选项带 icon（vendorId）时触发器与菜单都渲染供应商 logo", async () => {
  const { host } = mountSelect({
    modelValue: "openai",
    options: [
      { value: "openai", label: "OpenAI", icon: "openai", active: true },
      { value: "ollama", label: "Ollama", icon: "ollama" },
    ],
  });
  // 触发器当前项有 logo（svg）；未知厂商才走字母占位
  expect(triggerOf(host).querySelector("svg")).not.toBeNull();

  triggerOf(host).click();
  await nextTick();
  expect(optionNamed(host, "OpenAI").querySelector("svg")).not.toBeNull();
  expect(optionNamed(host, "Ollama").querySelector("svg")).not.toBeNull();
});

it("没有 group 时保持平铺，不插分组标题", async () => {
  const { host } = mountSelect();
  triggerOf(host).click();
  await nextTick();
  expect(host.querySelectorAll('[role="presentation"]')).toHaveLength(0);
  expect(host.querySelectorAll('[role="option"]')).toHaveLength(2);
});

it("点击外部收起列表", async () => {
  const { host } = mountSelect();
  triggerOf(host).click();
  await nextTick();
  expect(listboxOf(host)).not.toBeNull();

  document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
  await nextTick();

  expect(listboxOf(host)).toBeNull();
});

it("禁用时不打开列表", async () => {
  const { host } = mountSelect({ disabled: true });
  expect(triggerOf(host).disabled).toBe(true);

  triggerOf(host).click();
  await nextTick();

  expect(listboxOf(host)).toBeNull();
});

it("级联：左右两个下拉，左侧默认落到 defaultGroup，右侧只列该组接入商", async () => {
  const { host, model } = mountSelect({
    cascade: true,
    modelValue: "",
    defaultGroup: "本地 Agent App 接入",
    options: CASCADE_OPTIONS,
  });
  await nextTick();

  expect(host.querySelectorAll("button[aria-haspopup='true']")).toHaveLength(2);
  expect(triggerOf(host, 0).textContent).toContain("本地 Agent App 接入");
  // 空值时落到该组第一项
  expect(model.value).toBe("cursor-sdk");
  expect(triggerOf(host, 1).textContent).toContain("Cursor");

  triggerOf(host, 1).click();
  await nextTick();
  const rightOptions = [...host.querySelectorAll('[role="option"]')].map((el) => el.textContent ?? "");
  expect(rightOptions.some((text) => text.includes("Cursor"))).toBe(true);
  expect(rightOptions.some((text) => text.includes("Workbuddy"))).toBe(true);
  expect(rightOptions.some((text) => text.includes("OpenAI"))).toBe(false);
});

it("级联：切换接入方式后右侧换成该组接入商，并更新选中值", async () => {
  const { host, model } = mountSelect({
    cascade: true,
    modelValue: "cursor-sdk",
    defaultGroup: "本地 Agent App 接入",
    options: CASCADE_OPTIONS,
  });
  await nextTick();

  triggerOf(host, 0).click();
  await nextTick();
  optionNamed(host, "API Key 接入").click();
  await nextTick();
  await nextTick();

  expect(model.value).toBe("openai");
  expect(triggerOf(host, 0).textContent).toContain("API Key 接入");
  expect(triggerOf(host, 1).textContent).toContain("OpenAI");

  triggerOf(host, 1).click();
  await nextTick();
  const rightOptions = [...host.querySelectorAll('[role="option"]')].map((el) => el.textContent ?? "");
  expect(rightOptions.some((text) => text.includes("Ollama"))).toBe(true);
  expect(rightOptions.some((text) => text.includes("Cursor"))).toBe(false);
});

it("贴近视口底部打开时菜单翻转到上方，并按可用高度限高", async () => {
  const { host } = mountSelect();
  const trigger = triggerOf(host);
  // 视口 600；触发器贴底 → 应 above，限高吃上方空间（不超过 256）
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 600 });
  trigger.getBoundingClientRect = () =>
    ({
      top: 500,
      bottom: 536,
      left: 0,
      right: 200,
      width: 200,
      height: 36,
      x: 0,
      y: 500,
      toJSON() {
        return {};
      },
    }) as DOMRect;

  trigger.click();
  await nextTick();

  const panel = menuPanelOf(host);
  expect(panel).not.toBeNull();
  expect(panel?.getAttribute("data-placement")).toBe("above");
  expect(panel?.style.maxHeight).toBe("256px");
  expect(panel?.className).toContain("bottom-full");
});

it("下方空间充足时菜单仍向下开", async () => {
  const { host } = mountSelect();
  const trigger = triggerOf(host);
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 800 });
  trigger.getBoundingClientRect = () =>
    ({
      top: 100,
      bottom: 136,
      left: 0,
      right: 200,
      width: 200,
      height: 36,
      x: 0,
      y: 100,
      toJSON() {
        return {};
      },
    }) as DOMRect;

  trigger.click();
  await nextTick();

  const panel = menuPanelOf(host);
  expect(panel?.getAttribute("data-placement")).toBe("below");
  expect(panel?.style.maxHeight).toBe("256px");
  expect(panel?.className).toContain("top-full");
});

it("默认不可搜索：打开菜单没有搜索框", async () => {
  const { host } = mountSelect();
  triggerOf(host).click();
  await nextTick();
  expect(host.querySelector('input[type="search"]')).toBeNull();
});

it("可搜索：打开后按关键字过滤选项，无匹配显示空态", async () => {
  const { host } = mountSelect({
    searchable: true,
    searchPlaceholder: "搜索供应商",
    searchEmpty: "无匹配项",
    options: [
      { value: "openai", label: "OpenAI", group: "API Key 接入" },
      { value: "openrouter", label: "OpenRouter", group: "API Key 接入" },
      { value: "mistral", label: "Mistral", group: "API Key 接入" },
    ],
  });
  triggerOf(host).click();
  await nextTick();

  const input = host.querySelector<HTMLInputElement>('input[type="search"]');
  expect(input).not.toBeNull();
  expect(input?.placeholder).toBe("搜索供应商");
  expect(host.querySelectorAll('[role="option"]')).toHaveLength(3);

  input!.value = "open";
  input!.dispatchEvent(new Event("input", { bubbles: true }));
  await nextTick();

  const labels = [...host.querySelectorAll('[role="option"]')].map((el) => el.textContent ?? "");
  expect(labels.some((text) => text.includes("OpenAI"))).toBe(true);
  expect(labels.some((text) => text.includes("OpenRouter"))).toBe(true);
  expect(labels.some((text) => text.includes("Mistral"))).toBe(false);

  input!.value = "zzz-no-hit";
  input!.dispatchEvent(new Event("input", { bubbles: true }));
  await nextTick();
  expect(host.querySelectorAll('[role="option"]')).toHaveLength(0);
  expect(host.textContent).toContain("无匹配项");
});

it("可搜索：级联右侧也可按关键字过滤接入商", async () => {
  const { host } = mountSelect({
    cascade: true,
    searchable: true,
    modelValue: "openai",
    defaultGroup: "API Key 接入",
    options: [
      ...CASCADE_OPTIONS,
      { value: "openrouter", label: "OpenRouter", group: "API Key 接入" },
      { value: "mistral", label: "Mistral", group: "API Key 接入" },
    ],
  });
  await nextTick();
  triggerOf(host, 1).click();
  await nextTick();

  const input = host.querySelector<HTMLInputElement>('input[type="search"]');
  expect(input).not.toBeNull();
  input!.value = "mistral";
  input!.dispatchEvent(new Event("input", { bubbles: true }));
  await nextTick();

  const labels = [...host.querySelectorAll('[role="option"]')].map((el) => el.textContent ?? "");
  expect(labels.some((text) => text.includes("Mistral"))).toBe(true);
  expect(labels.some((text) => text.includes("OpenAI"))).toBe(false);
  expect(labels.some((text) => text.includes("Cursor"))).toBe(false);
});
