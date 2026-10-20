import fs from "node:fs";
import path from "node:path";

import { validateAgentPackage, type PackageIssue } from "./validate.js";

const AGENT_UP_DIR = ".agentUp";
const AVATAR_EXT = new Set([".png", ".jpg", ".webp"]);
const AVATAR_MAX_BYTES = 1_048_576;

export class AgentSourceError extends Error {
  constructor(
    message: string,
    readonly details: PackageIssue[] = [],
  ) {
    super(message);
  }
}

export interface AgentPublishSource {
  files: Record<string, Uint8Array>;
  avatar?: Uint8Array;
  avatarMime?: string;
}

export function loadAgentSource(agentDir: string): AgentPublishSource {
  if (!fs.existsSync(agentDir) || !fs.statSync(agentDir).isDirectory()) {
    throw new AgentSourceError("Agent 目录不存在");
  }
  const packageRoot = path.join(agentDir, AGENT_UP_DIR);
  if (!fs.existsSync(packageRoot) || !fs.statSync(packageRoot).isDirectory()) {
    throw new AgentSourceError("运行包校验失败", [
      { path: AGENT_UP_DIR, message: "缺少 .agentUp 运行包目录" },
    ]);
  }
  const files = readPackage(packageRoot);
  const details = validateAgentPackage(files);
  const avatar = readAvatar(agentDir);
  if (avatar.issue) details.push(avatar.issue);
  if (details.length > 0) throw new AgentSourceError("运行包校验失败", details);
  return {
    files,
    ...(avatar.content
      ? { avatar: avatar.content, avatarMime: avatar.mime }
      : {}),
  };
}

function readPackage(packageRoot: string): Record<string, Uint8Array> {
  const files: Record<string, Uint8Array> = {};
  const walk = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      const relative = path.relative(packageRoot, full).split(path.sep).join("/");
      if (entry.isSymbolicLink()) throw new AgentSourceError(`不读取符号链接: ${relative}`);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      assertRelative(relative);
      files[relative] = fs.readFileSync(full);
    }
  };
  walk(packageRoot);
  return files;
}

function readAvatar(agentDir: string): {
  content?: Uint8Array;
  mime?: string;
  issue?: PackageIssue;
} {
  const assetsDir = path.join(agentDir, "assets");
  if (!fs.existsSync(assetsDir)) return {};
  if (!fs.statSync(assetsDir).isDirectory()) {
    return { issue: { path: "assets", message: "assets 必须是目录" } };
  }
  const matches: string[] = [];
  for (const entry of fs.readdirSync(assetsDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name).toLowerCase();
    const base = path.basename(entry.name, ext).toLowerCase();
    if (base === "avatar" && AVATAR_EXT.has(ext)) {
      matches.push(entry.name);
    }
  }
  if (matches.length === 0) return {};
  if (matches.length > 1) {
    return {
      issue: {
        path: "assets/avatar",
        message: "assets/ 下只允许一个 avatar.(png|jpg|webp)",
      },
    };
  }
  const name = matches[0]!;
  const relative = `assets/${name}`;
  const full = path.join(assetsDir, name);
  if (fs.lstatSync(full).isSymbolicLink()) {
    return { issue: { path: relative, message: `不读取符号链接: ${relative}` } };
  }
  const content = fs.readFileSync(full);
  if (content.byteLength === 0) {
    return { issue: { path: relative, message: "头像文件不能为空" } };
  }
  if (content.byteLength >= AVATAR_MAX_BYTES) {
    return { issue: { path: relative, message: "头像文件必须小于 1MB" } };
  }
  const ext = path.extname(name).toLowerCase();
  const mime =
    ext === ".png" ? "image/png" : ext === ".jpg" ? "image/jpeg" : "image/webp";
  return { content, mime };
}

const ALLOWED_ROOT_FILES = new Set(["SYSTEM.md", "mcp.json", "settings.json"]);
const ALLOWED_ROOT_DIRS = new Set(["skills", "rules", "hooks"]);

function assertRelative(relative: string): void {
  const parts = relative.split("/");
  if (
    !relative ||
    relative.endsWith("/") ||
    relative.includes("\\") ||
    relative.startsWith("/") ||
    parts.includes("..") ||
    parts.includes(".") ||
    relative === "agent.yaml" ||
    parts[0] === ".pi" ||
    parts[0] === AGENT_UP_DIR
  ) {
    throw new AgentSourceError(`非法路径: ${relative}`);
  }
  const root = parts[0]!;
  if (parts.length === 1) {
    // APPEND_SYSTEM.md 留给 validateAgentPackage 给出迁移提示。
    if (!ALLOWED_ROOT_FILES.has(root) && root !== "APPEND_SYSTEM.md") {
      throw new AgentSourceError(`不允许的顶层文件: ${relative}`);
    }
    return;
  }
  if (!ALLOWED_ROOT_DIRS.has(root)) {
    throw new AgentSourceError(`不允许的顶层目录: ${root}/`);
  }
}
