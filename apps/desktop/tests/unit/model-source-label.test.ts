import { expect, it } from "vitest";

import { modelSourceLabel } from "../../src/shared/model/provider/model-source-label.js";

it("有模板 label 时直接用（DeepSeek Harness）", () => {
  expect(
    modelSourceLabel({
      label: "DeepSeek Harness",
      vendorLabel: "DeepSeek",
      optionLabel: "本地 Agent App",
    }),
  ).toBe("DeepSeek Harness");
});

it("无 label 时：厂商与方式不同则用中间点拼接", () => {
  expect(
    modelSourceLabel({ vendorLabel: "DeepSeek", optionLabel: "官方 API" }),
  ).toBe("DeepSeek · 官方 API");
});

it("无 label 时：仅一种方式只留厂商", () => {
  expect(modelSourceLabel({ vendorLabel: "OpenAI", optionLabel: "OpenAI" })).toBe("OpenAI");
});
