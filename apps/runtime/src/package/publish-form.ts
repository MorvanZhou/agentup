/**
 * 市场发布表单：在临时目录组包上传，不创建 loc-* 本机 Agent。
 * 本机私有 Agent 的「一键发布」仍走 agent_dir → /agents/publish。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { listOwnedAgents, publishAgent, type PublishedAgent } from "../control/client.js";
import { HttpPackageSource } from "../control/package-source.js";
import { type UiLocale } from "../i18n/index.js";
import { installSkillPackageTo, UserResourceError } from "../local/assistant/user-resources.js";
import { AgentSourceError, preparePublishSource } from "./source.js";

const SKILL_DIR_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MCP_MAX_BYTES = 200_000;
const MAX_AVATAR_BYTES = 1_048_576;

export type PublishEditorPreview = {
  agentId: string;
  name: string;
  role: string;
  background: string;
  rules: string;
  skills: string[];
  mcpServers: Record<string, unknown>;
  avatarUrl?: string;
};

export type PublishFormInput = {
  name: string;
  role: string;
  background: string;
  rules?: string;
  /** 升版时传入已发布 agent_id */
  agentId?: string;
  skillPaths?: string[];
  removeSkills?: string[];
  /** 传入（含空对象）表示覆盖 mcp.json；新建且省略则不写 */
  mcpServers?: Record<string, unknown>;
  avatarDataUrl?: string;
};

/** 打开更新页：读名片 + 能力包预览，不落盘 loc-*。 */
export async function previewOwnedPublishEditor(
  backendUrl: string,
  token: string,
  publishedAgentId: string,
): Promise<PublishEditorPreview> {
  const publishedId = publishedAgentId.trim();
  if (!publishedId) throw new AgentSourceError("请求无效");
  const owned = await listOwnedAgents(backendUrl, token);
  const card = owned.find((item) => item.agentId === publishedId);
  if (!card) throw new AgentSourceError("找不到要更新的 Agent");
  const release = await new HttpPackageSource(backendUrl, token).getPackage(publishedId);
  const packageRules = Buffer.from(release.files["AGENTS.md"] ?? []).toString("utf8").trim();
  return {
    agentId: card.agentId,
    name: card.name,
    role: card.role,
    background: card.background,
    rules: card.rules || packageRules,
    skills: skillsFromFiles(release.files),
    mcpServers: mcpFromFiles(release.files),
    ...(card.avatarUrl ? { avatarUrl: card.avatarUrl } : {}),
  };
}

/**
 * 表单发布 / 升版：临时 staging（os.tmpdir）组包后上传，结束后删除。
 * 不写入 users/<uid>/agents/loc-*。
 */
export async function publishFromForm(
  backendUrl: string,
  token: string,
  input: PublishFormInput,
  locale: UiLocale = "zh",
): Promise<PublishedAgent> {
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-publish-form-"));
  try {
    const cwd = path.join(staging, "cwd");
    const pi = path.join(cwd, ".pi");
    fs.mkdirSync(pi, { recursive: true });

    const publishedId = input.agentId?.trim();
    if (publishedId) {
      const owned = await listOwnedAgents(backendUrl, token);
      if (!owned.some((item) => item.agentId === publishedId)) {
        throw new AgentSourceError("找不到要更新的 Agent");
      }
      const release = await new HttpPackageSource(backendUrl, token).getPackage(publishedId);
      writePackageFiles(pi, release.files);
    } else {
      // 占位 SYSTEM；preparePublishSource 会按名片覆盖 compose。
      fs.writeFileSync(path.join(pi, "SYSTEM.md"), "ok\n", { mode: 0o600 });
    }

    const rules = input.rules ?? "";
    writeAgentsMd(pi, rules);

    if (input.mcpServers !== undefined) {
      if (Object.keys(input.mcpServers).length === 0) {
        fs.rmSync(path.join(pi, "mcp.json"), { force: true });
      } else {
        writeMcp(pi, input.mcpServers);
      }
    }

    for (const skillName of input.removeSkills ?? []) {
      removeSkill(pi, skillName);
    }

    const skillPaths = input.skillPaths ?? [];
    if (skillPaths.length > 0) {
      const skillsDir = path.join(pi, "skills");
      fs.mkdirSync(skillsDir, { recursive: true });
      for (const skillPath of skillPaths) {
        try {
          await installSkillPackageTo(skillsDir, skillPath);
        } catch (error) {
          if (error instanceof UserResourceError) throw new AgentSourceError(error.message);
          throw error;
        }
      }
    }

    if (input.avatarDataUrl) {
      const avatar = decodeAvatar(input.avatarDataUrl);
      const assets = path.join(staging, "assets");
      fs.mkdirSync(assets, { recursive: true });
      fs.writeFileSync(path.join(assets, `avatar.${avatar.extension}`), avatar.bytes, { mode: 0o600 });
    }

    const source = preparePublishSource(
      staging,
      { name: input.name, role: input.role, background: input.background },
      locale,
    );
    return await publishAgent(
      backendUrl,
      token,
      source,
      input.name,
      input.role,
      input.background,
      publishedId,
      rules,
    );
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

function writePackageFiles(pi: string, files: Record<string, Uint8Array>): void {
  for (const [relative, bytes] of Object.entries(files)) {
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
}

function writeAgentsMd(pi: string, content: string): void {
  const file = path.join(pi, "AGENTS.md");
  const normalized = content.trim();
  if (!normalized) {
    fs.rmSync(file, { force: true });
    return;
  }
  fs.writeFileSync(file, `${normalized}\n`, { mode: 0o600 });
}

function writeMcp(pi: string, mcpServers: Record<string, unknown>): void {
  if (!mcpServers || typeof mcpServers !== "object" || Array.isArray(mcpServers)) {
    throw new AgentSourceError("mcp_servers 无效");
  }
  const payload = `${JSON.stringify({ mcpServers }, null, 2)}\n`;
  if (Buffer.byteLength(payload, "utf8") > MCP_MAX_BYTES) {
    throw new AgentSourceError("mcp.json 过大");
  }
  fs.mkdirSync(pi, { recursive: true });
  fs.writeFileSync(path.join(pi, "mcp.json"), payload, { mode: 0o600 });
}

function removeSkill(pi: string, skillName: string): void {
  if (!SKILL_DIR_NAME.test(skillName) || skillName.length > 64) {
    throw new AgentSourceError("remove_skills 无效");
  }
  const skillsDir = path.resolve(pi, "skills");
  const target = path.resolve(skillsDir, skillName);
  if (!target.startsWith(`${skillsDir}${path.sep}`)) {
    throw new AgentSourceError("remove_skills 无效");
  }
  if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
}

export function skillsFromFiles(files: Record<string, Uint8Array>): string[] {
  const names = new Set<string>();
  for (const key of Object.keys(files)) {
    const match = /^skills\/([^/]+)\/SKILL\.md$/.exec(key.replace(/\\/g, "/"));
    if (match && SKILL_DIR_NAME.test(match[1]!) && match[1]!.length <= 64) {
      names.add(match[1]!);
    }
  }
  return [...names].sort();
}

export function mcpFromFiles(files: Record<string, Uint8Array>): Record<string, unknown> {
  const raw = files["mcp.json"];
  if (!raw) return {};
  try {
    const parsed = JSON.parse(Buffer.from(raw).toString("utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const servers = (parsed as { mcpServers?: unknown }).mcpServers;
    if (!servers || typeof servers !== "object" || Array.isArray(servers)) return {};
    return servers as Record<string, unknown>;
  } catch {
    return {};
  }
}

function decodeAvatar(dataUrl: string): { extension: string; bytes: Buffer } {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=\s]+)$/.exec(dataUrl);
  if (!match) throw new AgentSourceError("头像无效");
  const bytes = Buffer.from(match[2]!.replace(/\s/g, ""), "base64");
  if (!bytes.length || bytes.length > MAX_AVATAR_BYTES) {
    throw new AgentSourceError("头像文件必须小于 1MB");
  }
  if (!avatarSignatureMatches(match[1]!, bytes)) {
    throw new AgentSourceError("头像内容与类型不一致");
  }
  const extension = match[1] === "image/jpeg" ? "jpg" : match[1]!.slice("image/".length);
  return { extension, bytes };
}

function avatarSignatureMatches(mime: string, bytes: Buffer): boolean {
  if (mime === "image/png") {
    return (
      bytes.length >= 8 &&
      bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    );
  }
  if (mime === "image/jpeg") {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  return (
    bytes.length >= 12 &&
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP"
  );
}
