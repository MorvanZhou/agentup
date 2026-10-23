import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CommunitySkillError,
  downloadCommunitySkill,
  searchCommunitySkills,
} from "../src/local/skills/community.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("community skills", () => {
  it("maps SkillHub search hits", async () => {
    globalThis.fetch = vi.fn(async (input) => {
      const url = String(input);
      expect(url).toContain("sortBy=downloads");
      return Response.json({
        code: 0,
        data: {
          skills: [
            {
              slug: "humanizer",
              name: "Humanizer",
              description_zh: "去除 AI 痕迹",
              ownerName: "demo",
              downloads: 12,
              version: "1.0.0",
              homepage: "https://skillhub.cn/skills/humanizer",
            },
          ],
        },
      });
    }) as typeof fetch;

    const hits = await searchCommunitySkills("skillhub", "humanizer");
    expect(hits).toEqual([
      {
        source: "skillhub",
        id: "skillhub:humanizer",
        slug: "humanizer",
        name: "Humanizer",
        description: "去除 AI 痕迹",
        owner: "demo",
        version: "1.0.0",
        downloads: 12,
        homepage: "https://skillhub.cn/skills/humanizer",
      },
    ]);
  });

  it("passes updated sort to SkillHub", async () => {
    globalThis.fetch = vi.fn(async (input) => {
      expect(String(input)).toContain("sortBy=updated_at");
      return Response.json({ code: 0, data: { skills: [] } });
    }) as typeof fetch;
    await searchCommunitySkills("skillhub", "", { sort: "updated" });
  });

  it("re-sorts ClawHub keyword results by downloads", async () => {
    globalThis.fetch = vi.fn(async () =>
      Response.json({
        results: [
          {
            slug: "a",
            displayName: "A",
            summary: "a",
            ownerHandle: "o",
            downloads: 1,
            updatedAt: 200,
          },
          {
            slug: "b",
            displayName: "B",
            summary: "b",
            ownerHandle: "o",
            downloads: 9,
            updatedAt: 100,
          },
        ],
      }),
    ) as typeof fetch;

    const byDownloads = await searchCommunitySkills("clawhub", "x", { sort: "downloads" });
    expect(byDownloads.map((hit) => hit.slug)).toEqual(["b", "a"]);
    const byUpdated = await searchCommunitySkills("clawhub", "x", { sort: "updated" });
    expect(byUpdated.map((hit) => hit.slug)).toEqual(["a", "b"]);
  });

  it("maps ClawHub search hits with owner", async () => {
    globalThis.fetch = vi.fn(async () =>
      Response.json({
        results: [
          {
            slug: "humanizer",
            displayName: "Humanizer",
            summary: "Remove AI writing traces",
            ownerHandle: "biostartechnology",
            version: "2.1.1",
            downloads: 100,
            canonicalUrl: "/biostartechnology/skills/humanizer",
          },
        ],
      }),
    ) as typeof fetch;

    const hits = await searchCommunitySkills("clawhub", "humanizer");
    expect(hits[0]).toMatchObject({
      source: "clawhub",
      id: "clawhub:biostartechnology/humanizer",
      slug: "humanizer",
      owner: "biostartechnology",
    });
  });

  it("requires owner when downloading from ClawHub", async () => {
    await expect(
      downloadCommunitySkill({ source: "clawhub", slug: "humanizer" }),
    ).rejects.toBeInstanceOf(CommunitySkillError);
  });

  it("rejects non-zip downloads", async () => {
    globalThis.fetch = vi.fn(async () => new Response("not-a-zip", { status: 200 })) as typeof fetch;
    await expect(
      downloadCommunitySkill({ source: "skillhub", slug: "humanizer" }),
    ).rejects.toThrow(/ZIP/);
  });
});
