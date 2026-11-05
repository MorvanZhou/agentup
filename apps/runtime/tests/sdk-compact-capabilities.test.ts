import { describe, expect, it } from "vitest";

import { listExternalDriverIds, getExternalDriver } from "../src/session/external/sdk/registry.js";

describe("ExternalDriver compactSummarize capability", () => {
  it("全部已注册 driver 声明并实现 compactSummarize", () => {
    const ids = listExternalDriverIds();
    expect(ids.length).toBeGreaterThanOrEqual(7);
    for (const id of ids) {
      const driver = getExternalDriver(id);
      expect(driver.capabilities.compactSummarize, id).toBe(true);
      expect(typeof driver.compactSummarize, id).toBe("function");
    }
  });
});
