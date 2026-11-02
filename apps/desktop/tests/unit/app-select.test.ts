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

function mountSelect(
  opts?: { modelValue?: string; disabled?: boolean; options?: AppSelectOption[] },
): Harness {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const model = ref(opts?.modelValue ?? "openai");
  const app = createApp({
    setup() {
      return () =>
        h(AppSelect, {
          modelValue: model.value,
          label: "供应商",
          options: opts?.options ?? OPTIONS,
          disabled: opts?.disabled,
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

function triggerOf(host: HTMLElement): HTMLButtonElement {
  const button = host.querySelector<HTMLButtonElement>("button[aria-haspopup='true']");
  if (!button) throw new Error("missing AppSelect trigger");
  return button;
}

function listboxOf(host: HTMLElement): HTMLElement | null {
  return host.querySelector('[role="listbox"]');
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
