import { parseDocument } from "yaml";

const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const USER_HEADER = "x-agentup-user-id";
const ALLOWED_ROOT_FILES = new Set(["SYSTEM.md", "AGENTS.md", "mcp.json", "settings.json"]);
const ALLOWED_ROOT_DIRS = new Set(["skills", "hooks"]);

export interface PackageIssue {
  path: string;
  message: string;
}

export type ValidatePackageOptions = {
  /**
   * 发布源（`.agentup`）可不带 SYSTEM.md：身份由发布表单 compose。
   * 上传/投影包默认仍要求非空 SYSTEM.md。
   */
  requireSystemMd?: boolean;
};

export function validateAgentPackage(
  files: Record<string, Uint8Array>,
  options: ValidatePackageOptions = {},
): PackageIssue[] {
  const requireSystemMd = options.requireSystemMd !== false;
  const issues: PackageIssue[] = [];
  validatePaths(files, issues);
  const system = files["SYSTEM.md"];
  if (!system) {
    if (requireSystemMd) {
      issues.push(issue("SYSTEM.md", "运行包缺少必备文件 SYSTEM.md"));
    }
  } else {
    const text = decodeText("SYSTEM.md", system, issues);
    if (text !== undefined && !text.trim()) issues.push(issue("SYSTEM.md", "SYSTEM.md 不能为空"));
  }
  if (files["APPEND_SYSTEM.md"]) {
    issues.push(issue("APPEND_SYSTEM.md", "不再支持 APPEND_SYSTEM.md，请迁移为 SYSTEM.md"));
  }
  const agents = files["AGENTS.md"];
  if (agents) {
    const text = decodeText("AGENTS.md", agents, issues);
    if (text !== undefined && !text.trim()) issues.push(issue("AGENTS.md", "AGENTS.md 不能为空"));
  }
  validateSkills(files, issues);
  validateMcp(files["mcp.json"], issues);
  validateSettingsAndHooks(files, issues);
  return issues;
}

function validatePaths(files: Record<string, Uint8Array>, issues: PackageIssue[]): void {
  let reportedRules = false;
  for (const filePath of Object.keys(files)) {
    const parts = filePath.split("/");
    if (
      !filePath ||
      filePath.endsWith("/") ||
      filePath.includes("\\") ||
      filePath.startsWith("/") ||
      parts.includes("..") ||
      parts.includes(".") ||
      parts.includes("") ||
      filePath === "agent.yaml" ||
      parts[0] === ".pi"
    ) {
      issues.push(issue(filePath || "(空路径)", `非法路径: ${filePath}`));
      continue;
    }
    const root = parts[0]!;
    if (root === "rules") {
      if (!reportedRules) {
        issues.push(issue("rules/", "不再支持 rules/，请迁移为根目录 AGENTS.md"));
        reportedRules = true;
      }
      continue;
    }
    if (parts.length === 1) {
      // APPEND_SYSTEM.md 有专用迁移提示，不重复报「不允许的顶层文件」。
      if (!ALLOWED_ROOT_FILES.has(root) && root !== "APPEND_SYSTEM.md") {
        issues.push(issue(filePath, `不允许的顶层文件: ${filePath}`));
      }
      continue;
    }
    if (!ALLOWED_ROOT_DIRS.has(root)) {
      issues.push(issue(filePath, `不允许的顶层目录: ${root}/`));
    }
  }
}

function validateSkills(files: Record<string, Uint8Array>, issues: PackageIssue[]): void {
  const skillPaths = Object.keys(files).filter((filePath) => filePath.startsWith("skills/"));
  const directories = new Set<string>();
  for (const filePath of skillPaths) {
    const parts = filePath.split("/");
    if (parts.length < 3 || !parts[1]) {
      issues.push(issue(filePath, "skills/ 下的文件必须放在具体技能目录中"));
      continue;
    }
    directories.add(parts[1]);
  }
  for (const directory of [...directories].sort()) {
    const filePath = `skills/${directory}/SKILL.md`;
    const content = files[filePath];
    if (!content) {
      issues.push(issue(filePath, "每个技能目录都必须包含 SKILL.md"));
      continue;
    }
    const text = decodeText(filePath, content, issues);
    if (text === undefined) continue;
    const frontmatter = parseFrontmatter(filePath, text, issues);
    if (!frontmatter) continue;
    const name = frontmatter.name;
    const description = frontmatter.description;
    if (typeof name !== "string" || !SKILL_NAME.test(name) || name.length > 64) {
      issues.push(issue(filePath, "name 必须是 1–64 位小写字母、数字或单连字符"));
    } else if (name !== directory) {
      issues.push(issue(filePath, `name 必须与父目录 ${directory} 一致`));
    }
    if (typeof description !== "string" || !description.trim() || description.length > 1024) {
      issues.push(issue(filePath, "description 必须是 1–1024 字符的非空文本"));
    }
    optionalString(frontmatter, "license", filePath, issues);
    optionalString(frontmatter, "allowed-tools", filePath, issues);
    optionalBoundedString(frontmatter, "compatibility", 500, filePath, issues);
    if (frontmatter.metadata !== undefined && !stringRecord(frontmatter.metadata)) {
      issues.push(issue(filePath, "metadata 必须是字符串到字符串的映射"));
    }
  }
}

function validateMcp(content: Uint8Array | undefined, issues: PackageIssue[]): void {
  if (!content) return;
  const parsed = parseJsonObject("mcp.json", content, issues);
  if (!parsed) return;
  const servers = parsed.mcpServers;
  if (!record(servers)) {
    issues.push(issue("mcp.json", "mcpServers 必须是对象"));
    return;
  }
  for (const [serverName, value] of Object.entries(servers)) {
    const prefix = `mcpServers.${serverName}`;
    if (!serverName || !record(value)) {
      issues.push(issue("mcp.json", `${prefix} 必须是对象`));
      continue;
    }
    const command = value.command;
    const url = value.url;
    const hasCommand = typeof command === "string" && Boolean(command.trim());
    const hasUrl = typeof url === "string" && Boolean(url.trim());
    if (hasCommand === hasUrl) {
      issues.push(issue("mcp.json", `${prefix} 必须且只能配置 command 或 url`));
    }
    optionalStringArray(value, "args", "mcp.json", prefix, issues);
    optionalStringRecord(value, "env", "mcp.json", prefix, issues);
    optionalString(value, "envFile", "mcp.json", issues, prefix);
    optionalStringRecord(value, "headers", "mcp.json", prefix, issues);
    const headers = value.headers;
    if (record(headers) && Object.keys(headers).some((key) => key.toLowerCase() === USER_HEADER)) {
      issues.push(issue("mcp.json", `${prefix}.headers 不能写入 X-AgentUp-User-Id`));
    }
    if (value.type !== undefined && value.type !== "stdio" && value.type !== "http" && value.type !== "sse") {
      issues.push(issue("mcp.json", `${prefix}.type 不受支持`));
    }
    if (value.auth !== undefined) validateMcpAuth(value.auth, prefix, issues);
  }
}

function validateMcpAuth(value: unknown, prefix: string, issues: PackageIssue[]): void {
  if (!record(value)) {
    issues.push(issue("mcp.json", `${prefix}.auth 必须是对象`));
    return;
  }
  if (typeof value.CLIENT_ID !== "string" || !value.CLIENT_ID) {
    issues.push(issue("mcp.json", `${prefix}.auth.CLIENT_ID 必须是非空字符串`));
  }
  optionalString(value, "CLIENT_SECRET", "mcp.json", issues, `${prefix}.auth`);
  optionalStringArray(value, "scopes", "mcp.json", `${prefix}.auth`, issues);
}

function validateSettingsAndHooks(files: Record<string, Uint8Array>, issues: PackageIssue[]): void {
  const settingsContent = files["settings.json"];
  const hasHookFiles = Object.keys(files).some((filePath) => filePath.startsWith("hooks/"));
  if (!settingsContent) {
    if (hasHookFiles) issues.push(issue("settings.json", "存在 hooks/ 时必须在 settings.json 中配置 hooks"));
    return;
  }
  const settings = parseJsonObject("settings.json", settingsContent, issues);
  if (!settings) return;
  if (settings.hooks === undefined) {
    if (hasHookFiles) issues.push(issue("settings.json", "存在 hooks/ 时必须配置 hooks"));
    return;
  }
  if (!record(settings.hooks)) {
    issues.push(issue("settings.json", "hooks 必须是对象"));
    return;
  }
  for (const [eventName, groups] of Object.entries(settings.hooks)) {
    if (!Array.isArray(groups)) {
      issues.push(issue("settings.json", `hooks.${eventName} 必须是数组`));
      continue;
    }
    groups.forEach((group, groupIndex) => validateHookGroup(eventName, groupIndex, group, issues));
  }
}

function validateHookGroup(eventName: string, index: number, value: unknown, issues: PackageIssue[]): void {
  const prefix = `hooks.${eventName}[${index}]`;
  if (!record(value)) {
    issues.push(issue("settings.json", `${prefix} 必须是对象`));
    return;
  }
  if (value.matcher !== undefined) {
    if (typeof value.matcher !== "string") {
      issues.push(issue("settings.json", `${prefix}.matcher 必须是字符串`));
    } else {
      try {
        new RegExp(value.matcher === "*" ? ".*" : value.matcher);
      } catch {
        issues.push(issue("settings.json", `${prefix}.matcher 不是合法正则表达式`));
      }
    }
  }
  if (!Array.isArray(value.hooks) || value.hooks.length === 0) {
    issues.push(issue("settings.json", `${prefix}.hooks 必须是非空数组`));
    return;
  }
  value.hooks.forEach((handler, handlerIndex) =>
    validateHookHandler(`${prefix}.hooks[${handlerIndex}]`, handler, issues),
  );
}

function validateHookHandler(prefix: string, value: unknown, issues: PackageIssue[]): void {
  if (!record(value)) {
    issues.push(issue("settings.json", `${prefix} 必须是对象`));
    return;
  }
  const type = value.type ?? "command";
  if (!["command", "http", "mcp_tool", "prompt", "agent"].includes(String(type))) {
    issues.push(issue("settings.json", `${prefix}.type 不受支持`));
    return;
  }
  const requiredField: Record<string, string> = {
    command: "command",
    http: "url",
    mcp_tool: "tool",
    prompt: "prompt",
    agent: "agent",
  };
  const field = requiredField[String(type)];
  if (typeof value[field] !== "string" || !String(value[field]).trim()) {
    issues.push(issue("settings.json", `${prefix}.${field} 必须是非空字符串`));
  }
  if (value.timeout !== undefined && (typeof value.timeout !== "number" || value.timeout <= 0)) {
    issues.push(issue("settings.json", `${prefix}.timeout 必须是正数`));
  }
}

function parseFrontmatter(
  filePath: string,
  text: string,
  issues: PackageIssue[],
): Record<string, unknown> | undefined {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/.exec(text);
  if (!match) {
    issues.push(issue(filePath, "文件必须包含 YAML frontmatter"));
    return undefined;
  }
  if (!match[2].trim()) issues.push(issue(filePath, "Markdown 正文不能为空"));
  const document = parseDocument(match[1], { uniqueKeys: true });
  if (document.errors.length > 0) {
    issues.push(issue(filePath, `YAML frontmatter 无效: ${document.errors[0].message}`));
    return undefined;
  }
  const value = document.toJS() as unknown;
  if (!record(value)) {
    issues.push(issue(filePath, "YAML frontmatter 必须是对象"));
    return undefined;
  }
  return value;
}

function parseJsonObject(
  filePath: string,
  content: Uint8Array,
  issues: PackageIssue[],
): Record<string, unknown> | undefined {
  const text = decodeText(filePath, content, issues);
  if (text === undefined) return undefined;
  try {
    const value = JSON.parse(text) as unknown;
    if (!record(value)) throw new Error();
    return value;
  } catch {
    issues.push(issue(filePath, `${filePath} 不是合法 JSON 对象`));
    return undefined;
  }
}

function decodeText(filePath: string, content: Uint8Array, issues: PackageIssue[]): string | undefined {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(content);
  } catch {
    issues.push(issue(filePath, "文件必须使用 UTF-8 编码"));
    return undefined;
  }
}

function optionalString(
  value: Record<string, unknown>,
  field: string,
  filePath: string,
  issues: PackageIssue[],
  prefix = "",
): void {
  if (value[field] !== undefined && typeof value[field] !== "string") {
    issues.push(issue(filePath, `${prefix ? `${prefix}.` : ""}${field} 必须是字符串`));
  }
}

function optionalBoundedString(
  value: Record<string, unknown>,
  field: string,
  max: number,
  filePath: string,
  issues: PackageIssue[],
): void {
  if (
    value[field] !== undefined &&
    (typeof value[field] !== "string" || !value[field].trim() || value[field].length > max)
  ) {
    issues.push(issue(filePath, `${field} 必须是 1–${max} 字符的字符串`));
  }
}

function optionalStringArray(
  value: Record<string, unknown>,
  field: string,
  filePath: string,
  prefix: string,
  issues: PackageIssue[],
): void {
  if (value[field] !== undefined && (!Array.isArray(value[field]) || !value[field].every((item) => typeof item === "string"))) {
    issues.push(issue(filePath, `${prefix}.${field} 必须是字符串数组`));
  }
}

function optionalStringRecord(
  value: Record<string, unknown>,
  field: string,
  filePath: string,
  prefix: string,
  issues: PackageIssue[],
): void {
  if (value[field] !== undefined && !stringRecord(value[field])) {
    issues.push(issue(filePath, `${prefix}.${field} 必须是字符串映射`));
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringRecord(value: unknown): boolean {
  return record(value) && Object.values(value).every((item) => typeof item === "string");
}

function issue(path: string, message: string): PackageIssue {
  return { path, message };
}
