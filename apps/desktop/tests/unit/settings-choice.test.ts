/** @vitest-environment happy-dom */
import { createApp, h, nextTick, type App } from "vue";
import { afterEach, expect, it, vi } from "vitest";

import SettingsChoice from "../../src/pages/settings/components/SettingsChoice.vue";

let harness: { host: HTMLElement; app: App } | null = null;

afterEach(() => {
  harness?.app.unmount();
  harness?.host.remove();
  harness = null;
});

it("SettingsChoice 点击会向父级 emit click（不靠 attrs fallthrough）", async () => {
  const onClick = vi.fn();
  const host = document.createElement("div");
  document.body.appendChild(host);
  const app = createApp({
    setup() {
      return () => h(SettingsChoice, { selected: false, disabled: false, onClick }, () => "English");
    },
  });
  app.mount(host);
  harness = { host, app };

  const button = host.querySelector("button");
  expect(button).toBeTruthy();
  expect(button!.disabled).toBe(false);
  // 选项砖自身 no-drag，避免落在祖先 drag 命中里
  expect(button!.className).toContain("app-no-drag");
  button!.click();
  await nextTick();
  expect(onClick).toHaveBeenCalledTimes(1);
});

it("disabled 时不 emit click", async () => {
  const onClick = vi.fn();
  const host = document.createElement("div");
  document.body.appendChild(host);
  const app = createApp({
    setup() {
      return () => h(SettingsChoice, { selected: false, disabled: true, onClick }, () => "English");
    },
  });
  app.mount(host);
  harness = { host, app };

  host.querySelector("button")!.click();
  await nextTick();
  expect(onClick).not.toHaveBeenCalled();
});
