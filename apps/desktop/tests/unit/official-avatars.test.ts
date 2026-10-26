import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { OFFICIAL_AVATARS, OFFICIAL_AVATAR_PAGE_SIZE } from "../../src/shared/model/avatar/official-avatars.js";

describe("official avatars", () => {
  it("offers 20 distinct presets with zh and en labels and image files", () => {
    expect(OFFICIAL_AVATARS).toHaveLength(20);
    const ids = OFFICIAL_AVATARS.map((item) => item.id);
    expect(new Set(ids).size).toBe(20);
    expect(OFFICIAL_AVATARS.length % OFFICIAL_AVATAR_PAGE_SIZE).toBe(0);
    expect(ids.slice(0, OFFICIAL_AVATAR_PAGE_SIZE)).toEqual([
      "greeter",
      "chef",
      "scholar",
      "night",
      "musician",
    ]);

    const zh = JSON.parse(
      readFileSync(fileURLToPath(new URL("../../src/shared/i18n/locales/zh.json", import.meta.url)), "utf8"),
    ) as Record<string, string>;
    const en = JSON.parse(
      readFileSync(fileURLToPath(new URL("../../src/shared/i18n/locales/en.json", import.meta.url)), "utf8"),
    ) as Record<string, string>;

    for (const item of OFFICIAL_AVATARS) {
      expect(item.url.length).toBeGreaterThan(0);
      expect(zh[item.labelKey]?.length).toBeGreaterThan(0);
      expect(en[item.labelKey]?.length).toBeGreaterThan(0);
      const file = fileURLToPath(
        new URL(`../../src/assets/official-avatars/${item.id}.png`, import.meta.url),
      );
      expect(existsSync(file)).toBe(true);
    }
  });
});
