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
  /** 额外模型行（测「仅已启用」筛选用）；默认只有一条已启用 */
  extraModels?: Array<{
    model_id: string;
    name: string;
    enabled: boolean;
  }>;
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
          ...(options?.extraModels ?? []).map((item) => ({
            template_id: "codebuddy-sdk",
            model_id: item.model_id,
            name: item.name,
            vendor_id: "codebuddy",
            vendor_label: "CodeBuddy",
            option_label: "本地 Agent App",
            enabled: item.enabled,
            active: false,
            custom: false,
            credits: null,
          })),
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

/**
 * 「启用服务」区也有供应商筛选下拉（同样 aria-haspopup）。
 * 接入商下拉按标签找，避免点到筛选器。
 */
function labeledTrigger(host: HTMLElement, labelText: string): HTMLButtonElement {
  const label = [...host.querySelectorAll("span")].find((el) => (el.textContent ?? "").trim() === labelText);
  const trigger = label?.parentElement?.querySelector<HTMLButtonElement>("button[aria-haspopup='true']");
  if (!trigger) throw new Error(`缺少「${labelText}」下拉`);
  return trigger;
}

function vendorTrigger(host: HTMLElement): HTMLButtonElement {
  return labeledTrigger(host, "接入商");
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

/** 入口卡文案含多行，用 includes 找 */
function gateButton(host: HTMLElement, title: string): HTMLButtonElement {
  const button = [...host.querySelectorAll("button")].find((el) =>
    (el.textContent ?? "").includes(title),
  );
  if (!button) throw new Error(`缺少入口「${title}」`);
  return button;
}

/** 点入口卡进入接入商下拉 + 配置 */
async function enterAccessGate(
  host: HTMLElement,
  mode: "接入本地 Agent 应用" | "接入 API 服务",
): Promise<void> {
  gateButton(host, mode).click();
  await nextTick();
  await vi.waitFor(() => expect(vendorTrigger(host)).toBeTruthy());
}

it("入口漏斗：先选本地/API，再出现接入商；启用列表仍在下方", async () => {
  const host = mountProviderSettings(payload());
  await waitLoaded(host);

  // 首屏：入口两卡 + 启用区；未点入口前没有接入商下拉
  expect(host.textContent).toContain("选择接入");
  expect(host.textContent).toContain("接入本地 Agent 应用");
  expect(host.textContent).toContain("接入 API 服务");
  expect(host.textContent).toContain("启用服务");
  expect(() => vendorTrigger(host)).toThrow(/缺少「接入商」下拉/);

  // 本地 App 的模型行仍在启用区（与入口漏斗无关）
  expect(host.textContent).toContain("Claude-Sonnet-5");
  const modelRow = [...host.querySelectorAll("li")].find((el) =>
    (el.textContent ?? "").includes("Claude-Sonnet-5"),
  );
  expect(modelRow?.getAttribute("title")).toContain("CodeBuddy");
  expect(host.querySelectorAll('[role="switch"]').length).toBeGreaterThan(0);

  // 进本地入口：接入商只有本地 App
  await enterAccessGate(host, "接入本地 Agent 应用");
  vendorTrigger(host).click();
  await nextTick();
  const sdkVendors = optionTexts(host);
  expect(sdkVendors.some((text) => text.includes("Workbuddy / CodeBuddy"))).toBe(true);
  expect(sdkVendors.some((text) => text.includes("OpenAI"))).toBe(false);

  // 更换 → API：接入商换成 API 目录
  document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
  await nextTick();
  const change = [...host.querySelectorAll("button")].find(
    (el) => (el.textContent ?? "").trim() === "返回",
  );
  if (!change) throw new Error("缺少返回");
  change.click();
  await nextTick();
  await enterAccessGate(host, "接入 API 服务");
  vendorTrigger(host).click();
  await nextTick();
  const apiVendors = optionTexts(host);
  expect(apiVendors.some((text) => text.includes("OpenAI"))).toBe(true);
  expect(apiVendors.some((text) => text.includes("Workbuddy / CodeBuddy"))).toBe(false);
  vi.restoreAllMocks();
});

it("勾选「仅已启用」后未开开关的模型从列表消失，取消勾选后回来", async () => {
  const host = mountProviderSettings(
    payload({
      extraModels: [
        { model_id: "gpt-off", name: "Off-Model", enabled: false },
        { model_id: "gpt-on", name: "On-Model", enabled: true },
      ],
    }),
  );
  await waitLoaded(host);

  // 默认看全部：已启用 + 未启用都在
  expect(host.textContent).toContain("Claude-Sonnet-5");
  expect(host.textContent).toContain("Off-Model");
  expect(host.textContent).toContain("On-Model");

  const enabledOnly = host.querySelector<HTMLInputElement>('input[type="checkbox"]');
  if (!enabledOnly) throw new Error("缺少「仅已启用」勾选");
  enabledOnly.click();
  await nextTick();

  expect(host.textContent).toContain("Claude-Sonnet-5");
  expect(host.textContent).toContain("On-Model");
  expect(host.textContent).not.toContain("Off-Model");

  // 旧路径：取消勾选仍看得到未启用项
  enabledOnly.click();
  await nextTick();
  expect(host.textContent).toContain("Off-Model");
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
  await enterAccessGate(host, "接入本地 Agent 应用");
  expect(host.textContent).toContain("账号 morvanzhou");
  // 可用后收掉待接入排雷，只留短信任条
  expect(host.textContent).toContain("信任模式已开启");
  expect(host.textContent).not.toContain("不需要先装桌面版");

  // 没登录（account_label 为 null）不该留一个空的「账号」标签
  const plain = mountProviderSettings(payload({ sdkOnly: true, sdkAccount: null }));
  await waitLoaded(plain);
  await enterAccessGate(plain, "接入本地 Agent 应用");
  expect(plain.textContent).not.toContain("账号");
  vi.restoreAllMocks();
});

it("已登录的本地 App 能登出：按钮打到 runtime 登出口，状态回落后按钮消失", async () => {
  // sdkOnly：进本地入口后卡片直接渲染，不必在用例里切分支
  const host = mountProviderSettings(payload({ sdkOnly: true }));
  await waitLoaded(host);
  await enterAccessGate(host, "接入本地 Agent 应用");
  // 登出只清登录态：runtime 回一份 not_logged_in 的设置
  const spy = vi.spyOn(DesktopApi.prototype, "logoutAgentSdk");
  spy.mockResolvedValue(readProviderSettings(payload({ sdkOnly: true, sdkState: "not_logged_in" })));

  const button = buttonByText(host, "登出");
  if (!button) throw new Error("缺少登出按钮");
  button.click();
  await vi.waitFor(() => expect(spy.mock.calls[0]?.[1]).toBe("codebuddy-sdk"));
  // 回到未登录后登出入口就该收起（SDK 还装着的，移除接入仍在）
  await vi.waitFor(() => expect(buttonByText(host, "登出")).toBeNull());
  expect(buttonByText(host, "移除接入")).not.toBeNull();
  vi.restoreAllMocks();
});

it("没登录的本地 App 不显示登出", async () => {
  const host = mountProviderSettings(payload({ sdkOnly: true, sdkState: "not_logged_in" }));
  await waitLoaded(host);
  await enterAccessGate(host, "接入本地 Agent 应用");
  // 卡片已渲染（移除接入在），但没登录就没有登出可言
  expect(buttonByText(host, "移除接入")).not.toBeNull();
  expect(buttonByText(host, "登出")).toBeNull();
  vi.restoreAllMocks();
});

it("还没装本地 App 时接入商下拉里仍可选它，列表保持空态", async () => {
  const host = mountProviderSettings(payload({ sdkReady: false }));
  await waitLoaded(host);
  await enterAccessGate(host, "接入本地 Agent 应用");

  // 待接入：一句排雷 + 短信任，不叠 hint/副行
  expect(host.textContent).toContain("待接入");
  expect(host.textContent).toContain("不需要先装桌面版");
  expect(host.textContent).toContain("信任模式");
  expect(buttonByText(host, "移除接入")).toBeNull();
  vendorTrigger(host).click();
  await nextTick();

  const labels = optionTexts(host);
  expect(labels.some((text) => text.includes("Workbuddy / CodeBuddy"))).toBe(true);
  // 没登录 → 没有模型行可启用
  expect(host.querySelectorAll('[role="switch"]')).toHaveLength(0);
  vi.restoreAllMocks();
});
