import { expect, it } from "vitest";

import { listProviderTemplateViews, listVendorGroups } from "../src/config/provider-templates.js";

/** A 档 + OpenCode 网关：pi-ai 内置、API Key 直连；缺任一则设置页目录回退。 */
const PI_NATIVE_A_TIER = [
  "openrouter",
  "xai",
  "mistral",
  "groq",
  "minimax",
  "minimax-cn",
  "fireworks",
  "together",
  "nvidia",
  "huggingface",
  "opencode",
  "opencode-go",
] as const;

it("resolves provider copy for zh and en", () => {
  const zh = listProviderTemplateViews("zh");
  const en = listProviderTemplateViews("en");
  const zhOllama = zh.find((item) => item.id === "ollama");
  const enOllama = en.find((item) => item.id === "ollama");
  expect(zhOllama?.vendorLabel).toBe("Ollama（本机）");
  expect(enOllama?.vendorLabel).toBe("Ollama (local)");
  expect(zhOllama?.hint).toContain("本机已下载的模型");
  expect(enOllama?.hint).toContain("locally installed models");

  const zhZhipu = listVendorGroups("zh").find((item) => item.id === "zhipu");
  const enZhipu = listVendorGroups("en").find((item) => item.id === "zhipu");
  expect(zhZhipu?.label).toBe("智谱");
  expect(enZhipu?.label).toBe("Zhipu");
});

it("A 档 pi-native 模板已登记且带模型目录", () => {
  const views = listProviderTemplateViews("zh");
  for (const id of PI_NATIVE_A_TIER) {
    const template = views.find((item) => item.id === id);
    expect(template, id).toBeDefined();
    expect(template?.kind).toBe("pi-native");
    expect(template?.access).toBe("api");
    expect(template?.requiresApiKey).toBe(true);
    expect((template?.models?.length ?? 0) > 0, `${id} models`).toBe(true);
  }
  const minimax = listVendorGroups("zh").find((item) => item.id === "minimax");
  expect(minimax?.options.map((item) => item.id)).toEqual(["minimax", "minimax-cn"]);
  // API Key 组下的 OpenCode ≠ agent-sdk 的 opencode-sdk
  const opencode = listVendorGroups("zh").find((item) => item.id === "opencode");
  expect(opencode?.options.map((item) => item.id)).toEqual(["opencode", "opencode-go"]);
  expect(opencode?.options.every((item) => item.access === "api")).toBe(true);
});
