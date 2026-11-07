/**
 * @vitest-environment happy-dom
 */
import { expect, it } from "vitest";

import ApiKeyPasteBlock from "../../src/pages/settings/components/sections/app-settings/provider-sdk/parts/ApiKeyPasteBlock.vue";
import { mountView } from "./mount-view";

const baseProps = {
  modelValue: "",
  busy: false,
  label: "API Key",
  hint: "paste hint",
  placeholder: "sk-…",
  submitLabel: "submit",
  cancelLabel: "cancel",
};

it("两步流程：步骤 1 显性展示 URL + 外跳入口，步骤 2 为粘贴", () => {
  const url = "https://console.anthropic.com/settings/keys";
  const host = mountView(ApiKeyPasteBlock, {
    props: { ...baseProps, docUrl: url },
  });
  expect(host.querySelector('[data-testid="sdk-api-key-step-1"]')).toBeTruthy();
  expect(host.querySelector('[data-testid="sdk-api-key-step-2"]')).toBeTruthy();
  const open = host.querySelector('[data-testid="sdk-api-key-open-doc"]');
  expect(open).toBeTruthy();
  expect(open?.textContent).toContain(url);
  expect(open?.querySelector("svg")).toBeTruthy();
});

it("无申请页 URL 时仍是两步壳，步骤 1 无外跳按钮", () => {
  const host = mountView(ApiKeyPasteBlock, {
    props: { ...baseProps, docUrl: null },
  });
  expect(host.querySelector('[data-testid="sdk-api-key-step-1"]')).toBeTruthy();
  expect(host.querySelector('[data-testid="sdk-api-key-step-2"]')).toBeTruthy();
  expect(host.querySelector('[data-testid="sdk-api-key-open-doc"]')).toBeNull();
});

it("有 requiredPermissions / hintImage 时步骤 1 展示必勾清单与截图", () => {
  const host = mountView(ApiKeyPasteBlock, {
    props: {
      ...baseProps,
      permissionsTitle: "Must enable:",
      requiredPermissions: ["Copilot Requests", "Copilot Chat"],
      hintImageSrc: "data:image/gif;base64,R0lGODlhAQABAAAAACw=",
      hintImageAlt: "permissions screenshot",
    },
  });
  const callout = host.querySelector('[data-testid="sdk-api-key-permissions"]');
  expect(callout).toBeTruthy();
  expect(callout?.textContent).toContain("Must enable:");
  expect(callout?.textContent).toContain("Copilot Requests");
  expect(callout?.textContent).toContain("Copilot Chat");
  const img = callout?.querySelector("img");
  expect(img?.getAttribute("alt")).toBe("permissions screenshot");
  expect(img?.getAttribute("src")).toContain("data:image/gif");
});

it("未传权限清单时不渲染权限示意块（旧粘贴档仍可用）", () => {
  const host = mountView(ApiKeyPasteBlock, {
    props: baseProps,
  });
  expect(host.querySelector('[data-testid="sdk-api-key-permissions"]')).toBeNull();
});
