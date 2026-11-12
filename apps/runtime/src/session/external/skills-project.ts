import fs from "node:fs";
import path from "node:path";

import {
  agentSdkSkillsProjectRel,
  listAgentSdkSkillsProjectRels,
} from "../../config/provider-templates.js";
import { listEnabledUserSkillPaths } from "../../local/assistant/user-resources.js";
import type { Visit } from "../../package/sync.js";
import { isSafeSkillName } from "../../package/validate.js";

/**
 * 方案 D：把 AgentUp 技能投影到厂商项目目录（如 `.codebuddy/skills`），
 * 供本地 Agent App 用自带 Skill / 读文件工具发现；**不再**经 MCP `skill_*`。
 *
 * 切 provider（换 templateId）时按各模板的 `agentSdk.skillsProjectRel` 拆旧链、建新链。
 * 只管理我们写下的符号链接；用户自建的同名实体文件不覆盖、不删除。
 */

const MARKER_VERSION = 1;

type SkillsProjectMarker = {
  version: number;
  templateId: string;
  rel: string;
  names: string[];
};

export type ProjectableSkill = { name: string; dir: string };

export type SyncSkillsProjectInput = {
  cwd: string;
  /** 当前会话模型的 templateId；非 agent-sdk 或不支持投影时清掉旧链。 */
  templateId: string;
  visit: Visit;
  userDataRoot?: string;
};

export type SyncSkillsProjectResult = {
  /** 当前生效的厂商相对路径；无投影时为 undefined。 */
  rel?: string;
  names: string[];
};

/** 校验并规范化厂商 skills 相对路径（禁绝对 / `..`）。 */
export function normalizeSkillsProjectRel(rel: string): string | undefined {
  const raw = rel.trim().replace(/\\/g, "/");
  if (!raw) return undefined;
  // 先拒绝对路径（含 POSIX `/…` 与 Windows `C:/…`），再剥尾部斜杠
  if (path.isAbsolute(raw) || raw.startsWith("/")) return undefined;
  const trimmed = raw.replace(/\/+$/, "");
  if (!trimmed) return undefined;
  const parts = trimmed.split("/");
  if (parts.some((part) => part === ".." || part === "")) return undefined;
  return parts.join("/");
}

export function listProjectableSkills(visit: Visit, cwd: string): ProjectableSkill[] {
  const byName = new Map<string, string>();
  const packageRoot = path.join(cwd, ".pi", "skills");
  for (const skill of scanSkillsParent(packageRoot)) {
    byName.set(skill.name, skill.dir);
  }
  // 私人助理：已启用的用户技能并入投影（同名不覆盖包内技能）
  if (visit.kind === "personal") {
    for (const dir of listEnabledUserSkillPaths(visit.root)) {
      const name = path.basename(dir);
      if (!isSafeSkillName(name) || byName.has(name)) continue;
      if (!fs.existsSync(path.join(dir, "SKILL.md"))) continue;
      byName.set(name, dir);
    }
  }
  return [...byName.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, dir]) => ({ name, dir }));
}

/**
 * 按当前 templateId 同步投影。
 * - agent-sdk 且模板声明了 `skillsProjectRel`：投影到该相对路径
 * - 否则：清掉本 cwd 上 AgentUp 管理过的厂商 skills 链
 */
export function syncSkillsProject(input: SyncSkillsProjectInput): SyncSkillsProjectResult {
  const cwd = path.resolve(input.cwd);
  fs.mkdirSync(cwd, { recursive: true });
  const nextRel = normalizeSkillsProjectRel(agentSdkSkillsProjectRel(input.templateId) ?? "");
  const skills = nextRel ? listProjectableSkills(input.visit, cwd) : [];
  const marker = readMarker(cwd);

  // 拆掉旧投影（含其它厂商路径上我们留下的链）
  const managedRels = new Set<string>([
    ...listAgentSdkSkillsProjectRels().map((rel) => normalizeSkillsProjectRel(rel)).filter(Boolean) as string[],
    ...(marker?.rel ? [marker.rel] : []),
  ]);
  for (const rel of managedRels) {
    if (nextRel && rel === nextRel) continue;
    removeManagedProjection(cwd, rel, rel === marker?.rel ? marker.names : undefined);
  }

  if (!nextRel) {
    clearMarker(cwd);
    return { names: [] };
  }

  const names = projectSkills(cwd, nextRel, skills);
  writeMarker(cwd, {
    version: MARKER_VERSION,
    templateId: input.templateId,
    rel: nextRel,
    names,
  });
  return { rel: nextRel, names };
}

/** 非 SDK / 无投影模板：只清本 cwd 上 AgentUp 管理过的厂商 skills 链。 */
export function clearSkillsProject(cwd: string): void {
  const resolved = path.resolve(cwd);
  const marker = readMarker(resolved);
  const managedRels = new Set<string>([
    ...(listAgentSdkSkillsProjectRels()
      .map((rel) => normalizeSkillsProjectRel(rel))
      .filter(Boolean) as string[]),
    ...(marker?.rel ? [marker.rel] : []),
  ]);
  for (const rel of managedRels) {
    removeManagedProjection(resolved, rel, rel === marker?.rel ? marker.names : undefined);
  }
  clearMarker(resolved);
}

function scanSkillsParent(skillsRoot: string): ProjectableSkill[] {
  if (!fs.existsSync(skillsRoot) || !fs.statSync(skillsRoot).isDirectory()) return [];
  const out: ProjectableSkill[] = [];
  for (const name of fs.readdirSync(skillsRoot)) {
    if (!isSafeSkillName(name)) continue;
    const dir = path.join(skillsRoot, name);
    if (!fs.existsSync(path.join(dir, "SKILL.md"))) continue;
    if (!fs.statSync(dir).isDirectory()) continue;
    out.push({ name, dir: path.resolve(dir) });
  }
  return out;
}

function projectSkills(cwd: string, rel: string, skills: ProjectableSkill[]): string[] {
  const targetRoot = path.join(cwd, ...rel.split("/"));
  fs.mkdirSync(targetRoot, { recursive: true });
  const names: string[] = [];
  const wanted = new Set(skills.map((skill) => skill.name));

  // 先拆掉本目录里我们不再需要的旧链（同 marker 管理范围内）
  if (fs.existsSync(targetRoot) && fs.statSync(targetRoot).isDirectory()) {
    for (const name of fs.readdirSync(targetRoot)) {
      if (!isSafeSkillName(name) || wanted.has(name)) continue;
      const entry = path.join(targetRoot, name);
      try {
        if (fs.lstatSync(entry).isSymbolicLink()) fs.unlinkSync(entry);
      } catch {
        /* ignore */
      }
    }
  }

  for (const skill of skills) {
    const linkPath = path.join(targetRoot, skill.name);
    let existing: fs.Stats | null = null;
    try {
      existing = fs.lstatSync(linkPath);
    } catch {
      existing = null;
    }
    if (existing) {
      // Windows junction 在 lstat 里也表现为 symbolic link
      if (existing.isSymbolicLink()) fs.unlinkSync(linkPath);
      else continue; // 用户自建实体：不覆盖
    }
    linkSkillDir(skill.dir, linkPath);
    names.push(skill.name);
  }
  return names;
}

/**
 * 把权威技能目录挂到厂商投影路径。
 * Windows：用 junction（绝对路径、本机卷），无需管理员 / 开发者模式；
 * `symlink type=dir` 在未提权机上常 EPERM，会阻断 SDK 开聊。
 * POSIX：普通目录符号链接。
 */
export function linkSkillDir(targetDir: string, linkPath: string): void {
  const absoluteTarget = path.resolve(targetDir);
  if (process.platform === "win32") {
    fs.symlinkSync(absoluteTarget, linkPath, "junction");
    return;
  }
  fs.symlinkSync(absoluteTarget, linkPath, "dir");
}

function removeManagedProjection(cwd: string, rel: string, names?: string[]): void {
  const normalized = normalizeSkillsProjectRel(rel);
  if (!normalized) return;
  const targetRoot = path.join(cwd, ...normalized.split("/"));
  if (!fs.existsSync(targetRoot) && !isSymlink(targetRoot)) return;

  try {
    if (isSymlink(targetRoot)) {
      fs.unlinkSync(targetRoot);
      return;
    }
  } catch {
    return;
  }

  if (!fs.statSync(targetRoot).isDirectory()) return;
  const toRemove = names && names.length > 0 ? names : fs.readdirSync(targetRoot);
  for (const name of toRemove) {
    const entry = path.join(targetRoot, name);
    try {
      if (fs.lstatSync(entry).isSymbolicLink()) fs.unlinkSync(entry);
    } catch {
      /* ignore */
    }
  }
  try {
    if (fs.readdirSync(targetRoot).length === 0) fs.rmdirSync(targetRoot);
  } catch {
    /* 非空或父级仍有用户文件：留下 */
  }
}

function markerPath(cwd: string): string {
  return path.join(cwd, ".pi", "skills-project.json");
}

function readMarker(cwd: string): SkillsProjectMarker | null {
  const file = markerPath(cwd);
  if (!fs.existsSync(file)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<SkillsProjectMarker>;
    const rel = typeof raw.rel === "string" ? normalizeSkillsProjectRel(raw.rel) : undefined;
    const templateId = typeof raw.templateId === "string" ? raw.templateId : "";
    if (!rel || !templateId) return null;
    const names = Array.isArray(raw.names)
      ? raw.names.filter((name): name is string => typeof name === "string" && isSafeSkillName(name))
      : [];
    return { version: MARKER_VERSION, templateId, rel, names };
  } catch {
    return null;
  }
}

function writeMarker(cwd: string, marker: SkillsProjectMarker): void {
  const dir = path.dirname(markerPath(cwd));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(markerPath(cwd), `${JSON.stringify(marker, null, 2)}\n`);
}

function clearMarker(cwd: string): void {
  const file = markerPath(cwd);
  try {
    if (fs.existsSync(file)) fs.unlinkSync(file);
  } catch {
    /* ignore */
  }
}

function isSymlink(target: string): boolean {
  try {
    return fs.lstatSync(target).isSymbolicLink();
  } catch {
    return false;
  }
}
