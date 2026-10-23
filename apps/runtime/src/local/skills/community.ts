/**
 * 社区 Skill 检索与下载（SkillHub / ClawHub）。
 * 只负责发现与拉 zip；安装仍走 installSkillPackageTo。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

export type CommunitySkillSource = "skillhub" | "clawhub";
/** 下载量 / 最近更新 */
export type CommunitySkillSort = "downloads" | "updated";

export interface CommunitySkillHit {
  source: CommunitySkillSource;
  /** UI / 安装坐标用的稳定 id */
  id: string;
  slug: string;
  name: string;
  description: string;
  /** ClawHub 必填；SkillHub 可选作者展示 */
  owner?: string;
  version?: string;
  downloads?: number;
  /** 更新时间（毫秒时间戳），供本地排序 */
  updatedAt?: number;
  homepage?: string;
}

export class CommunitySkillError extends Error {
  constructor(message: string) {
    super(message);
  }
}

const SKILLHUB_BASE = "https://api.skillhub.cn";
const CLAWHUB_BASE = "https://clawhub.ai";
const USER_AGENT = "AgentUp/1.0 (+https://agentup.app; community-skills)";
const SEARCH_LIMIT = 20;
const DOWNLOAD_MAX_BYTES = 5_000_000;
const FETCH_TIMEOUT_MS = 60_000;

export function isCommunitySkillSource(value: string): value is CommunitySkillSource {
  return value === "skillhub" || value === "clawhub";
}

export function isCommunitySkillSort(value: string): value is CommunitySkillSort {
  return value === "downloads" || value === "updated";
}

export async function searchCommunitySkills(
  source: CommunitySkillSource,
  query: string,
  options: { limit?: number; sort?: CommunitySkillSort } = {},
): Promise<CommunitySkillHit[]> {
  const capped = Math.min(Math.max(1, Math.floor(options.limit ?? SEARCH_LIMIT)), 50);
  const sort: CommunitySkillSort = options.sort ?? "downloads";
  const q = query.trim();
  if (source === "skillhub") return searchSkillHub(q, capped, sort);
  return searchClawHub(q, capped, sort);
}

export async function downloadCommunitySkill(input: {
  source: CommunitySkillSource;
  slug: string;
  owner?: string;
  version?: string;
}): Promise<string> {
  const slug = input.slug.trim();
  if (!slug) throw new CommunitySkillError("缺少 skill slug");
  if (input.source === "clawhub") {
    const owner = input.owner?.trim();
    if (!owner) throw new CommunitySkillError("ClawHub 安装需要作者 handle");
    return downloadZip(
      `${CLAWHUB_BASE}/api/v1/download?slug=${encodeURIComponent(slug)}&owner=${encodeURIComponent(owner)}`,
    );
  }
  const params = new URLSearchParams({ slug });
  if (input.version?.trim()) params.set("version", input.version.trim());
  return downloadZip(`${SKILLHUB_BASE}/api/v1/download?${params.toString()}`);
}

async function searchSkillHub(
  query: string,
  limit: number,
  sort: CommunitySkillSort,
): Promise<CommunitySkillHit[]> {
  const params = new URLSearchParams({
    sortBy: sort === "updated" ? "updated_at" : "downloads",
    order: "desc",
    page: "1",
    pageSize: String(limit),
  });
  if (query) params.set("keyword", query);
  const payload = await getJson(`${SKILLHUB_BASE}/api/skills?${params.toString()}`);
  const skills = asRecord(payload)?.data;
  const list = asRecord(skills)?.skills;
  if (!Array.isArray(list)) throw new CommunitySkillError("SkillHub 搜索结果无效");
  const hits: CommunitySkillHit[] = [];
  for (const item of list) {
    const row = asRecord(item);
    if (!row) continue;
    const slug = stringField(row, "slug");
    if (!slug) continue;
    const name = stringField(row, "name") || slug;
    const description =
      stringField(row, "description_zh") || stringField(row, "description") || "";
    const owner = stringField(row, "ownerName");
    const updatedAt = numberField(row, "updated_at");
    hits.push({
      source: "skillhub",
      id: `skillhub:${slug}`,
      slug,
      name,
      description,
      ...(owner ? { owner } : {}),
      ...(stringField(row, "version") ? { version: stringField(row, "version") } : {}),
      ...(typeof row.downloads === "number" ? { downloads: row.downloads } : {}),
      ...(updatedAt !== undefined ? { updatedAt } : {}),
      ...(stringField(row, "homepage") ? { homepage: stringField(row, "homepage") } : {}),
    });
  }
  return hits;
}

async function searchClawHub(
  query: string,
  limit: number,
  sort: CommunitySkillSort,
): Promise<CommunitySkillHit[]> {
  if (query) {
    // 搜索接口按相关度召回；拿到结果后再按所选维度本地排序。
    const params = new URLSearchParams({
      q: query,
      limit: String(Math.min(limit * 2, 50)),
      nonSuspiciousOnly: "true",
    });
    const payload = await getJson(`${CLAWHUB_BASE}/api/v1/search?${params.toString()}`);
    const results = asRecord(payload)?.results;
    if (!Array.isArray(results)) throw new CommunitySkillError("ClawHub 搜索结果无效");
    const hits = results.flatMap((item) => clawHubHitFromSearch(item) ?? []);
    return sortHits(hits, sort).slice(0, limit);
  }
  const params = new URLSearchParams({
    sort: sort === "updated" ? "updated" : "downloads",
    limit: String(limit),
    nonSuspiciousOnly: "true",
  });
  const payload = await getJson(`${CLAWHUB_BASE}/api/v1/skills?${params.toString()}`);
  const items = asRecord(payload)?.items;
  if (!Array.isArray(items)) throw new CommunitySkillError("ClawHub 列表无效");
  return items.flatMap((item) => clawHubHitFromList(item) ?? []);
}

function sortHits(hits: CommunitySkillHit[], sort: CommunitySkillSort): CommunitySkillHit[] {
  return [...hits].sort((a, b) => {
    if (sort === "updated") {
      return (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
    }
    return (b.downloads ?? 0) - (a.downloads ?? 0);
  });
}

function clawHubHitFromSearch(item: unknown): CommunitySkillHit | null {
  const row = asRecord(item);
  if (!row) return null;
  const slug = stringField(row, "slug");
  const owner = stringField(row, "ownerHandle") || ownerFromNested(row);
  if (!slug || !owner) return null;
  const name = stringField(row, "displayName") || slug;
  const description = stringField(row, "summary") || "";
  const downloads =
    typeof row.downloads === "number"
      ? row.downloads
      : typeof asRecord(row.metrics)?.rolling60DayInstalls === "number"
        ? (asRecord(row.metrics)!.rolling60DayInstalls as number)
        : undefined;
  const updatedAt = numberField(row, "updatedAt") ?? numberField(asRecord(row.metrics) ?? {}, "updatedAt");
  return {
    source: "clawhub",
    id: `clawhub:${owner}/${slug}`,
    slug,
    name,
    description,
    owner,
    ...(stringField(row, "version") ? { version: stringField(row, "version") } : {}),
    ...(downloads !== undefined ? { downloads } : {}),
    ...(updatedAt !== undefined ? { updatedAt } : {}),
    ...(stringField(row, "canonicalUrl")
      ? { homepage: `https://clawhub.ai${stringField(row, "canonicalUrl")}` }
      : {}),
  };
}

function clawHubHitFromList(item: unknown): CommunitySkillHit | null {
  const row = asRecord(item);
  if (!row) return null;
  const slug = stringField(row, "slug");
  const owner = stringField(row, "ownerHandle");
  if (!slug || !owner) return null;
  const stats = asRecord(row.stats);
  const latest = asRecord(row.latestVersion);
  const updatedAt = numberField(row, "updatedAt");
  return {
    source: "clawhub",
    id: `clawhub:${owner}/${slug}`,
    slug,
    name: stringField(row, "displayName") || slug,
    description: stringField(row, "summary") || stringField(row, "description") || "",
    owner,
    ...(stringField(latest ?? {}, "version")
      ? { version: stringField(latest!, "version") }
      : {}),
    ...(typeof stats?.downloads === "number" ? { downloads: stats.downloads } : {}),
    ...(updatedAt !== undefined ? { updatedAt } : {}),
    homepage: `https://clawhub.ai/${owner}/skills/${slug}`,
  };
}

function ownerFromNested(row: Record<string, unknown>): string | undefined {
  const owner = asRecord(row.owner);
  return owner ? stringField(owner, "handle") : undefined;
}

async function downloadZip(url: string): Promise<string> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      headers: { "User-Agent": USER_AGENT, Accept: "application/zip,*/*" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch {
    throw new CommunitySkillError("下载 Skill 失败（网络错误）");
  }
  if (!response.ok) {
    throw new CommunitySkillError(`下载 Skill 失败（HTTP ${response.status}）`);
  }
  const lengthHeader = response.headers.get("content-length");
  if (lengthHeader && Number(lengthHeader) > DOWNLOAD_MAX_BYTES) {
    throw new CommunitySkillError("Skill 包过大");
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength > DOWNLOAD_MAX_BYTES) {
    throw new CommunitySkillError("Skill 包过大");
  }
  if (buffer.byteLength < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
    throw new CommunitySkillError("下载内容不是合法 ZIP");
  }
  const filePath = path.join(os.tmpdir(), `agentup-community-${randomUUID()}.zip`);
  fs.writeFileSync(filePath, buffer);
  return filePath;
}

async function getJson(url: string): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch {
    throw new CommunitySkillError("搜索失败（网络错误）");
  }
  if (!response.ok) {
    throw new CommunitySkillError(`搜索失败（HTTP ${response.status}）`);
  }
  try {
    return (await response.json()) as unknown;
  } catch {
    throw new CommunitySkillError("搜索结果解析失败");
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringField(row: Record<string, unknown>, key: string): string | undefined {
  const value = row[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberField(row: Record<string, unknown>, key: string): number | undefined {
  const value = row[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
