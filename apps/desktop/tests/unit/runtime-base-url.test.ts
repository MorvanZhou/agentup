import { describe, expect, it } from "vitest";

import { runtimeBaseUrl } from "../../src/shared/api/runtime/base-url";

describe("runtimeBaseUrl", () => {
  it("开发态走 Vite 代理路径", () => {
    expect(runtimeBaseUrl(false)).toBe("/runtime");
  });

  it("生产构建直连本机 runtime", () => {
    expect(runtimeBaseUrl(true)).toBe("http://127.0.0.1:47391");
  });
});
