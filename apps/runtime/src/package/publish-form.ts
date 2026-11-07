/**
 * 市场发布表单：在临时目录组包上传，不创建 loc-* 本机 Agent。
 * 本机私有 Agent 的「一键发布」仍走 agent_dir → /agents/publish。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { packTarGz } from "./archive.js";
import { md5Hex } from "./capability.js";
import { normalizeMcpServers } from "./mcp-document.js";
import { listOwnedAgents, publishAgent, publishManifest, type PublishedAgent } from "../control/client.js";
import { type UiLocale } from "../i18n/index.js";
import { installSkillPackageTo, UserResourceError } from "../local/assistant/user-resources.js";
import { AgentSourceError, preparePublishSource } from "./source.js";
import { isSafeSkillName, validateAgentPackage } from "./validate.js";

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
  /** 名片上有 mcp 对象，正文要等用户点编辑再拉。 */
  mcpPresent: boolean;
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
  // skill 名字和 MCP 是否存在都在名片上。正文等用户点编辑再拉，避免整包下载。
  return {
    agentId: card.agentId,
    name: card.name,
    role: card.role,
    background: card.background,
    rules: card.rules,
    skills: card.skills.map((skill) => skill.name),
    mcpServers: {},
    mcpPresent: Boolean(card.mcpMd5),
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
      const card = owned.find((item) => item.agentId === publishedId);
      if (!card) throw new AgentSourceError("找不到要更新的 Agent");
      const remove = new Set(input.removeSkills ?? []);
      const skills = card.skills
        .filter((skill) => !remove.has(skill.name))
        .map((skill) => ({ name: skill.name, md5: skill.md5 }));
      const skillsDir = path.join(pi, "skills");
      fs.mkdirSync(skillsDir, { recursive: true });
      for (const skillPath of input.skillPaths ?? []) {
        let installed: { name: string };
        try {
          installed = await installSkillPackageTo(skillsDir, skillPath);
        } catch (error) {
          if (error instanceof UserResourceError) throw new AgentSourceError(error.message);
          throw error;
        }
        const body = await packTarGz(readSkillFiles(path.join(skillsDir, installed.name)));
        const next = { name: installed.name, md5: md5Hex(body), body };
        const index = skills.findIndex((skill) => skill.name === next.name);
        if (index >= 0) skills[index] = next;
        else skills.push(next);
      }
      let avatar: Uint8Array | undefined;
      if (input.avatarDataUrl) {
        const decoded = decodeAvatar(input.avatarDataUrl);
        avatar = decoded.bytes;
      }
      return await publishManifest({
        backendUrl,
        token,
        name: input.name,
        role: input.role,
        background: input.background,
        rules: input.rules ?? "",
        agentId: publishedId,
        skills,
        mcp: mcpPart(input.mcpServers),
        avatar,
      });
    }
    // 占位 SYSTEM；preparePublishSource 会按名片覆盖 compose。
    fs.writeFileSync(path.join(pi, "SYSTEM.md"), "ok\n", { mode: 0o600 });

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

function mcpPart(mcpServers: Record<string, unknown> | undefined): { md5: string; body: Uint8Array } | "" | undefined {
  if (mcpServers === undefined) return undefined;
  const servers = normalizeMcpServers(mcpServers);
  if (Object.keys(servers).length === 0) return "";
  const payload = `${JSON.stringify({ mcpServers: servers }, null, 2)}\n`;
  if (Buffer.byteLength(payload, "utf8") > MCP_MAX_BYTES) throw new AgentSourceError("mcp.json 过大");
  const body = Buffer.from(payload);
  // 更新发布不走整包校验。server 值不是对象时要在上传前拒绝，否则会写进 COS，招募时才失败。
  const issues = validateAgentPackage({
    "SYSTEM.md": Buffer.from("ok\n"),
    "mcp.json": body,
  }).filter((issue) => issue.path === "mcp.json");
  if (issues.length > 0) throw new AgentSourceError("运行包校验失败: mcp.json", issues);
  return { md5: md5Hex(body), body };
}

function readSkillFiles(skillDir: string): Record<string, Uint8Array> {
  const files: Record<string, Uint8Array> = {};
  const walk = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new AgentSourceError("skill 不能包含链接");
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      const relative = path.relative(skillDir, full).split(path.sep).join("/");
      files[relative] = fs.readFileSync(full);
    }
  };
  walk(skillDir);
  return files;
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
  const payload = `${JSON.stringify({ mcpServers: normalizeMcpServers(mcpServers) }, null, 2)}\n`;
  if (Buffer.byteLength(payload, "utf8") > MCP_MAX_BYTES) {
    throw new AgentSourceError("mcp.json 过大");
  }
  fs.mkdirSync(pi, { recursive: true });
  fs.writeFileSync(path.join(pi, "mcp.json"), payload, { mode: 0o600 });
}

function removeSkill(pi: string, skillName: string): void {
  if (!isSafeSkillName(skillName)) {
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
    if (match && isSafeSkillName(match[1]!)) {
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
    return normalizeMcpServers(servers as Record<string, unknown>);
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
