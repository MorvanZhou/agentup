import { describe, expect, it } from "vitest";

import { publicUrl } from "../../src/shared/model/public-url.js";

describe("publicUrl", () => {
  it("joins Vite BASE_URL and strips a leading slash on the asset name", () => {
    const base = import.meta.env.BASE_URL;
    expect(publicUrl("icon.png")).toBe(`${base}icon.png`);
    expect(publicUrl("/icon.png")).toBe(`${base}icon.png`);
  });
});
