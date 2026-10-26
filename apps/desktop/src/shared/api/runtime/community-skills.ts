import type {
  CommunitySkillHit,
  CommunitySkillSort,
  CommunitySkillSource,
} from "../../model/runtime/runtime";

import { DesktopApiError } from "./error";
import type { RuntimeHttp } from "./http";

export async function searchCommunitySkills(
  http: RuntimeHttp,
  token: string,
  source: CommunitySkillSource,
  query: string,
  options: { limit?: number; sort?: CommunitySkillSort } = {},
): Promise<CommunitySkillHit[]> {
  const params = new URLSearchParams({
    source,
    q: query,
    limit: String(options.limit ?? 20),
    sort: options.sort ?? "downloads",
  });
  const payload = await http.request(`/community-skills/search?${params.toString()}`, token);
  if (!Array.isArray(payload.skills)) throw new DesktopApiError("社区技能列表无效");
  return payload.skills.map(readCommunitySkillHit);
}

export async function fetchCommunitySkill(
  http: RuntimeHttp,
  token: string,
  input: {
    source: CommunitySkillSource;
    slug: string;
    owner?: string;
    version?: string;
  },
): Promise<string> {
  const payload = await http.request("/community-skills/fetch", token, {
    source: input.source,
    slug: input.slug,
    ...(input.owner ? { owner: input.owner } : {}),
    ...(input.version ? { version: input.version } : {}),
  });
  if (typeof payload.path !== "string" || !payload.path.trim()) {
    throw new DesktopApiError("社区技能下载路径无效");
  }
  return payload.path;
}

function readCommunitySkillHit(value: unknown): CommunitySkillHit {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new DesktopApiError("社区技能条目无效");
  }
  const row = value as Record<string, unknown>;
  const source = row.source;
  if (source !== "skillhub" && source !== "clawhub") {
    throw new DesktopApiError("社区技能源无效");
  }
  if (typeof row.id !== "string" || typeof row.slug !== "string" || typeof row.name !== "string") {
    throw new DesktopApiError("社区技能条目无效");
  }
  return {
    source,
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: typeof row.description === "string" ? row.description : "",
    ...(typeof row.owner === "string" ? { owner: row.owner } : {}),
    ...(typeof row.version === "string" ? { version: row.version } : {}),
    ...(typeof row.downloads === "number" ? { downloads: row.downloads } : {}),
    ...(typeof row.updatedAt === "number" ? { updatedAt: row.updatedAt } : {}),
    ...(typeof row.homepage === "string" ? { homepage: row.homepage } : {}),
  };
}
