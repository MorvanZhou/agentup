import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { openPromise as openZipPromise } from "yauzl";

import { validateAgentPackage, type PackageIssue } from "../package/validate.js";
import { ensurePersonalAssistant } from "./personal-assistant.js";

const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SKILL_MAX_BYTES = 200_000;
const SKILL_PACKAGE_MAX_BYTES = 5_000_000;
const MCP_MAX_BYTES = 200_000;
const AGENTS_MD_MAX_BYTES = 200_000;

export class UserResourceError extends Error {
  constructor(
    message: string,
    readonly details: PackageIssue[] = [],
  ) {
    super(message);
  }
}

export interface UserSkill {
  name: string;
  description: string;
  enabled: boolean;
}

/** 私人助理 skills / mcp / AGENTS.md 根目录；与第三方 Agent、~/.agents、~/.pi/agent 无关。 */
export function userResourceRoot(userDataRoot: string, userId: string): string {
  validateUserId(userId);
  return ensurePersonalAssistant(userDataRoot, userId);
}

export function userSkillsDir(userDataRoot: string, userId: string): string {
  return path.join(userResourceRoot(userDataRoot, userId), "skills");
}

/** 私人助理 AGENTS.md：Pi agentDir（`.runtime/`），在 cwd 外，只经 UI 改。 */
export function userAgentsMdPath(userDataRoot: string, userId: string): string {
  return path.join(userResourceRoot(userDataRoot, userId), ".runtime", "AGENTS.md");
}

export function userMcpPath(userDataRoot: string, userId: string): string {
  return path.join(userResourceRoot(userDataRoot, userId), "mcp.json");
}

function skillsStatePath(userRoot: string): string {
  return path.join(userRoot, "skills-state.json");
}

export function listUserSkills(userDataRoot: string, userId: string): UserSkill[] {
  const root = userSkillsDir(userDataRoot, userId);
  const state = readSkillsState(userResourceRoot(userDataRoot, userId));
  if (!fs.existsSync(root)) return [];
  const skills: UserSkill[] = [];
  for (const name of fs.readdirSync(root).sort()) {
    if (!SKILL_NAME.test(name)) continue;
    const file = path.join(root, name, "SKILL.md");
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) continue;
    const content = fs.readFileSync(file, "utf8");
    skills.push({
      name,
      description: skillDescription(content),
      enabled: state.enabled[name] !== false,
    });
  }
  return skills;
}

/** 私人助理会话只注入已激活的专属 skill 目录。 */
export function listEnabledUserSkillPaths(userRoot: string): string[] {
  const root = path.join(userRoot, "skills");
  if (!fs.existsSync(root)) return [];
  const state = readSkillsState(userRoot);
  return fs
    .readdirSync(root)
    .filter((name) => SKILL_NAME.test(name))
    .filter((name) => fs.existsSync(path.join(root, name, "SKILL.md")))
    .filter((name) => state.enabled[name] !== false)
    .map((name) => path.join(root, name));
}

export function setUserSkillEnabled(
  userDataRoot: string,
  userId: string,
  name: string,
  enabled: boolean,
): UserSkill {
  if (!SKILL_NAME.test(name) || name.length > 64) throw new UserResourceError("技能名称无效");
  const dir = path.join(userSkillsDir(userDataRoot, userId), name);
  const file = path.join(dir, "SKILL.md");
  if (!fs.existsSync(file)) throw new UserResourceError("技能不存在");
  const userRoot = userResourceRoot(userDataRoot, userId);
  const state = readSkillsState(userRoot);
  state.enabled[name] = enabled;
  writeSkillsState(userRoot, state);
  return {
    name,
    description: skillDescription(fs.readFileSync(file, "utf8")),
    enabled,
  };
}

/**
 * 从本机文件夹或 zip 安装 skill 包。
 * `expectName` 用于「更新」：包内 name 必须与目标技能一致。
 */
export async function installUserSkillPackage(
  userDataRoot: string,
  userId: string,
  packagePath: string,
  options: { expectName?: string } = {},
): Promise<UserSkill> {
  validateUserId(userId);
  if (!packagePath || typeof packagePath !== "string") throw new UserResourceError("路径无效");
  const resolved = path.resolve(packagePath);
  if (!fs.existsSync(resolved)) throw new UserResourceError("Skill 包不存在");

  const staging = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-skill-"));
  try {
    const stats = fs.statSync(resolved);
    if (stats.isDirectory()) {
      copyTree(resolved, staging, SKILL_PACKAGE_MAX_BYTES);
    } else if (stats.isFile() && resolved.toLowerCase().endsWith(".zip")) {
      if (stats.size > SKILL_PACKAGE_MAX_BYTES) throw new UserResourceError("Skill 包过大");
      await extractZip(resolved, staging);
    } else {
      throw new UserResourceError("请选择 Skill 文件夹或 .zip 包");
    }

    const skillRoot = resolveSkillRoot(staging);
    const content = fs.readFileSync(path.join(skillRoot, "SKILL.md"), "utf8");
    const name = skillFrontmatterName(content);
    if (!name || !SKILL_NAME.test(name) || name.length > 64) {
      throw new UserResourceError("技能名称无效");
    }
    if (options.expectName && options.expectName !== name) {
      throw new UserResourceError(`更新失败：包内 name 为 ${name}，与 ${options.expectName} 不一致`);
    }

    const files = collectSkillFiles(skillRoot, name);
    const issues = validateAgentPackage({
      "SYSTEM.md": Buffer.from("ok\n"),
      ...files,
    }).filter((issue) => issue.path.startsWith("skills/"));
    if (issues.length) throw new UserResourceError("技能校验失败", issues);

    const target = path.join(userSkillsDir(userDataRoot, userId), name);
    const parent = userSkillsDir(userDataRoot, userId);
    fs.mkdirSync(parent, { recursive: true });
    const temporary = path.join(parent, `.install-${randomUUID()}`);
    fs.mkdirSync(temporary, { recursive: true });
    copyTree(skillRoot, temporary, SKILL_PACKAGE_MAX_BYTES);
    if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
    fs.renameSync(temporary, target);

    const userRoot = userResourceRoot(userDataRoot, userId);
    const state = readSkillsState(userRoot);
    if (state.enabled[name] === undefined) state.enabled[name] = true;
    writeSkillsState(userRoot, state);

    return {
      name,
      description: skillDescription(content),
      enabled: state.enabled[name] !== false,
    };
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

export function deleteUserSkill(userDataRoot: string, userId: string, name: string): void {
  if (!SKILL_NAME.test(name) || name.length > 64) {
    throw new UserResourceError("技能名称无效");
  }
  const dir = path.join(userSkillsDir(userDataRoot, userId), name);
  const root = userSkillsDir(userDataRoot, userId);
  const resolved = path.resolve(dir);
  if (!resolved.startsWith(`${path.resolve(root)}${path.sep}`)) {
    throw new UserResourceError("请求无效");
  }
  if (!fs.existsSync(resolved)) throw new UserResourceError("技能不存在");
  fs.rmSync(resolved, { recursive: true, force: true });
  const userRoot = userResourceRoot(userDataRoot, userId);
  const state = readSkillsState(userRoot);
  delete state.enabled[name];
  writeSkillsState(userRoot, state);
}

/** 读取私人助理 `.runtime/AGENTS.md`。 */
export function readUserAgentsMd(userDataRoot: string, userId: string): string {
  const file = userAgentsMdPath(userDataRoot, userId);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return "";
  return fs.readFileSync(file, "utf8");
}

/**
 * 写入私人助理 `.runtime/AGENTS.md`（Pi agentDir context file）。
 * 空内容表示清除。文件在 cwd 外，模型文件工具默认改不到。
 */
export function writeUserAgentsMd(userDataRoot: string, userId: string, content: string): string {
  if (typeof content !== "string") throw new UserResourceError("AGENTS.md 内容无效");
  if (Buffer.byteLength(content, "utf8") > AGENTS_MD_MAX_BYTES) {
    throw new UserResourceError("AGENTS.md 过大");
  }
  const file = userAgentsMdPath(userDataRoot, userId);
  const trimmed = content.trim();
  if (!trimmed) {
    if (fs.existsSync(file)) fs.rmSync(file, { force: true });
    return "";
  }
  const text = content.endsWith("\n") ? content : `${content}\n`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  fs.writeFileSync(temporary, text, { mode: 0o600 });
  fs.renameSync(temporary, file);
  return text;
}

export function readUserMcpServers(userDataRoot: string, userId: string): Record<string, unknown> {
  const file = userMcpPath(userDataRoot, userId);
  if (!fs.existsSync(file)) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    throw new UserResourceError("mcp.json 不是合法 JSON");
  }
  const servers =
    parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as { mcpServers?: unknown }).mcpServers
      : undefined;
  if (!servers || typeof servers !== "object" || Array.isArray(servers)) {
    throw new UserResourceError("mcp.json 缺少 mcpServers");
  }
  return servers as Record<string, unknown>;
}

export function writeUserMcpServers(
  userDataRoot: string,
  userId: string,
  mcpServers: Record<string, unknown>,
): Record<string, unknown> {
  if (!mcpServers || typeof mcpServers !== "object" || Array.isArray(mcpServers)) {
    throw new UserResourceError("mcpServers 必须是对象");
  }
  const payload = `${JSON.stringify({ mcpServers }, null, 2)}\n`;
  if (Buffer.byteLength(payload, "utf8") > MCP_MAX_BYTES) {
    throw new UserResourceError("mcp.json 过大");
  }
  const issues = validateAgentPackage({
    "SYSTEM.md": Buffer.from("ok\n"),
    "mcp.json": Buffer.from(payload, "utf8"),
  }).filter((issue) => issue.path === "mcp.json");
  if (issues.length) throw new UserResourceError("MCP 校验失败", issues);

  const file = userMcpPath(userDataRoot, userId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  fs.writeFileSync(temporary, payload, { mode: 0o600 });
  fs.renameSync(temporary, file);
  return mcpServers;
}

function resolveSkillRoot(staging: string): string {
  if (fs.existsSync(path.join(staging, "SKILL.md"))) return staging;
  const children = fs.readdirSync(staging).filter((name) => !name.startsWith("."));
  const dirs = children.filter((name) => fs.statSync(path.join(staging, name)).isDirectory());
  if (dirs.length === 1 && fs.existsSync(path.join(staging, dirs[0], "SKILL.md"))) {
    return path.join(staging, dirs[0]);
  }
  throw new UserResourceError("Skill 包须在根目录或唯一子目录中包含 SKILL.md");
}

function collectSkillFiles(skillRoot: string, name: string): Record<string, Uint8Array> {
  const files: Record<string, Uint8Array> = {};
  let total = 0;
  const walk = (dir: string, relative: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const nextRel = relative ? `${relative}/${entry.name}` : entry.name;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full, nextRel);
        continue;
      }
      if (!entry.isFile()) continue;
      const bytes = fs.readFileSync(full);
      total += bytes.byteLength;
      if (total > SKILL_PACKAGE_MAX_BYTES) throw new UserResourceError("Skill 包过大");
      if (nextRel === "SKILL.md" && bytes.byteLength > SKILL_MAX_BYTES) {
        throw new UserResourceError("SKILL.md 过大");
      }
      files[`skills/${name}/${nextRel}`] = bytes;
    }
  };
  walk(skillRoot, "");
  if (!files[`skills/${name}/SKILL.md`]) throw new UserResourceError("缺少 SKILL.md");
  return files;
}

function copyTree(source: string, target: string, maxBytes: number): void {
  let total = 0;
  const walk = (from: string, to: string): void => {
    fs.mkdirSync(to, { recursive: true });
    for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const src = path.join(from, entry.name);
      const dest = path.join(to, entry.name);
      if (entry.isDirectory()) {
        walk(src, dest);
        continue;
      }
      if (!entry.isFile()) continue;
      const bytes = fs.readFileSync(src);
      total += bytes.byteLength;
      if (total > maxBytes) throw new UserResourceError("Skill 包过大");
      fs.writeFileSync(dest, bytes);
    }
  };
  walk(source, target);
}

async function extractZip(zipPath: string, target: string): Promise<void> {
  const zipfile = await openZipPromise(zipPath);
  let total = 0;
  for await (const entry of zipfile.eachEntry()) {
    const name = entry.fileName.replace(/\\/g, "/");
    if (!name || name.endsWith("/")) continue;
    if (name.includes("..") || path.isAbsolute(name)) {
      throw new UserResourceError("Skill 包包含非法路径");
    }
    const dest = path.join(target, name);
    if (!dest.startsWith(`${path.resolve(target)}${path.sep}`)) {
      throw new UserResourceError("Skill 包包含非法路径");
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const readStream = await zipfile.openReadStreamPromise(entry);
    const chunks: Buffer[] = [];
    for await (const chunk of readStream) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buffer.length;
      if (total > SKILL_PACKAGE_MAX_BYTES) throw new UserResourceError("Skill 包过大");
      chunks.push(buffer);
    }
    fs.writeFileSync(dest, Buffer.concat(chunks));
  }
}

function readSkillsState(userRoot: string): { enabled: Record<string, boolean> } {
  return readEnabledState(skillsStatePath(userRoot));
}

function writeSkillsState(userRoot: string, state: { enabled: Record<string, boolean> }): void {
  writeEnabledState(skillsStatePath(userRoot), state);
}

function readEnabledState(file: string): { enabled: Record<string, boolean> } {
  if (!fs.existsSync(file)) return { enabled: {} };
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { enabled: {} };
    const enabled = (parsed as { enabled?: unknown }).enabled;
    if (!enabled || typeof enabled !== "object" || Array.isArray(enabled)) return { enabled: {} };
    const result: Record<string, boolean> = {};
    for (const [name, value] of Object.entries(enabled as Record<string, unknown>)) {
      if (typeof value === "boolean") result[name] = value;
    }
    return { enabled: result };
  } catch {
    return { enabled: {} };
  }
}

function writeEnabledState(file: string, state: { enabled: Record<string, boolean> }): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, file);
}

function skillDescription(content: string): string {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return "";
  const line = match[1].split(/\r?\n/).find((entry) => entry.startsWith("description:"));
  if (!line) return "";
  return line.slice("description:".length).trim().replace(/^["']|["']$/g, "");
}

function skillFrontmatterName(content: string): string | undefined {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return undefined;
  const line = match[1].split(/\r?\n/).find((entry) => entry.startsWith("name:"));
  if (!line) return undefined;
  return line.slice("name:".length).trim().replace(/^["']|["']$/g, "");
}

function validateUserId(userId: string): void {
  if (!userId || userId === "." || userId === ".." || /[/\\\u0000]/.test(userId)) {
    throw new UserResourceError("请求无效");
  }
}
