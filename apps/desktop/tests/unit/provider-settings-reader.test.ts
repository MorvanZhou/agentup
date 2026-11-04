import { expect, it } from "vitest";

import { readProviderSettings } from "../../src/shared/api/runtime/readers.js";
import { DesktopApiError } from "../../src/shared/api/runtime/error.js";

/** 最小可用响应体：只保留 reader 实际校验的字段。 */
function payload(agentSdks: unknown[], templates: unknown[] = []): Record<string, unknown> {
  return {
    connections: [],
    enabled_models: [],
    active_model: null,
    available_models: [],
    configured: false,
    overridden_by_environment: false,
    vendors: [],
    templates,
    agent_sdks: agentSdks,
  };
}

it("reads the CLI / SDK group with its local state", () => {
  const settings = readProviderSettings(
    payload([
      {
        template_id: "codebuddy-sdk",
        vendor_label: "CodeBuddy",
        option_label: "本地 CLI / SDK",
        label: "CodeBuddy（本地 SDK）",
        hint: "用本机订阅执行",
        package: "@tencent-ai/agent-sdk",
        size_hint_mb: 180,
        login_guide: { command: "cbc login", doc_url: null },
        state: "not_installed",
        installed_version: null,
        last_error: null,
        models: [],
      },
    ]),
  );
  expect(settings.agentSdks).toEqual([
    {
      templateId: "codebuddy-sdk",
      vendorLabel: "CodeBuddy",
      optionLabel: "本地 CLI / SDK",
      label: "CodeBuddy（本地 SDK）",
      hint: "用本机订阅执行",
      package: "@tencent-ai/agent-sdk",
      sizeHintMb: 180,
      loginGuide: { command: "cbc login", docUrl: null },
      state: "not_installed",
      installedVersion: null,
      lastError: null,
      accountLabel: null,
      models: [],
      authEnvironments: [],
      authEnvironment: null,
      apiKeyPaste: null,
    },
  ]);
});

it("reads api_key_paste capability for OpenCode, GitHub PAT, and DeepSeek", () => {
  const settings = readProviderSettings(
    payload([
      {
        template_id: "opencode-sdk",
        vendor_label: "OpenCode",
        option_label: "本地 Agent App",
        label: "OpenCode",
        hint: null,
        package: "opencode-ai",
        size_hint_mb: 180,
        login_guide: null,
        state: "not_logged_in",
        installed_version: "1.0.0",
        last_error: null,
        models: [],
        api_key_paste: "opencode",
      },
      {
        template_id: "copilot-sdk",
        vendor_label: "GitHub Copilot",
        option_label: "本地 Agent App",
        label: "GitHub Copilot",
        hint: null,
        package: "@github/copilot-sdk",
        size_hint_mb: 160,
        login_guide: null,
        state: "not_logged_in",
        installed_version: "1.0.28",
        last_error: null,
        models: [],
        api_key_paste: "github-pat",
      },
      {
        template_id: "deepseek-harness-sdk",
        vendor_label: "DeepSeek",
        option_label: "本地 Agent App",
        label: "DeepSeek Harness",
        hint: null,
        package: "@deepseek-ai/dsh-sdk-client",
        size_hint_mb: 100,
        login_guide: null,
        state: "not_logged_in",
        installed_version: "0.2.2-rc.1",
        last_error: null,
        models: [],
        api_key_paste: "deepseek",
      },
      {
        template_id: "codebuddy-sdk",
        vendor_label: "CodeBuddy",
        option_label: "本地 Agent App",
        label: "CodeBuddy",
        hint: null,
        package: "@tencent-ai/agent-sdk",
        size_hint_mb: 180,
        login_guide: null,
        state: "not_installed",
        installed_version: null,
        last_error: null,
        models: [],
        api_key_paste: "bogus",
      },
    ]),
  );
  expect(settings.agentSdks[0]?.apiKeyPaste).toBe("opencode");
  expect(settings.agentSdks[1]?.apiKeyPaste).toBe("github-pat");
  expect(settings.agentSdks[2]?.apiKeyPaste).toBe("deepseek");
  expect(settings.agentSdks[3]?.apiKeyPaste).toBeNull();
});

it("reads CodeBuddy auth site options and the remembered choice", () => {
  const settings = readProviderSettings(
    payload([
      {
        template_id: "codebuddy-sdk",
        vendor_label: "CodeBuddy",
        option_label: "本地 Agent App",
        label: "Workbuddy / CodeBuddy",
        hint: null,
        package: "@tencent-ai/agent-sdk",
        size_hint_mb: 180,
        login_guide: null,
        state: "not_logged_in",
        installed_version: "0.3.295",
        last_error: null,
        models: [],
        auth_environments: ["internal", "external", "bogus"],
        auth_environment: "internal",
      },
    ]),
  );
  expect(settings.agentSdks[0]?.authEnvironments).toEqual(["internal", "external"]);
  expect(settings.agentSdks[0]?.authEnvironment).toBe("internal");
});

it("reads the model catalog a local app reported", () => {
  const settings = readProviderSettings(
    payload([
      {
        template_id: "codebuddy-sdk",
        vendor_label: "CodeBuddy",
        option_label: "本地 Agent App",
        label: "Workbuddy / CodeBuddy",
        hint: null,
        package: "@tencent-ai/agent-sdk",
        size_hint_mb: 180,
        login_guide: null,
        state: "ready",
        installed_version: "0.3.295",
        last_error: null,
        models: [
          { id: "claude-sonnet-5", name: "Claude-Sonnet-5" },
          { id: "claude-sonnet-5", name: "重复 id 丢掉" },
          { id: 42, name: "脏数据丢掉" },
        ],
      },
    ]),
  );
  expect(settings.agentSdks[0]?.models).toEqual([{ id: "claude-sonnet-5", name: "Claude-Sonnet-5" }]);
});

it("reads the credit rate a local app reported and drops junk", () => {
  const settings = readProviderSettings(
    payload([
      {
        template_id: "codebuddy-sdk",
        vendor_label: "CodeBuddy",
        option_label: "本地 Agent App",
        label: "Workbuddy / CodeBuddy",
        hint: null,
        package: "@tencent-ai/agent-sdk",
        size_hint_mb: 180,
        login_guide: null,
        state: "ready",
        installed_version: "0.3.295",
        last_error: null,
        // 倍率是可选的：老 runtime 没有这个字段，null / 负数 / 字符串都当没有；0 是真实值要留
        models: [
          { id: "claude-sonnet-5", name: "Claude-Sonnet-5", credits: 1.33 },
          { id: "hy3-ioa", name: "Hunyuan", credits: 0 },
          { id: "claude-opus-5", name: "Claude-Opus-5", credits: null },
          { id: "broken", name: "Broken", credits: -1 },
          { id: "echo", name: "Echo", credits: "1.33x" },
        ],
      },
    ]),
  );
  expect(settings.agentSdks[0]?.models).toEqual([
    { id: "claude-sonnet-5", name: "Claude-Sonnet-5", credits: 1.33 },
    { id: "hy3-ioa", name: "Hunyuan", credits: 0 },
    { id: "claude-opus-5", name: "Claude-Opus-5" },
    { id: "broken", name: "Broken" },
    { id: "echo", name: "Echo" },
  ]);
});

it("falls back to not_installed for unknown states and missing access", () => {
  const settings = readProviderSettings(
    payload(
      [
        {
          template_id: "codebuddy-sdk",
          vendor_label: "CodeBuddy",
          option_label: "CLI",
          label: "CodeBuddy",
          hint: null,
          package: "@tencent-ai/agent-sdk",
          size_hint_mb: 180,
          login_guide: null,
          state: "something-new",
          installed_version: null,
          last_error: null,
        },
      ],
      [
        {
          id: "codebuddy-sdk",
          vendor_id: "codebuddy",
          vendor_label: "CodeBuddy",
          option_label: "CLI",
          label: "CodeBuddy",
          kind: "agent-sdk",
          pi_provider_id: "codebuddy-sdk",
          requires_api_key: false,
          supports_model_discovery: false,
          models: [],
        },
      ],
    ),
  );
  // 旧 runtime 不会带 access，按 kind 推断；未知状态不炸设置页
  expect(settings.agentSdks[0]?.state).toBe("not_installed");
  expect(settings.templates[0]?.access).toBe("agent-sdk");
});

it("reads the signed-in account of a local app", () => {
  const sdk = {
    template_id: "codebuddy-sdk",
    vendor_label: "CodeBuddy",
    option_label: "本地 Agent App",
    label: "Workbuddy / CodeBuddy",
    hint: null,
    package: "@tencent-ai/agent-sdk",
    size_hint_mb: 180,
    login_guide: null,
    state: "ready",
    installed_version: "0.3.295",
    last_error: null,
    models: [],
  };
  // 登录后才会有账号名；没登录 / 老 runtime 一律 null
  expect(readProviderSettings(payload([{ ...sdk, account_label: "morvanzhou" }])).agentSdks[0]?.accountLabel).toBe(
    "morvanzhou",
  );
  expect(readProviderSettings(payload([{ ...sdk, account_label: null }])).agentSdks[0]?.accountLabel).toBeNull();
  expect(readProviderSettings(payload([sdk])).agentSdks[0]?.accountLabel).toBeNull();
});

it("reads the credit rate on a model row and leaves API providers without one", () => {
  const body = payload([]);
  body.available_models = [
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
      credits: 1.33,
    },
    {
      template_id: "openai",
      model_id: "gpt-6",
      name: "GPT-6",
      vendor_id: "openai",
      vendor_label: "OpenAI",
      option_label: "官方 API",
      enabled: false,
      active: false,
      custom: false,
      credits: null,
    },
  ];
  const settings = readProviderSettings(body);
  expect(settings.availableModels.map((model) => model.credits)).toEqual([1.33, undefined]);
});

it("reads template label on model rows and falls back when an older runtime omits it", () => {
  const body = payload([]);
  body.available_models = [
    {
      template_id: "deepseek-harness-sdk",
      model_id: "deepseek-flash",
      name: "DeepSeek V4.1 Flash",
      vendor_id: "deepseek-harness",
      vendor_label: "DeepSeek",
      option_label: "本地 Agent App",
      label: "DeepSeek Harness",
      enabled: true,
      active: false,
      custom: false,
    },
    {
      template_id: "openai",
      model_id: "gpt-6",
      name: "GPT-6",
      vendor_id: "openai",
      vendor_label: "OpenAI",
      option_label: "官方 API",
      enabled: false,
      active: false,
      custom: false,
    },
  ];
  expect(readProviderSettings(body).availableModels.map((model) => model.label)).toEqual([
    "DeepSeek Harness",
    "",
  ]);
});

it("reads vendor_id on model rows and falls back when an older runtime omits it", () => {
  const body = payload([]);
  body.available_models = [
    {
      template_id: "openai",
      model_id: "gpt-6",
      name: "GPT-6",
      vendor_id: "openai",
      vendor_label: "OpenAI",
      option_label: "官方 API",
      enabled: true,
      active: false,
      custom: false,
    },
    {
      template_id: "ollama",
      model_id: "qwen3:4b",
      name: "qwen3:4b",
      vendor_label: "Ollama",
      option_label: "本机",
      enabled: false,
      active: false,
      custom: true,
    },
  ];
  expect(readProviderSettings(body).availableModels.map((model) => model.vendorId)).toEqual([
    "openai",
    "",
  ]);
});

it("rejects a response without the agent_sdks list", () => {
  const body = payload([]);
  delete body.agent_sdks;
  expect(() => readProviderSettings(body)).toThrow(DesktopApiError);
});
