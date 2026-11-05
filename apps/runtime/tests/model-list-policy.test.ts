import { expect, it } from "vitest";

import { ConfigError } from "../src/config/load.js";
import {
  MODEL_CATALOG_UNAVAILABLE,
  requireNonEmptyModelCatalog,
  throwModelCatalogUnavailable,
} from "../src/config/provider/model-list-policy.js";

it("统一文案钉死：重新拉取或手动配置", () => {
  expect(MODEL_CATALOG_UNAVAILABLE).toBe(
    "暂时无法获取可用模型列表，请重新拉取，或手动配置",
  );
});

it("空目录抛 ConfigError，非空原样返回", () => {
  expect(() => requireNonEmptyModelCatalog([])).toThrow(ConfigError);
  expect(() => requireNonEmptyModelCatalog([])).toThrow(MODEL_CATALOG_UNAVAILABLE);
  expect(requireNonEmptyModelCatalog([{ id: "a" }])).toEqual([{ id: "a" }]);
});

it("throwModelCatalogUnavailable 与闸门同文案", () => {
  expect(() => throwModelCatalogUnavailable()).toThrow(MODEL_CATALOG_UNAVAILABLE);
});
