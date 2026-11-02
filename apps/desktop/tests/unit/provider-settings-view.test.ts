/** @vitest-environment happy-dom */
import { nextTick, ref } from "vue";
import { afterEach, expect, it, vi } from "vitest";

import { desktopKey } from "../../src/app/desktop.js";
import ProviderSettings from "../../src/pages/settings/components/sections/app-settings/ProviderSettings.vue";
import { DesktopApi } from "../../src/shared/api/runtime/index.js";
import { readProviderSettings } from "../../src/shared/api/runtime/readers.js";
import { mountView } from "./mount-view.js";

/** 最小可用的一份设置：一个 API 服务商 + 一个已登录的本地 App。 */
function payload(options?: {
  sdkReady?: boolean;
  sdkModels?: boolean;
  sdkState?: string;
  /** 只留本地 App：默认选中项就是它，卡片不用等下拉切换（切分支在 happy-dom 下会炸，见文件尾注） */
  sdkOnly?: boolean;
  /** 模型行的 credit 消耗倍率；不传就是「本地 App 没报倍率」 */
  modelCredits?: number;
  /** 登录后 runtime 记住的账号名；不传就是没登录 */
  sdkAccount?: string | null;
}) {
  const sdkReady = options?.sdkReady ?? true;
  const sdkModels = options?.sdkModels ?? true;
  const sdkState = options?.sdkState ?? (sdkReady ? "ready" : "not_installed");
  return {
    connections: [],
    enabled_models: [],
    active_model: null,
    available_models: sdkReady
      ? [
          {
            template_id: "codebuddy-sdk",
            model_id: "claude-sonnet-5",
            name: "Claude-Sonnet-5",
            vendor_id: "codebuddy",
            vendor_label: "CodeBuddy",
            option_label: "本地 Agent App",
            enabled: true,
            active: false,
            custom: false,
            credits: options?.modelCredits ?? null,
          },
        ]
      : [],
    configured: sdkReady,
    overridden_by_environment: false,
    vendors: [],
    templates: [
      {
        id: "openai",
        vendor_id: "openai",
        vendor_label: "OpenAI",
        option_label: "官方 API",
        label: "OpenAI · 官方 API",
        kind: "pi-native",
        access: "api",
        pi_provider_id: "openai",
        requires_api_key: true,
        supports_model_discovery: false,
        models: [],
      },
      {
        id: "codebuddy-sdk",
        vendor_id: "codebuddy",
        vendor_label: "CodeBuddy",
        option_label: "本地 Agent App",
        label: "Workbuddy / CodeBuddy",
        kind: "agent-sdk",
        access: "agent-sdk",
        pi_provider_id: "codebuddy-sdk",
        requires_api_key: false,
        default_model_id: "default",
        supports_model_discovery: false,
        models: [],
      },
    ].filter((item) => (options?.sdkOnly ? item.access === "agent-sdk" : true)),
    agent_sdks: [
      {
        template_id: "codebuddy-sdk",
        vendor_label: "CodeBuddy",
        option_label: "本地 Agent App",
        label: "Workbuddy / CodeBuddy",
        hint: null,
        package: "@tencent-ai/agent-sdk",
        size_hint_mb: 180,
        login_guide: null,
        state: sdkState,
        installed_version: sdkReady ? "0.3.295" : null,
        last_error: null,
        account_label: options?.sdkAccount ?? null,
        models: sdkModels && sdkReady ? [{ id: "claude-sonnet-5", name: "Claude-Sonnet-5" }] : [],
      },
    ],
  };
}

/** 组件从 `useDesktop()` 取 session；这里只给它需要的一项。 */
function mountProviderSettings(body: Record<string, unknown>): HTMLElement {
  const spy = vi.spyOn(DesktopApi.prototype, "providerSettings");
  // 走真实 reader：组件拿到的是解析后的形状，raw payload 会掩盖解析问题
  spy.mockResolvedValue(readProviderSettings(body));
  return mountView(ProviderSettings, {
    provide: [[desktopKey, { session: ref({ token: "token" }) }]],
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

/** 骨架退场 = 配置已到位（搜索框只在 loaded 之后渲染）。 */
async function waitLoaded(host: HTMLElement): Promise<void> {
  await vi.waitFor(() => expect(host.querySelector('input[type="search"]')).not.toBeNull());
}

function optionTexts(host: HTMLElement): string[] {
  return [...host.querySelectorAll('[role="option"]')].map((el) => el.textContent ?? "");
}

/** 取某一行模型的整行文案（模型名 + 副标题都在里面）。 */
function rowTextOf(host: HTMLElement, modelName: string): string {
  const row = [...host.querySelectorAll("li")].find((el) =>
    (el.textContent ?? "").includes(modelName),
  );
  return row?.textContent?.replace(/\s+/g, " ").trim() ?? "";
}

/** 按可见文案找按钮（登出按钮只在某些状态下出现）。 */
function buttonByText(host: HTMLElement, text: string): HTMLButtonElement | null {
  return (
    [...host.querySelectorAll("button")].find((el) => (el.textContent ?? "").trim() === text) ?? null
  );
}

it("下拉分两组，本地 App 的模型出现在「启用服务」里", async () => {
  const host = mountProviderSettings(payload());
  await waitLoaded(host);

  // 本地 App 的模型行 + 开关；服务商名改挂 title，行内只留模型名
  expect(host.textContent).toContain("Claude-Sonnet-5");
  const modelRow = [...host.querySelectorAll("li")].find((el) =>
    (el.textContent ?? "").includes("Claude-Sonnet-5"),
  );
  expect(modelRow?.getAttribute("title")).toContain("CodeBuddy");
  expect(host.querySelectorAll('[role="switch"]').length).toBeGreaterThan(0);

  // 打开下拉：应有两个分组标题
  const trigger = host.querySelector<HTMLButtonElement>("button[aria-haspopup='true']");
  if (!trigger) throw new Error("缺少接入方式下拉");
  trigger.click();
  await nextTick();
  const groups = [...host.querySelectorAll('[role="presentation"]')].map(
    (el) => el.textContent ?? "",
  );
  expect(groups.filter((text) => text.includes("API Key 接入")).length).toBe(1);
  expect(groups.filter((text) => text.includes("本地 Agent App 接入")).length).toBe(1);
  const labels = optionTexts(host);
  expect(labels.some((text) => text.includes("Workbuddy / CodeBuddy"))).toBe(true);
  expect(labels.some((text) => text.includes("OpenAI"))).toBe(true);
  vi.restoreAllMocks();
});

it("本地 App 的模型行显示 credit 倍率，没报倍率就不显示", async () => {
  const withRate = mountProviderSettings(payload({ modelCredits: 1.33 }));
  await waitLoaded(withRate);
  // 右侧倍率：两位小数 + x（对齐 Composer 下拉参考稿）
  expect(rowTextOf(withRate, "Claude-Sonnet-5")).toContain("1.33x");

  // 0 是真实倍率（自部署 / 免费档），照样显示，不能因为 falsy 就藏起来
  const zero = mountProviderSettings(payload({ modelCredits: 0 }));
  await waitLoaded(zero);
  expect(rowTextOf(zero, "Claude-Sonnet-5")).toContain("0.00x");

  // 老 runtime / API 服务商没报倍率：不显示
  const withoutRate = mountProviderSettings(payload());
  await waitLoaded(withoutRate);
  expect(rowTextOf(withoutRate, "Claude-Sonnet-5")).not.toMatch(/\d+(\.\d+)?x/);
  vi.restoreAllMocks();
});

it("已登录的本地 App 在卡片上显示账号，没登录就不显示", async () => {
  const host = mountProviderSettings(payload({ sdkOnly: true, sdkAccount: "morvanzhou" }));
  await waitLoaded(host);
  expect(host.textContent).toContain("账号 morvanzhou");

  // 没登录（account_label 为 null）不该留一个空的「账号」标签
  const plain = mountProviderSettings(payload({ sdkOnly: true, sdkAccount: null }));
  await waitLoaded(plain);
  expect(plain.textContent).not.toContain("账号");
  vi.restoreAllMocks();
});

it("已登录的本地 App 能登出：按钮打到 runtime 登出口，状态回落后按钮消失", async () => {
  // sdkOnly：默认选中项就是本地 App，卡片直接渲染，不必在用例里切分支
  const host = mountProviderSettings(payload({ sdkOnly: true }));
  await waitLoaded(host);
  // 登出只清登录态：runtime 回一份 not_logged_in 的设置
  const spy = vi.spyOn(DesktopApi.prototype, "logoutAgentSdk");
  spy.mockResolvedValue(readProviderSettings(payload({ sdkOnly: true, sdkState: "not_logged_in" })));

  const button = buttonByText(host, "登出");
  if (!button) throw new Error("缺少登出按钮");
  button.click();
  await vi.waitFor(() => expect(spy.mock.calls[0]?.[1]).toBe("codebuddy-sdk"));
  // 回到未登录后登出入口就该收起（SDK 还装着的，卸载仍在）
  await vi.waitFor(() => expect(buttonByText(host, "登出")).toBeNull());
  expect(buttonByText(host, "卸载")).not.toBeNull();
  vi.restoreAllMocks();
});

it("没登录的本地 App 不显示登出", async () => {
  const host = mountProviderSettings(payload({ sdkOnly: true, sdkState: "not_logged_in" }));
  await waitLoaded(host);
  // 卡片已渲染（卸载在），但没登录就没有登出可言
  expect(buttonByText(host, "卸载")).not.toBeNull();
  expect(buttonByText(host, "登出")).toBeNull();
  vi.restoreAllMocks();
});

it("还没装本地 App 时下拉里仍可选它，列表保持空态", async () => {
  const host = mountProviderSettings(payload({ sdkReady: false }));
  await waitLoaded(host);

  const trigger = host.querySelector<HTMLButtonElement>("button[aria-haspopup='true']");
  if (!trigger) throw new Error("缺少接入方式下拉");
  trigger.click();
  await nextTick();

  const labels = optionTexts(host);
  expect(labels.some((text) => text.includes("Workbuddy / CodeBuddy"))).toBe(true);
  // 没登录 → 没有模型行可启用
  expect(host.querySelectorAll('[role="switch"]')).toHaveLength(0);
  vi.restoreAllMocks();
});
