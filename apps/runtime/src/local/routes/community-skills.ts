import type { Hono } from "hono";

import {
  bearer,
  json,
  LocalError,
  optionalText,
  readJson,
  text,
  type LocalAppDeps,
  type LocalAppEnv,
} from "../http.js";
import { inspectSkillPackage, UserResourceError } from "../assistant/user-resources.js";
import {
  CommunitySkillError,
  downloadCommunitySkill,
  isCommunitySkillSort,
  isCommunitySkillSource,
  searchCommunitySkills,
} from "../skills/community.js";

export function registerCommunitySkillsRoutes(app: Hono<LocalAppEnv>, _deps: LocalAppDeps): void {
  app.get("/community-skills/search", async (c) => {
    bearer(c);
    const sourceRaw = c.req.query("source") ?? "skillhub";
    if (!isCommunitySkillSource(sourceRaw)) throw new LocalError("不支持的技能源", 400);
    const sortRaw = c.req.query("sort") ?? "downloads";
    if (!isCommunitySkillSort(sortRaw)) throw new LocalError("不支持的排序方式", 400);
    const q = c.req.query("q") ?? "";
    const limitRaw = c.req.query("limit");
    const limit = limitRaw ? Number(limitRaw) : undefined;
    try {
      const skills = await searchCommunitySkills(sourceRaw, q, {
        sort: sortRaw,
        ...(Number.isFinite(limit) ? { limit } : {}),
      });
      return json(c, 200, { source: sourceRaw, sort: sortRaw, skills });
    } catch (error) {
      throw mapCommunityError(error);
    }
  });

  app.post("/community-skills/fetch", async (c) => {
    bearer(c);
    const body = await readJson(c);
    const sourceRaw = text(body, "source");
    if (!isCommunitySkillSource(sourceRaw)) throw new LocalError("不支持的技能源", 400);
    try {
      const path = await downloadCommunitySkill({
        source: sourceRaw,
        slug: text(body, "slug"),
        owner: optionalText(body, "owner"),
        version: optionalText(body, "version"),
      });
      // 立刻读 SKILL.md name，前端待装列表展示真名而不是临时 zip。
      const inspected = await inspectSkillPackage(path);
      return json(c, 200, { path, name: inspected.name });
    } catch (error) {
      throw mapCommunityError(error);
    }
  });
}

function mapCommunityError(error: unknown): LocalError {
  if (error instanceof CommunitySkillError) return new LocalError(error.message, 400);
  // inspect 失败（名称无效 / 包过大等）保留原文，勿吞成笼统 502。
  if (error instanceof UserResourceError) return new LocalError(error.message, 400);
  if (error instanceof LocalError) return error;
  return new LocalError("社区技能请求失败", 502);
}
