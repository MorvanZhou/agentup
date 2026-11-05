import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { expect, it } from "vitest";

import {
  listAgentSdkTemplates,
  listProviderTemplateViews,
  listVendorGroups,
} from "../src/config/provider-templates.js";
import {
  agentSdkModels,
  loadModelConfigFromRef,
  readProviderSettings,
  setAgentSdkModels,
  setAgentSdkState,
  setModelEnabled,
  upsertProviderConnection,
} from "../src/config/provider/index.js";

function tempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "agentup-agent-sdk-"));
}

/** 手写一份 v2 档案，验证升级到 v3 不会丢连接。 */
function writeV2(root: string): void {
  const dir = path.join(root, "settings");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "provider.json"),
    JSON.stringify({
      version: 2,
      connections: [{ templateId: "ollama", baseUrl: "http://127.0.0.1:11434/v1" }],
      enabledModels: [{ templateId: "ollama", modelId: "qwen3:4b" }],
      activeModel: { templateId: "ollama", modelId: "qwen3:4b" },
    }),
  );
}

it("keeps SDK access out of the API-key vendor dropdown", () => {
  const template = listProviderTemplateViews("zh").find((item) => item.id === "codebuddy-sdk");
  expect(template?.access).toBe("agent-sdk");
  expect(template?.agentSdk?.package).toBe("@tencent-ai/agent-sdk");
  expect(template?.agentSdk?.sizeHintMb).toBeGreaterThan(0);

  const vendors = listVendorGroups("zh");
  for (const vendor of vendors) {
    expect(vendor.options.some((option) => option.access === "agent-sdk")).toBe(false);
  }
  expect(listAgentSdkTemplates("zh").map((item) => item.id)).toContain("codebuddy-sdk");
});

it("starts as not_installed and never disabled by stale files", () => {
  const root = tempRoot();
  const view = readProviderSettings(root, {}, "zh");
  const sdk = view.agentSdks.find((item) => item.templateId === "codebuddy-sdk");
  expect(sdk?.state).toBe("not_installed");
});

it("盘上已有包但状态丢失时，读设置对齐为 installed（勿仍显示开始接入）", () => {
  const root = tempRoot();
  const pkgDir = path.join(
    root,
    "agent-sdks",
    "codebuddy-sdk",
    "node_modules",
    "@tencent-ai",
    "agent-sdk",
  );
  fs.mkdirSync(pkgDir, { recursive: true });
  fs.writeFileSync(
    path.join(pkgDir, "package.json"),
    JSON.stringify({ name: "@tencent-ai/agent-sdk", version: "0.3.295" }),
  );

  const sdk = readProviderSettings(root, {}, "zh").agentSdks.find(
    (item) => item.templateId === "codebuddy-sdk",
  );
  expect(sdk).toMatchObject({
    state: "installed",
    installedVersion: "0.3.295",
  });
  // 再读仍稳定；不覆盖已登录
  setAgentSdkState(root, "codebuddy-sdk", "ready", { installedVersion: "0.3.295" });
  expect(
    readProviderSettings(root, {}, "zh").agentSdks.find(
      (item) => item.templateId === "codebuddy-sdk",
    )?.state,
  ).toBe("ready");
});

it("migrates a v2 provider.json without losing connections", () => {
  const root = tempRoot();
  writeV2(root);
  const view = readProviderSettings(root, {}, "zh");
  expect(view.connections.map((item) => item.templateId)).toEqual(["ollama"]);
  expect(view.activeModel).toEqual({ templateId: "ollama", modelId: "qwen3:4b" });
  expect(view.agentSdks.every((item) => item.state === "not_installed")).toBe(true);
});

it("persists agent sdk state and keeps it across writes", () => {
  const root = tempRoot();
  setAgentSdkState(root, "codebuddy-sdk", "ready", { installedVersion: "0.3.295" });
  let view = readProviderSettings(root, {}, "zh");
  expect(view.agentSdks.find((item) => item.templateId === "codebuddy-sdk")).toMatchObject({
    state: "ready",
    installedVersion: "0.3.295",
  });

  // 走一遍普通连接写入，确认 agentSdks 不被覆盖丢失
  upsertProviderConnection(root, { templateId: "ollama", baseUrl: "http://127.0.0.1:11434/v1" });
  view = readProviderSettings(root, {}, "zh");
  expect(view.agentSdks.find((item) => item.templateId === "codebuddy-sdk")?.state).toBe("ready");
});

it("drops records for unknown templates or states", () => {
  const root = tempRoot();
  const dir = path.join(root, "settings");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "provider.json"),
    JSON.stringify({
      version: 3,
      connections: [],
      enabledModels: [],
      activeModel: null,
      agentSdks: [
        { templateId: "codebuddy-sdk", state: "ready" },
        { templateId: "not-a-template", state: "ready" },
        { templateId: "codebuddy-sdk", state: "wat" },
      ],
    }),
  );
  const view = readProviderSettings(root, {}, "zh");
  const records = view.agentSdks.filter((item) => item.templateId === "codebuddy-sdk");
  expect(records).toHaveLength(1);
  expect(records[0]?.state).toBe("ready");
});

it("refuses to connect an SDK template like an API-key provider", () => {
  const root = tempRoot();
  // 本地接入没有 Base URL / API Key 可填，只能走安装 + 登录
  expect(() => upsertProviderConnection(root, { templateId: "codebuddy-sdk" })).toThrow(
    /CLI \/ SDK/,
  );
  expect(() =>
    upsertProviderConnection(root, { templateId: "ollama", baseUrl: "http://x/v1" }),
  ).not.toThrow();
});

it("lists SDK models only after the local app is signed in", () => {
  const root = tempRoot();
  setAgentSdkState(root, "codebuddy-sdk", "ready", { installedVersion: "0.3.295" });
  // 还没查过模型：回落到模板默认项，列表不该是空的
  const before = readProviderSettings(root, {}, "zh");
  expect(before.availableModels.map((item) => item.modelId)).toContain("default");

  setAgentSdkModels(root, "codebuddy-sdk", [
    { id: "claude-sonnet-5", name: "Claude-Sonnet-5" },
    { id: "claude-opus-5", name: "Claude-Opus-5" },
  ]);
  const after = readProviderSettings(root, {}, "zh");
  const rows = after.availableModels.filter((item) => item.templateId === "codebuddy-sdk");
  expect(rows.map((item) => item.modelId)).toEqual(["claude-sonnet-5", "claude-opus-5"]);
  expect(rows[0]?.vendorLabel).toBe("Workbuddy / CodeBuddy");
  expect(after.agentSdks.find((item) => item.templateId === "codebuddy-sdk")?.models).toHaveLength(
    2,
  );

  // 没登录的本地 App 不该出现在「启用服务」里
  const other = tempRoot();
  setAgentSdkState(other, "codebuddy-sdk", "installed");
  setAgentSdkModels(other, "codebuddy-sdk", [{ id: "claude-sonnet-5", name: "Claude-Sonnet-5" }]);
  expect(
    readProviderSettings(other, {}, "zh").availableModels.filter(
      (item) => item.templateId === "codebuddy-sdk",
    ),
  ).toEqual([]);
});

it("enables an SDK model when signed in and refuses before that", () => {
  const root = tempRoot();
  setAgentSdkState(root, "codebuddy-sdk", "ready");
  setAgentSdkModels(root, "codebuddy-sdk", [{ id: "claude-sonnet-5", name: "Claude-Sonnet-5" }]);
  expect(() =>
    setModelEnabled(root, { templateId: "codebuddy-sdk", modelId: "claude-sonnet-5" }, true),
  ).not.toThrow();
  const view = readProviderSettings(root, {}, "zh");
  expect(view.configured).toBe(true);
  expect(
    view.availableModels.find((item) => item.modelId === "claude-sonnet-5")?.enabled,
  ).toBe(true);
  // 目录外的模型不给启用
  expect(() =>
    setModelEnabled(root, { templateId: "codebuddy-sdk", modelId: "not-in-catalog" }, true),
  ).toThrow(/目录/);

  const other = tempRoot();
  setAgentSdkState(other, "codebuddy-sdk", "installed");
  expect(() =>
    setModelEnabled(other, { templateId: "codebuddy-sdk", modelId: "claude-sonnet-5" }, true),
  ).toThrow(/请先安装并登录/);
});

it("keeps an enabled SDK model across restarts but only while signed in", () => {
  const root = tempRoot();
  setAgentSdkState(root, "codebuddy-sdk", "ready");
  setAgentSdkModels(root, "codebuddy-sdk", [{ id: "claude-sonnet-5", name: "Claude-Sonnet-5" }]);
  setModelEnabled(root, { templateId: "codebuddy-sdk", modelId: "claude-sonnet-5" }, true);
  expect(agentSdkModels(root, "codebuddy-sdk")).toHaveLength(1);

  const file = path.join(root, "settings", "provider.json");
  const raw = JSON.parse(fs.readFileSync(file, "utf8")) as {
    enabledModels: Array<{ templateId: string; modelId: string }>;
  };
  expect(raw.enabledModels).toEqual([{ templateId: "codebuddy-sdk", modelId: "claude-sonnet-5" }]);
  const reread = readProviderSettings(root, {}, "zh");
  expect(reread.availableModels.find((item) => item.modelId === "claude-sonnet-5")?.enabled).toBe(
    true,
  );

  // 卸载后状态回到未安装，这条启用记录就该被丢掉，而不是留个永远不可用的模型
  setAgentSdkState(root, "codebuddy-sdk", "not_installed");
  const after = readProviderSettings(root, {}, "zh");
  expect(after.enabledModels).toEqual([]);
  expect(after.availableModels).toEqual([]);
  expect(after.configured).toBe(false);
});

it("已登录的本地 App 可以直接作为会话模型加载", () => {
  const root = tempRoot();
  setAgentSdkState(root, "codebuddy-sdk", "ready", { installedVersion: "0.3.295" });
  setAgentSdkModels(root, "codebuddy-sdk", [{ id: "claude-sonnet-5", name: "Claude-Sonnet-5" }]);
  const config = loadModelConfigFromRef(
    root,
    { templateId: "codebuddy-sdk", modelId: "claude-sonnet-5" },
    {},
  );
  // 不需要 connection：本地 App 靠安装 + 登录，不靠密钥
  expect(config).toMatchObject({
    providerId: "codebuddy-sdk",
    templateId: "codebuddy-sdk",
    modelId: "claude-sonnet-5",
    kind: "agent-sdk",
    apiKey: "ollama",
  });

  // 没登录就不该被选成会话模型
  setAgentSdkState(root, "codebuddy-sdk", "not_logged_in");
  expect(() =>
    loadModelConfigFromRef(root, { templateId: "codebuddy-sdk", modelId: "claude-sonnet-5" }, {}),
  ).toThrow(/请先安装并登录/);
});

it("drops malformed SDK model entries", () => {
  const root = tempRoot();
  setAgentSdkState(root, "codebuddy-sdk", "ready");
  setAgentSdkModels(root, "codebuddy-sdk", [
    { id: "ok", name: "OK" },
    { id: "", name: "没 id" },
    { id: "ok", name: "重复 id" },
  ]);
  expect(agentSdkModels(root, "codebuddy-sdk")).toEqual([{ id: "ok", name: "OK" }]);
});
