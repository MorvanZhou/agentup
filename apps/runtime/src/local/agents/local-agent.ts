import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { t, type UiLocale } from "../../i18n/index.js";
import { packageDigest } from "../../package/digest.js";
import type { Visit } from "../../package/sync.js";
import { validateAgentPackage } from "../../package/validate.js";
import { ensureCwdLayout } from "../../session/workspace/cwd-layout.js";
import {
  AgentIdentityError,
  BACKGROUND_MAX,
  composeSystemPrompt,
  normalizeAgentBackground,
  normalizeAgentName,
  normalizeAgentRole,
} from "./identity.js";
import { installSkillPackageTo, UserResourceError } from "../assistant/user-resources.js";
import { writeZipFromDirectory } from "./zip-dir.js";

const MAX_AVATAR_BYTES = 1_000_000;
const LOCAL_ID_PREFIX = "loc-";
const LOCAL_ID_SUFFIX = /^[A-Za-z0-9]{8,16}$/;
const LOCAL_MANIFEST = { version: 1, tools: [] as string[], modelCapabilities: ["tools"] };

export class LocalAgentError extends Error {}

/** 本机私有 Agent 名片；身份派生到 SYSTEM.md，工作规则存于 AGENTS.md。 */
export interface LocalAgentCard {
  agentId: string;
  name: string;
  role: string;
  background: string;
  rules: string;
  /** 已安装到 cwd/.pi/skills 的技能名 */
  skills: string[];
  /** cwd/.pi/mcp.json 的 mcpServers；无则空对象 */
  mcpServers: Record<string, unknown>;
  /** 曾发布到市场时绑定的远端 agent_id；再发布时带上以升版而非新建 */
  publishedAgentId?: string;
  packageDigest: string;
  avatarUrl?: string;
  createdAt: string;
  updatedAt: string;
}

interface StoredInstance {
  kind: "local";
  user_id: string;
  agent_id: string;
  name: string;
  role: string;
  background: string;
  package_version: number;
  package_digest: string;
  active_session_id: string;
  tools: string[];
  model_capabilities: string[];
  project_trust: "granted";
  created_at: string;
  updated_at: string;
  /** 市场侧 agent_id；与本机 loc-* 一对一绑定 */
  published_agent_id?: string;
  avatar_mime?: string;
  avatar_file?: string;
}

/** 与公开招募 Agent 同根：users/<uid>/agents/<loc-id>/。 */
export function localAgentRoot(userDataRoot: string, userId: string, agentId: string): string {
  requireLocalAgentId(agentId);
  validateSegment(userId);
  return path.resolve(userDataRoot, "users", userId, "agents", agentId);
}

export function localAgentsParent(userDataRoot: string, userId: string): string {
  validateSegment(userId);
  return path.resolve(userDataRoot, "users", userId, "agents");
}

export function isLocalAgentId(agentId: string): boolean {
  if (!agentId.startsWith(LOCAL_ID_PREFIX)) return false;
  return LOCAL_ID_SUFFIX.test(agentId.slice(LOCAL_ID_PREFIX.length));
}

export function requireLocalAgentId(agentId: string): string {
  if (!isLocalAgentId(agentId)) throw new LocalAgentError(t("la.err.invalidId", "zh"));
  validateSegment(agentId);
  return agentId;
}

export function ensureLocalAgent(userDataRoot: string, userId: string, agentId: string): string {
  const root = localAgentRoot(userDataRoot, userId, agentId);
  const instancePath = path.join(root, "instance.json");
  if (!fs.existsSync(instancePath)) {
    throw new LocalAgentError(t("la.err.notFound", "zh"));
  }
  const stored = readStoredInstance(root);
  if (stored.user_id !== userId || stored.agent_id !== agentId || stored.kind !== "local") {
    throw new LocalAgentError(t("la.err.notFound", "zh"));
  }
  fs.mkdirSync(path.join(root, ".runtime"), { recursive: true });
  fs.mkdirSync(path.join(root, "sessions"), { recursive: true });
  const cwd = path.join(root, "cwd");
  fs.mkdirSync(cwd, { recursive: true });
  ensureCwdLayout(cwd);
  ensurePiScaffold(cwd);
  return root;
}

export function listLocalAgents(userDataRoot: string, userId: string): LocalAgentCard[] {
  const parent = localAgentsParent(userDataRoot, userId);
  if (!fs.existsSync(parent) || !fs.statSync(parent).isDirectory()) return [];
  const cards: LocalAgentCard[] = [];
  for (const name of fs.readdirSync(parent).sort()) {
    if (!isLocalAgentId(name)) continue;
    const root = path.join(parent, name);
    if (!fs.existsSync(path.join(root, "instance.json"))) continue;
    try {
      cards.push(toPublicCard(readStoredInstance(root), root));
    } catch {
      // 跳过损坏条目
    }
  }
  return cards;
}

export async function createLocalAgent(
  userDataRoot: string,
  userId: string,
  input: {
    name: string;
    role: string;
    background: string;
    /** cwd/.pi/AGENTS.md 正文；空串表示不创建。 */
    rules?: string;
    avatarDataUrl?: string;
    /** 本机 Skill 文件夹或 .zip 路径 */
    skillPaths?: string[];
    /** mcpServers 对象；空则不写 mcp.json */
    mcpServers?: Record<string, unknown>;
  },
  locale: UiLocale = "zh",
): Promise<LocalAgentCard> {
  validateSegment(userId);
  const { name, role, background } = normalizeIdentity(input, locale);
  const agentId = newLocalAgentId();
  const root = localAgentRoot(userDataRoot, userId, agentId);
  if (fs.existsSync(root)) throw new LocalAgentError(t("la.err.createFailed", locale));

  try {
    fs.mkdirSync(path.join(root, ".runtime"), { recursive: true });
    fs.mkdirSync(path.join(root, "sessions"), { recursive: true });
    const cwd = path.join(root, "cwd");
    fs.mkdirSync(cwd, { recursive: true });
    ensureCwdLayout(cwd);
    writeSystemMd(cwd, composeSystemPrompt({ name, role, background }, locale), locale);
    if (input.rules !== undefined) writeAgentsMd(root, input.rules, locale);
    projectAgentsMdToRuntime(root);

    if (input.mcpServers && Object.keys(input.mcpServers).length > 0) {
      writePiMcp(cwd, input.mcpServers, locale);
    }

    const skillPaths = input.skillPaths ?? [];
    if (skillPaths.length > 0) {
      const skillsDir = path.join(cwd, ".pi", "skills");
      fs.mkdirSync(skillsDir, { recursive: true });
      for (const skillPath of skillPaths) {
        try {
          await installSkillPackageTo(skillsDir, skillPath);
        } catch (error) {
          if (error instanceof UserResourceError) {
            throw new LocalAgentError(error.message);
          }
          throw error;
        }
      }
    }

    const now = new Date().toISOString();
    let avatarMime: string | undefined;
    let avatarFile: string | undefined;
    if (input.avatarDataUrl) {
      const avatar = decodeAvatar(input.avatarDataUrl, locale);
      fs.mkdirSync(path.join(root, "assets"), { recursive: true });
      avatarFile = `assets/avatar.${avatar.extension}`;
      fs.writeFileSync(path.join(root, avatarFile), avatar.bytes, { mode: 0o600 });
      avatarMime = avatar.mime;
    }

    const digest = digestOfPi(cwd);
    const stored: StoredInstance = {
      kind: "local",
      user_id: userId,
      agent_id: agentId,
      name,
      role,
      background,
      package_version: LOCAL_MANIFEST.version,
      package_digest: digest,
      active_session_id: "main",
      tools: [...LOCAL_MANIFEST.tools],
      model_capabilities: [...LOCAL_MANIFEST.modelCapabilities],
      project_trust: "granted",
      created_at: now,
      updated_at: now,
      ...(avatarMime && avatarFile ? { avatar_mime: avatarMime, avatar_file: avatarFile } : {}),
    };
    writeStoredInstance(root, stored);
    return toPublicCard(stored, root);
  } catch (error) {
    if (fs.existsSync(root)) fs.rmSync(root, { recursive: true, force: true });
    throw error;
  }
}

export function readLocalAgentCard(
  userDataRoot: string,
  userId: string,
  agentId: string,
): LocalAgentCard {
  const root = ensureLocalAgent(userDataRoot, userId, agentId);
  return toPublicCard(readStoredInstance(root), root);
}

export async function writeLocalAgentCard(
  userDataRoot: string,
  userId: string,
  agentId: string,
  input: {
    name: string;
    role: string;
    background: string;
    /** 空串删除两处 AGENTS.md；undefined 表示不改。 */
    rules?: string;
    avatarDataUrl?: string;
    skillPaths?: string[];
    removeSkills?: string[];
    /** 传入空对象表示清除 mcp.json；undefined 表示不改 */
    mcpServers?: Record<string, unknown>;
  },
  locale: UiLocale = "zh",
): Promise<LocalAgentCard> {
  const root = ensureLocalAgent(userDataRoot, userId, agentId);
  const previous = readStoredInstance(root);
  const { name, role, background } = normalizeIdentity(input, locale);
  const cwd = path.join(root, "cwd");
  writeSystemMd(cwd, composeSystemPrompt({ name, role, background }, locale), locale);
  if (input.rules !== undefined) writeAgentsMd(root, input.rules, locale);
  projectAgentsMdToRuntime(root);

  if (input.mcpServers !== undefined) {
    if (Object.keys(input.mcpServers).length === 0) clearPiMcp(cwd);
    else writePiMcp(cwd, input.mcpServers, locale);
  }

  for (const skillName of input.removeSkills ?? []) {
    removePiSkill(cwd, skillName, locale);
  }

  const skillPaths = input.skillPaths ?? [];
  if (skillPaths.length > 0) {
    const skillsDir = path.join(cwd, ".pi", "skills");
    fs.mkdirSync(skillsDir, { recursive: true });
    for (const skillPath of skillPaths) {
      try {
        await installSkillPackageTo(skillsDir, skillPath);
      } catch (error) {
        if (error instanceof UserResourceError) throw new LocalAgentError(error.message);
        throw error;
      }
    }
  }

  let avatarMime = previous.avatar_mime;
  let avatarFile = previous.avatar_file;
  if (input.avatarDataUrl !== undefined) {
    const avatar = decodeAvatar(input.avatarDataUrl, locale);
    removeAvatar(root, avatarFile);
    fs.mkdirSync(path.join(root, "assets"), { recursive: true });
    avatarFile = `assets/avatar.${avatar.extension}`;
    fs.writeFileSync(path.join(root, avatarFile), avatar.bytes, { mode: 0o600 });
    avatarMime = avatar.mime;
  }

  const stored: StoredInstance = {
    ...previous,
    name,
    role,
    background,
    package_digest: digestOfPi(cwd),
    updated_at: new Date().toISOString(),
    ...(previous.published_agent_id ? { published_agent_id: previous.published_agent_id } : {}),
    ...(avatarMime && avatarFile ? { avatar_mime: avatarMime, avatar_file: avatarFile } : {}),
  };
  if (!avatarMime || !avatarFile) {
    delete stored.avatar_mime;
    delete stored.avatar_file;
  }
  writeStoredInstance(root, stored);
  return toPublicCard(stored, root);
}

/** 首次发布或确认远端 id 后，把市场 agent_id 绑回本机 instance。 */
export function bindLocalPublishedAgent(
  userDataRoot: string,
  userId: string,
  agentId: string,
  publishedAgentId: string,
): LocalAgentCard {
  const root = ensureLocalAgent(userDataRoot, userId, agentId);
  const published = publishedAgentId.trim();
  if (!published || published.length > 64 || /[/\\\u0000]/.test(published)) {
    throw new LocalAgentError(t("la.err.invalidRequest", "zh"));
  }
  const previous = readStoredInstance(root);
  const stored: StoredInstance = {
    ...previous,
    published_agent_id: published,
    updated_at: new Date().toISOString(),
  };
  writeStoredInstance(root, stored);
  return toPublicCard(stored, root);
}

export function deleteLocalAgent(userDataRoot: string, userId: string, agentId: string): void {
  const root = localAgentRoot(userDataRoot, userId, agentId);
  if (!fs.existsSync(root)) throw new LocalAgentError(t("la.err.notFound", "zh"));
  const parent = localAgentsParent(userDataRoot, userId);
  if (!root.startsWith(`${parent}${path.sep}`)) {
    throw new LocalAgentError(t("la.err.invalidRequest", "zh"));
  }
  fs.rmSync(root, { recursive: true, force: true });
}

/**
 * 将已发布能力包物化为绑定草稿（跨设备编辑入口）。
 * 若已有绑定同一 publishedAgentId 的草稿则直接返回。
 */
export async function importPublishedAsLocalDraft(
  userDataRoot: string,
  userId: string,
  input: {
    publishedAgentId: string;
    name: string;
    role: string;
    background: string;
    rules?: string;
    avatarDataUrl?: string;
    packageFiles: Record<string, Uint8Array>;
  },
  locale: UiLocale = "zh",
): Promise<LocalAgentCard> {
  validateSegment(userId);
  const publishedId = input.publishedAgentId.trim();
  if (!publishedId) throw new LocalAgentError(t("la.err.invalidRequest", locale));
  const existing = listLocalAgents(userDataRoot, userId).find(
    (item) => item.publishedAgentId === publishedId,
  );
  if (existing) return readLocalAgentCard(userDataRoot, userId, existing.agentId);

  const card = await createLocalAgent(
    userDataRoot,
    userId,
    {
      name: input.name,
      role: input.role,
      background: input.background,
      rules: input.rules ?? "",
      ...(input.avatarDataUrl ? { avatarDataUrl: input.avatarDataUrl } : {}),
    },
    locale,
  );
  const root = localAgentRoot(userDataRoot, userId, card.agentId);
  const cwd = path.join(root, "cwd");
  const pi = path.join(cwd, ".pi");
  fs.mkdirSync(pi, { recursive: true });
  for (const [relative, bytes] of Object.entries(input.packageFiles)) {
    const normalized = relative.replace(/\\/g, "/");
    if (
      !normalized ||
      normalized.endsWith("/") ||
      normalized.includes("..") ||
      path.isAbsolute(normalized)
    ) {
      continue;
    }
    const target = path.resolve(pi, normalized);
    if (!target.startsWith(`${pi}${path.sep}`) && target !== pi) continue;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, Buffer.from(bytes));
  }
  // 名片层权威：覆盖包内 SYSTEM / AGENTS。
  const { name, role, background } = normalizeIdentity(input, locale);
  writeSystemMd(cwd, composeSystemPrompt({ name, role, background }, locale), locale);
  writeAgentsMd(root, input.rules ?? "", locale);
  projectAgentsMdToRuntime(root);
  const digest = digestOfPi(cwd);
  const stored = readStoredInstance(root);
  stored.package_digest = digest;
  stored.updated_at = new Date().toISOString();
  writeStoredInstance(root, stored);
  return bindLocalPublishedAgent(userDataRoot, userId, card.agentId, publishedId);
}

/** 将本机 Agent 已安装的 skill 目录打成 .zip，写入用户选定的绝对路径。 */
export function exportLocalAgentSkill(
  userDataRoot: string,
  userId: string,
  agentId: string,
  skillName: string,
  destination: string,
  locale: UiLocale = "zh",
): { path: string } {
  if (!SKILL_DIR_NAME.test(skillName) || skillName.length > 64) {
    throw new LocalAgentError(t("la.err.invalidRequest", locale));
  }
  if (!destination || typeof destination !== "string" || !path.isAbsolute(destination)) {
    throw new LocalAgentError(t("la.err.invalidRequest", locale));
  }
  if (!destination.toLowerCase().endsWith(".zip")) {
    throw new LocalAgentError(t("la.err.skillExportPath", locale));
  }
  const root = ensureLocalAgent(userDataRoot, userId, agentId);
  const skillsDir = path.resolve(root, "cwd", ".pi", "skills");
  const skillDir = path.resolve(skillsDir, skillName);
  if (!skillDir.startsWith(`${skillsDir}${path.sep}`)) {
    throw new LocalAgentError(t("la.err.invalidRequest", locale));
  }
  if (!fs.existsSync(skillDir) || !fs.existsSync(path.join(skillDir, "SKILL.md"))) {
    throw new LocalAgentError(t("la.err.skillNotFound", locale));
  }
  const out = path.resolve(destination);
  try {
    writeZipFromDirectory(skillDir, out, { maxBytes: 5_000_000 });
  } catch {
    throw new LocalAgentError(t("la.err.skillExportFailed", locale));
  }
  return { path: out };
}

export function localAgentVisit(userDataRoot: string, userId: string, agentId: string): Visit {
  const root = ensureLocalAgent(userDataRoot, userId, agentId);
  const stored = readStoredInstance(root);
  return {
    kind: "local",
    userId: stored.user_id,
    agentId: stored.agent_id,
    root,
    packageVersion: stored.package_version,
    packageDigest: stored.package_digest,
    tools: stored.tools,
    modelCapabilities: stored.model_capabilities,
    projectTrust: stored.project_trust,
  };
}

function newLocalAgentId(): string {
  const suffix = randomBytes(8).toString("base64url").replace(/[^A-Za-z0-9]/g, "").slice(0, 10);
  if (suffix.length < 8) {
    return `${LOCAL_ID_PREFIX}${randomBytes(6).toString("hex")}`;
  }
  return `${LOCAL_ID_PREFIX}${suffix}`;
}

function ensurePiScaffold(cwd: string): void {
  const pi = path.join(cwd, ".pi");
  fs.mkdirSync(pi, { recursive: true });
  const system = path.join(pi, "SYSTEM.md");
  if (!fs.existsSync(system)) {
    fs.writeFileSync(system, "\n", { mode: 0o600 });
  }
}

function writeSystemMd(cwd: string, systemPrompt: string, locale: UiLocale): void {
  const pi = path.join(cwd, ".pi");
  fs.mkdirSync(pi, { recursive: true });
  const body = `${systemPrompt.trim()}\n`;
  const files: Record<string, Uint8Array> = { "SYSTEM.md": Buffer.from(body, "utf8") };
  // 保留已有 AGENTS.md / skills / rules / mcp 等（编辑名片时不抹掉）
  const existing = readPiTree(pi);
  for (const [rel, content] of Object.entries(existing)) {
    if (rel === "SYSTEM.md") continue;
    files[rel] = content;
  }
  const issues = validateAgentPackage(files);
  if (issues.length > 0) {
    throw new LocalAgentError(
      `${t("la.err.packageInvalid", locale)}: ${issues[0]!.path}: ${issues[0]!.message}`,
    );
  }
  const temporary = `${path.join(pi, "SYSTEM.md")}.tmp`;
  fs.writeFileSync(temporary, body, { mode: 0o600 });
  fs.renameSync(temporary, path.join(pi, "SYSTEM.md"));
}

function writeAgentsMd(root: string, content: string, locale: UiLocale): void {
  const cwd = path.join(root, "cwd");
  const pi = path.join(cwd, ".pi");
  const normalized = content.trim();
  const files = readPiTree(pi);
  if (normalized) files["AGENTS.md"] = Buffer.from(`${normalized}\n`, "utf8");
  else delete files["AGENTS.md"];
  const issues = validateAgentPackage(files);
  if (issues.length > 0) {
    throw new LocalAgentError(
      `${t("la.err.packageInvalid", locale)}: ${issues[0]!.path}: ${issues[0]!.message}`,
    );
  }

  const piFile = path.join(pi, "AGENTS.md");
  const runtime = path.join(root, ".runtime");
  const runtimeFile = path.join(runtime, "AGENTS.md");
  if (!normalized) {
    fs.rmSync(piFile, { force: true });
    fs.rmSync(runtimeFile, { force: true });
    return;
  }
  fs.mkdirSync(pi, { recursive: true });
  fs.mkdirSync(runtime, { recursive: true });
  writeAtomicText(piFile, `${normalized}\n`);
  writeAtomicText(runtimeFile, `${normalized}\n`);
}

function readAgentsMd(root: string): string {
  const piFile = path.join(root, "cwd", ".pi", "AGENTS.md");
  const runtimeFile = path.join(root, ".runtime", "AGENTS.md");
  const file = fs.existsSync(piFile) ? piFile : runtimeFile;
  if (!fs.existsSync(file)) return "";
  return fs.readFileSync(file, "utf8").trim();
}

function projectAgentsMdToRuntime(root: string): void {
  const source = path.join(root, "cwd", ".pi", "AGENTS.md");
  const runtime = path.join(root, ".runtime");
  const target = path.join(runtime, "AGENTS.md");
  if (!fs.existsSync(source)) {
    fs.rmSync(target, { force: true });
    return;
  }
  fs.mkdirSync(runtime, { recursive: true });
  writeAtomicText(target, fs.readFileSync(source, "utf8"));
}

function writeAtomicText(file: string, content: string): void {
  const temporary = `${file}.tmp`;
  fs.writeFileSync(temporary, content, { mode: 0o600 });
  fs.renameSync(temporary, file);
}

const MCP_MAX_BYTES = 200_000;

const SKILL_DIR_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function listPiSkills(root: string): string[] {
  const skillsDir = path.join(root, "cwd", ".pi", "skills");
  if (!fs.existsSync(skillsDir) || !fs.statSync(skillsDir).isDirectory()) return [];
  return fs
    .readdirSync(skillsDir)
    .filter((name) => SKILL_DIR_NAME.test(name))
    .filter((name) => fs.existsSync(path.join(skillsDir, name, "SKILL.md")))
    .sort();
}

function readPiMcpServers(root: string): Record<string, unknown> {
  const file = path.join(root, "cwd", ".pi", "mcp.json");
  if (!fs.existsSync(file)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const servers = (parsed as { mcpServers?: unknown }).mcpServers;
    if (!servers || typeof servers !== "object" || Array.isArray(servers)) return {};
    return servers as Record<string, unknown>;
  } catch {
    return {};
  }
}

function clearPiMcp(cwd: string): void {
  const file = path.join(cwd, ".pi", "mcp.json");
  if (fs.existsSync(file)) fs.rmSync(file, { force: true });
}

function removePiSkill(cwd: string, skillName: string, locale: UiLocale): void {
  if (!SKILL_DIR_NAME.test(skillName) || skillName.length > 64) {
    throw new LocalAgentError(t("la.err.invalidRequest", locale));
  }
  const skillsDir = path.resolve(cwd, ".pi", "skills");
  const target = path.resolve(skillsDir, skillName);
  if (!target.startsWith(`${skillsDir}${path.sep}`)) {
    throw new LocalAgentError(t("la.err.invalidRequest", locale));
  }
  if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
}

function writePiMcp(cwd: string, mcpServers: Record<string, unknown>, locale: UiLocale): void {
  if (!mcpServers || typeof mcpServers !== "object" || Array.isArray(mcpServers)) {
    throw new LocalAgentError(t("la.err.mcpInvalid", locale));
  }
  const payload = `${JSON.stringify({ mcpServers }, null, 2)}\n`;
  if (Buffer.byteLength(payload, "utf8") > MCP_MAX_BYTES) {
    throw new LocalAgentError(t("la.err.mcpTooLarge", locale));
  }
  const pi = path.join(cwd, ".pi");
  fs.mkdirSync(pi, { recursive: true });
  const files: Record<string, Uint8Array> = {
    ...readPiTree(pi),
    "mcp.json": Buffer.from(payload, "utf8"),
  };
  if (!files["SYSTEM.md"]) files["SYSTEM.md"] = Buffer.from("ok\n");
  const issues = validateAgentPackage(files).filter((issue) => issue.path === "mcp.json");
  if (issues.length > 0) {
    throw new LocalAgentError(
      `${t("la.err.mcpInvalid", locale)}: ${issues[0]!.message}`,
    );
  }
  const file = path.join(pi, "mcp.json");
  const temporary = `${file}.tmp`;
  fs.writeFileSync(temporary, payload, { mode: 0o600 });
  fs.renameSync(temporary, file);
}

function digestOfPi(cwd: string): string {
  return packageDigest(LOCAL_MANIFEST, readPiTree(path.join(cwd, ".pi")));
}

function readPiTree(piRoot: string): Record<string, Uint8Array> {
  if (!fs.existsSync(piRoot) || !fs.statSync(piRoot).isDirectory()) return {};
  const files: Record<string, Uint8Array> = {};
  const walk = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      const relative = path.relative(piRoot, full).split(path.sep).join("/");
      files[relative] = fs.readFileSync(full);
    }
  };
  walk(piRoot);
  return files;
}

function normalizeIdentity(
  input: { name: string; role: string; background: string },
  locale: UiLocale,
): { name: string; role: string; background: string } {
  try {
    return {
      name: normalizeAgentName(input.name, locale),
      role: normalizeAgentRole(input.role, locale),
      background: normalizeAgentBackground(input.background, locale),
    };
  } catch (error) {
    if (error instanceof AgentIdentityError) throw new LocalAgentError(error.message);
    throw error;
  }
}

function readStoredInstance(root: string): StoredInstance {
  const parsed = JSON.parse(fs.readFileSync(path.join(root, "instance.json"), "utf8")) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new LocalAgentError(t("la.err.corrupt", "zh"));
  }
  const value = parsed as Record<string, unknown>;
  const migratedSummary =
    value.background === undefined && typeof value.summary === "string" ? value.summary : undefined;
  const background = value.background ?? migratedSummary;
  if (
    value.kind !== "local" ||
    typeof value.user_id !== "string" ||
    typeof value.agent_id !== "string" ||
    typeof value.name !== "string" ||
    typeof value.role !== "string" ||
    typeof background !== "string" ||
    !background.trim() ||
    background.length > BACKGROUND_MAX ||
    typeof value.package_version !== "number" ||
    typeof value.package_digest !== "string" ||
    typeof value.created_at !== "string" ||
    typeof value.updated_at !== "string"
  ) {
    throw new LocalAgentError(t("la.err.corrupt", "zh"));
  }
  const tools = Array.isArray(value.tools) && value.tools.every((item) => typeof item === "string")
    ? (value.tools as string[])
    : [];
  const caps =
    Array.isArray(value.model_capabilities) &&
    value.model_capabilities.every((item) => typeof item === "string")
      ? (value.model_capabilities as string[])
      : ["tools"];
  const active =
    typeof value.active_session_id === "string" && value.active_session_id ? value.active_session_id : "main";
  const stored: StoredInstance = {
    kind: "local",
    user_id: value.user_id,
    agent_id: value.agent_id,
    name: value.name,
    role: value.role,
    background,
    package_version: value.package_version,
    package_digest: value.package_digest,
    active_session_id: active,
    tools,
    model_capabilities: caps,
    project_trust: "granted",
    created_at: value.created_at,
    updated_at: value.updated_at,
    ...(typeof value.published_agent_id === "string" && value.published_agent_id.trim()
      ? { published_agent_id: value.published_agent_id.trim() }
      : {}),
    ...(typeof value.avatar_mime === "string" && typeof value.avatar_file === "string"
      ? { avatar_mime: value.avatar_mime, avatar_file: value.avatar_file }
      : {}),
  };
  if (migratedSummary !== undefined) writeStoredInstance(root, stored);
  return stored;
}

function writeStoredInstance(root: string, instance: StoredInstance): void {
  const file = path.join(root, "instance.json");
  const temporary = `${file}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(instance, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, file);
}

function toPublicCard(stored: StoredInstance, root: string): LocalAgentCard {
  return {
    agentId: stored.agent_id,
    name: stored.name,
    role: stored.role,
    background: stored.background,
    rules: readAgentsMd(root),
    skills: listPiSkills(root),
    mcpServers: readPiMcpServers(root),
    packageDigest: stored.package_digest,
    createdAt: stored.created_at,
    updatedAt: stored.updated_at,
    ...(stored.published_agent_id ? { publishedAgentId: stored.published_agent_id } : {}),
    ...(stored.avatar_file && stored.avatar_mime
      ? { avatarUrl: avatarDataUrl(root, stored.avatar_file, stored.avatar_mime) }
      : {}),
  };
}

function decodeAvatar(
  dataUrl: string,
  locale: UiLocale,
): { mime: string; extension: string; bytes: Buffer } {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=\s]+)$/.exec(dataUrl);
  if (!match) throw new LocalAgentError(t("la.err.avatarType", locale));
  const bytes = Buffer.from(match[2]!.replace(/\s/g, ""), "base64");
  if (!bytes.length || bytes.length > MAX_AVATAR_BYTES) {
    throw new LocalAgentError(t("la.err.avatarSize", locale));
  }
  if (!avatarSignatureMatches(match[1]!, bytes)) {
    throw new LocalAgentError(t("la.err.avatarMismatch", locale));
  }
  const extension = match[1] === "image/jpeg" ? "jpg" : match[1]!.slice("image/".length);
  return { mime: match[1]!, extension, bytes };
}

function avatarSignatureMatches(mime: string, bytes: Buffer): boolean {
  if (mime === "image/png") {
    return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  }
  if (mime === "image/jpeg") return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  return bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
}

function avatarDataUrl(root: string, fileName: string, mime: string): string | undefined {
  const file = path.resolve(root, fileName);
  if (!file.startsWith(`${root}${path.sep}`) || !fs.existsSync(file)) return undefined;
  return `data:${mime};base64,${fs.readFileSync(file).toString("base64")}`;
}

function removeAvatar(root: string, fileName?: string): void {
  if (!fileName) return;
  const file = path.resolve(root, fileName);
  if (file.startsWith(`${root}${path.sep}`)) fs.rmSync(file, { force: true });
}

function validateSegment(value: string): void {
  if (!value || value === "." || value === ".." || /[/\\\u0000]/.test(value)) {
    throw new LocalAgentError(t("la.err.invalidRequest", "zh"));
  }
}
