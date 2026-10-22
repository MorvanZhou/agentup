import fs from "node:fs";
import path from "node:path";

import { t, type UiLocale } from "../../i18n/index.js";
import type { Visit } from "../../package/sync.js";
import { ensureCwdLayout } from "../../session/workspace/cwd-layout.js";
import {
  AgentIdentityError,
  BACKGROUND_MAX,
  composeSystemPrompt,
  normalizeAgentBackground,
  normalizeAgentName,
  normalizeAgentRole,
} from "../agents/identity.js";

export const PERSONAL_ASSISTANT_ID = "personal-assistant";

const MAX_AVATAR_BYTES = 1_000_000;

export class PersonalAssistantError extends Error {}

export interface PersonalAssistantProfile {
  name: string;
  role: string;
  background: string;
  avatarUrl?: string;
}

interface StoredProfile {
  name: string;
  role: string;
  background: string;
  avatar_mime?: string;
  avatar_file?: string;
}

export function personalAssistantRoot(userDataRoot: string, userId: string): string {
  validateSegment(userId);
  return path.resolve(userDataRoot, "users", userId, "personal-assistant");
}

/** 把旧版 users/<uid> 根部的个人资源一次性移入私人助理命名空间。 */
export function ensurePersonalAssistant(
  userDataRoot: string,
  userId: string,
  locale: UiLocale = "zh",
): string {
  const userRoot = path.resolve(userDataRoot, "users", userId);
  const root = personalAssistantRoot(userDataRoot, userId);
  fs.mkdirSync(root, { recursive: true });
  for (const name of ["skills", "skills-state.json", "mcp.json"]) {
    const legacy = path.join(userRoot, name);
    const target = path.join(root, name);
    if (fs.existsSync(legacy) && !fs.existsSync(target)) fs.renameSync(legacy, target);
  }
  fs.mkdirSync(path.join(root, ".runtime"), { recursive: true });
  fs.mkdirSync(path.join(root, "sessions"), { recursive: true });
  // cwd 只放工作产物；配置在 cwd 外（.runtime / skills / mcp），模型工具改不到。
  fs.mkdirSync(path.join(root, "cwd"), { recursive: true });
  ensureCwdLayout(path.join(root, "cwd"));
  removePersonalCwdPi(root);
  if (!fs.existsSync(path.join(root, "profile.json"))) {
    writeStoredProfile(root, {
      name: t("pa.defaultName", locale),
      role: t("pa.defaultRole", locale),
      background: t("pa.defaultBackground", locale),
    });
  }
  const stored = localizeFactoryDefaults(readStoredProfile(root), locale);
  syncSystemPrompt(root, composeSystemPrompt(stored, locale));
  return root;
}

export function readPersonalAssistantProfile(
  userDataRoot: string,
  userId: string,
  locale: UiLocale = "zh",
): PersonalAssistantProfile {
  const root = ensurePersonalAssistant(userDataRoot, userId, locale);
  const stored = localizeFactoryDefaults(readStoredProfile(root), locale);
  return {
    name: stored.name,
    role: stored.role,
    background: stored.background,
    ...(stored.avatar_file && stored.avatar_mime
      ? { avatarUrl: avatarDataUrl(root, stored.avatar_file, stored.avatar_mime) }
      : {}),
  };
}

export function writePersonalAssistantProfile(
  userDataRoot: string,
  userId: string,
  input: { name: string; role: string; background: string; avatarDataUrl?: string },
  locale: UiLocale = "zh",
): PersonalAssistantProfile {
  const root = ensurePersonalAssistant(userDataRoot, userId, locale);
  let name: string;
  let role: string;
  let background: string;
  try {
    name = normalizeAgentName(input.name, locale);
    role = normalizeAgentRole(input.role, locale);
    background = normalizeAgentBackground(input.background, locale);
  } catch (error) {
    if (error instanceof AgentIdentityError) {
      throw new PersonalAssistantError(error.message);
    }
    throw error;
  }
  const previous = readStoredProfile(root);
  let avatarMime = previous.avatar_mime;
  let avatarFile = previous.avatar_file;
  if (input.avatarDataUrl !== undefined) {
    const avatar = decodeAvatar(input.avatarDataUrl, locale);
    removeAvatar(root, avatarFile);
    avatarFile = `avatar.${avatar.extension}`;
    fs.writeFileSync(path.join(root, avatarFile), avatar.bytes, { mode: 0o600 });
    avatarMime = avatar.mime;
  }
  const stored: StoredProfile = {
    name,
    role,
    background,
    ...(avatarMime && avatarFile ? { avatar_mime: avatarMime, avatar_file: avatarFile } : {}),
  };
  writeStoredProfile(root, stored);
  syncSystemPrompt(root, composeSystemPrompt({ name, role, background }, locale));
  return readPersonalAssistantProfile(userDataRoot, userId, locale);
}

export function personalAssistantVisit(userDataRoot: string, userId: string): Visit {
  const root = ensurePersonalAssistant(userDataRoot, userId);
  return {
    kind: "personal",
    userId,
    agentId: PERSONAL_ASSISTANT_ID,
    root,
    packageVersion: 1,
    packageDigest: "personal-assistant-v1",
    tools: [],
    modelCapabilities: ["tools"],
    projectTrust: "granted",
  };
}

function readStoredProfile(root: string): StoredProfile {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(root, "profile.json"), "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("shape");
    const value = parsed as Record<string, unknown>;
    if (typeof value.name !== "string") throw new Error("shape");
    const legacyInstructions = typeof value.instructions === "string" ? value.instructions : undefined;
    const role = typeof value.role === "string" ? value.role : t("pa.defaultRole", "zh");
    const background =
      typeof value.background === "string"
        ? value.background
        : legacyInstructions !== undefined
          ? legacyInstructions.slice(0, BACKGROUND_MAX)
          : undefined;
    if (background === undefined) throw new Error("shape");
    const profile: StoredProfile = {
      name: value.name,
      role,
      background,
      ...(typeof value.avatar_mime === "string" && typeof value.avatar_file === "string"
        ? { avatar_mime: value.avatar_mime, avatar_file: value.avatar_file }
        : {}),
    };
    if (typeof value.role !== "string" || typeof value.background !== "string") {
      writeStoredProfile(root, profile);
    }
    return profile;
  } catch {
    return {
      name: t("pa.defaultName", "zh"),
      role: t("pa.defaultRole", "zh"),
      background: t("pa.defaultBackground", "zh"),
    };
  }
}

function writeStoredProfile(root: string, profile: StoredProfile): void {
  const file = path.join(root, "profile.json");
  const temporary = `${file}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(profile, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, file);
}

/** 投影到 Pi agentDir（`.runtime/SYSTEM.md`），不在 cwd 内，避免模型改写。 */
function syncSystemPrompt(root: string, systemPrompt: string): void {
  const file = path.join(root, ".runtime", "SYSTEM.md");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  fs.writeFileSync(temporary, `${systemPrompt.trim()}\n`, { mode: 0o600 });
  fs.renameSync(temporary, file);
}

/** 私人助理 cwd 不得承载 `.pi` 项目配置；若残留则删除。 */
function removePersonalCwdPi(root: string): void {
  const pi = path.join(root, "cwd", ".pi");
  if (fs.existsSync(pi)) fs.rmSync(pi, { recursive: true, force: true });
}

function decodeAvatar(
  dataUrl: string,
  locale: UiLocale,
): { mime: string; extension: string; bytes: Buffer } {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=\s]+)$/.exec(dataUrl);
  if (!match) throw new PersonalAssistantError(t("pa.err.avatarType", locale));
  const bytes = Buffer.from(match[2].replace(/\s/g, ""), "base64");
  if (!bytes.length || bytes.length > MAX_AVATAR_BYTES) {
    throw new PersonalAssistantError(t("pa.err.avatarSize", locale));
  }
  if (!avatarSignatureMatches(match[1], bytes)) {
    throw new PersonalAssistantError(t("pa.err.avatarMismatch", locale));
  }
  const extension = match[1] === "image/jpeg" ? "jpg" : match[1].slice("image/".length);
  return { mime: match[1], extension, bytes };
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
    throw new PersonalAssistantError(t("pa.err.invalidRequest", "zh"));
  }
}

function localizeDefaultName(name: string, locale: UiLocale): string {
  const factory = new Set([
    t("pa.defaultName", "zh"),
    t("pa.defaultName", "en"),
    "我的助理",
    "My assistant",
  ]);
  if (factory.has(name)) return t("pa.defaultName", locale);
  return name;
}

function localizeFactoryDefaults(profile: StoredProfile, locale: UiLocale): StoredProfile {
  return {
    ...profile,
    name: localizeDefaultName(profile.name, locale),
    role: localizeDefaultValue(profile.role, "pa.defaultRole", locale),
    background: localizeDefaultValue(profile.background, "pa.defaultBackground", locale),
  };
}

function localizeDefaultValue(
  value: string,
  key: "pa.defaultRole" | "pa.defaultBackground",
  locale: UiLocale,
): string {
  if (value === t(key, "zh") || value === t(key, "en")) return t(key, locale);
  return value;
}
