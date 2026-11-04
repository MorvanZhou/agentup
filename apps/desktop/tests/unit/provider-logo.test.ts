/** @vitest-environment happy-dom */
import { expect, it } from "vitest";

import ProviderLogo from "../../src/shared/components/ProviderLogo.vue";
import { resolveProviderMarkId } from "../../src/shared/model/provider/provider-marks.js";
import { mountView } from "./mount-view.js";

it("把 vendorId 映射到模型品牌标：Google→Gemini、阿里→Qwen、腾讯→混元", () => {
  expect(resolveProviderMarkId("google")).toBe("gemini");
  expect(resolveProviderMarkId("alibaba")).toBe("qwen");
  expect(resolveProviderMarkId("tencent")).toBe("hunyuan");
  expect(resolveProviderMarkId("bytedance")).toBe("doubao");
  expect(resolveProviderMarkId("zhipu")).toBe("zai");
});

it("A 档新厂商有 Lobe 标形映射", () => {
  expect(resolveProviderMarkId("openrouter")).toBe("openrouter");
  expect(resolveProviderMarkId("xai")).toBe("xai");
  expect(resolveProviderMarkId("mistral")).toBe("mistral");
  expect(resolveProviderMarkId("groq")).toBe("groq");
  expect(resolveProviderMarkId("minimax")).toBe("minimax");
  expect(resolveProviderMarkId("fireworks")).toBe("fireworks");
  expect(resolveProviderMarkId("together")).toBe("together");
  expect(resolveProviderMarkId("nvidia")).toBe("nvidia");
  expect(resolveProviderMarkId("huggingface")).toBe("huggingface");
  const host = mountView(ProviderLogo, {
    props: { vendorId: "openrouter", label: "OpenRouter", size: "md" },
  });
  expect(host.querySelector("svg")).not.toBeNull();
});

it("本地 App 的 codebuddy 使用 WorkBuddy 标形", () => {
  expect(resolveProviderMarkId("codebuddy")).toBe("workbuddy");
  const host = mountView(ProviderLogo, {
    props: { vendorId: "codebuddy", label: "Workbuddy / CodeBuddy", size: "md" },
  });
  expect(host.querySelector("svg")).not.toBeNull();
});

it("本地 App 的 cursor 使用 Lobe Icons Cursor 标形", () => {
  expect(resolveProviderMarkId("cursor")).toBe("cursor");
  const host = mountView(ProviderLogo, {
    props: { vendorId: "cursor", label: "Cursor", size: "md" },
  });
  expect(host.querySelector("svg")).not.toBeNull();
});

it("本地 App 的 opencode 使用官方方标单色 SVG", () => {
  expect(resolveProviderMarkId("opencode")).toBe("opencode");
  const host = mountView(ProviderLogo, {
    props: { vendorId: "opencode", label: "OpenCode", size: "md" },
  });
  expect(host.querySelector("svg")).not.toBeNull();
});

it("已知厂商渲染单色 SVG 标，无色底磁贴", () => {
  const host = mountView(ProviderLogo, {
    props: { vendorId: "openai", label: "OpenAI", size: "md" },
  });
  const tile = host.querySelector(".provider-logo");
  expect(tile).not.toBeNull();
  expect(tile?.className).toContain("size-5");
  expect(tile?.querySelector("svg")).not.toBeNull();
  // 参考稿：裸标，不要品牌色底
  expect(tile?.getAttribute("data-mark")).toBeNull();
});

it("未知厂商回落字母占位", () => {
  const host = mountView(ProviderLogo, {
    props: { vendorId: "unknown-lab", label: "Unknown Lab", size: "lg" },
  });
  const tile = host.querySelector(".provider-logo");
  expect(tile?.className).toContain("size-6");
  expect(tile?.textContent?.trim()).toBe("U");
  expect(tile?.querySelector("svg")).toBeNull();
});
