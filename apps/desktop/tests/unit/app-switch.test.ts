/** @vitest-environment happy-dom */
import { createApp, h, nextTick, ref, type App, type Ref } from "vue";
import { afterEach, expect, it } from "vitest";

import AppSwitch from "../../src/shared/components/AppSwitch.vue";

type Harness = {
  host: HTMLElement;
  model: Ref<boolean>;
  app: App;
};

let harness: Harness | null = null;

function mountSwitch(opts?: { modelValue?: boolean; disabled?: boolean }): Harness {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const model = ref(opts?.modelValue ?? false);
  const app = createApp({
    setup() {
      return () =>
        h(AppSwitch, {
          modelValue: model.value,
          ariaLabel: "菜单栏图标",
          disabled: opts?.disabled,
          "onUpdate:modelValue": (value: boolean) => {
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

function switchOf(host: HTMLElement): HTMLButtonElement {
  const button = host.querySelector<HTMLButtonElement>('[role="switch"]');
  if (!button) throw new Error("missing AppSwitch");
  return button;
}

it("renders unchecked switch and toggles on click", async () => {
  const { host, model } = mountSwitch({ modelValue: false });
  const control = switchOf(host);
  expect(control.getAttribute("aria-checked")).toBe("false");
  expect(control.getAttribute("aria-label")).toBe("菜单栏图标");

  control.click();
  await nextTick();
  expect(model.value).toBe(true);
});

it("renders checked switch without throwing when disabled", () => {
  const { host } = mountSwitch({ modelValue: true, disabled: true });
  const control = switchOf(host);
  expect(control.getAttribute("aria-checked")).toBe("true");
  expect(control.disabled).toBe(true);
});
