import { expect, it } from "vitest";

import {
  isModelServiceUnavailable,
  isUserCancelError,
  modelUnavailableNotice,
} from "../src/session/model/unavailable.js";

it("detects connection / ollama failures as model unavailable", () => {
  expect(isModelServiceUnavailable("Connection error.")).toBe(true);
  expect(isModelServiceUnavailable("fetch failed")).toBe(true);
  expect(isModelServiceUnavailable("ECONNREFUSED")).toBe(true);
  expect(isModelServiceUnavailable("This operation was aborted")).toBe(false);
  expect(isModelServiceUnavailable("用户已取消")).toBe(false);
  expect(isUserCancelError("Request was aborted")).toBe(true);
});

it("returns localized notice copy", () => {
  expect(modelUnavailableNotice("zh")).toContain("切换模型");
  expect(modelUnavailableNotice("en")).toMatch(/switch/i);
});
