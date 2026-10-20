import { expect, it } from "vitest";

import { listProviderTemplateViews, listVendorGroups } from "../src/config/provider-templates.js";

it("resolves provider copy for zh and en", () => {
  const zh = listProviderTemplateViews("zh");
  const en = listProviderTemplateViews("en");
  const zhOllama = zh.find((item) => item.id === "ollama");
  const enOllama = en.find((item) => item.id === "ollama");
  expect(zhOllama?.vendorLabel).toBe("Ollama（本机）");
  expect(enOllama?.vendorLabel).toBe("Ollama (local)");
  expect(zhOllama?.hint).toContain("ollama list");
  expect(enOllama?.hint).toContain("ollama list");

  const zhZhipu = listVendorGroups("zh").find((item) => item.id === "zhipu");
  const enZhipu = listVendorGroups("en").find((item) => item.id === "zhipu");
  expect(zhZhipu?.label).toBe("智谱");
  expect(enZhipu?.label).toBe("Zhipu");
});
