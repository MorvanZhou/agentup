import fs from "node:fs";
import path from "node:path";

import { ATTACHMENTS_DIR, ensureCwdLayout, HIDDEN_WORKSPACE_TOP_LEVEL } from "../session/workspace/cwd-layout.js";
import {
  IMAGE_PREVIEW_LIMIT,
  TEXT_EXTENSIONS,
  TEXT_PREVIEW_LIMIT,
  TEXT_SNIFF_BYTES,
  imageMediaTypeForExtension,
} from "../session/workspace/media.js";
import { isInside as isPathInside, readProjectRoots } from "../session/workspace/project-roots.js";
import { ensurePersonalAssistant } from "./assistant/personal-assistant.js";
import { isLocalAgentId, localAgentRoot } from "./agents/local-agent.js";
import { ensureGroupWorkspace, groupDirPath } from "../session/group/workspace.js";

export { IMAGE_PREVIEW_LIMIT, TEXT_PREVIEW_LIMIT };

const AGENT_ID = /^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/;

export class WorkspaceError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export interface WorkspaceEntry {
  name: string;
  kind: "file" | "dir";
  size: number;
}

export type WorkspaceFile =
  | { path: string; kind: "text"; size: number; text: string }
  | { path: string; kind: "image"; size: number; media_type: string; data_base64: string }
  | { path: string; kind: "binary"; size: number }
  | { path: string; kind: "too-large"; size: number; media: "text" | "image" };

/** 空字符串表示 cwd 根。拒绝绝对路径、`..`、顶层 `.pi` 与 `WORK`。 */
export function normalizeRelative(
  input: string,
  hiddenTopLevel: ReadonlySet<string> = HIDDEN_WORKSPACE_TOP_LEVEL,
): string {
  if (input.includes("\0") || input.includes("\\") || input.startsWith("/")) {
    throw new WorkspaceError("路径无效", 400);
  }
  const parts = input.split("/").filter((part) => part.length > 0);
  if (parts.some((part) => part === "." || part === "..")) throw new WorkspaceError("路径无效", 400);
  if (parts[0] && hiddenTopLevel.has(parts[0])) throw new WorkspaceError("路径无效", 400);
  return parts.join("/");
}

export function agentWorkspaceCwd(userDataRoot: string, userId: string, agentId: string): string {
  assertUserId(userId);
  if (!AGENT_ID.test(agentId)) throw new WorkspaceError("agent_id 无效", 400);
  const agentsRoot = path.resolve(userDataRoot, "users", userId, "agents");
  const cwd = path.resolve(agentsRoot, agentId, "cwd");
  if (!isInside(agentsRoot, cwd)) throw new WorkspaceError("请求无效", 400);
  assertCwd(cwd);
  return cwd;
}

export function personalWorkspaceCwd(userDataRoot: string, userId: string): string {
  assertUserId(userId);
  const cwd = path.join(ensurePersonalAssistant(userDataRoot, userId), "cwd");
  assertCwd(cwd);
  return cwd;
}

type WorkspaceRootOptions = {
  ensureLayout?: boolean;
  hiddenTopLevel?: ReadonlySet<string>;
  readOnlyTopLevel?: ReadonlySet<string>;
};

export function listWorkspace(
  cwd: string,
  relative: string,
  options?: WorkspaceRootOptions,
): { path: string; entries: WorkspaceEntry[] } {
  const located = locate(cwd, relative, options);
  if (!located.exists) throw new WorkspaceError("找不到文件", 404);
  if (!fs.statSync(located.real).isDirectory()) throw new WorkspaceError("不是目录", 400);
  const root = cwdReal(cwd, options);
  const names = fs.readdirSync(located.real);
  const entries: WorkspaceEntry[] = [];
  for (const name of names) {
    if (located.relative === "" && (options?.hiddenTopLevel ?? HIDDEN_WORKSPACE_TOP_LEVEL).has(name)) continue;
    const child = path.join(located.real, name);
    const stat = lstat(child);
    if (!stat) continue;
    if (stat.isSymbolicLink()) {
      const real = realOrUndefined(child);
      if (!real || !isInside(root, real)) continue;
      const followed = fs.statSync(real);
      if (followed.isDirectory()) entries.push({ name, kind: "dir", size: 0 });
      else if (followed.isFile()) entries.push({ name, kind: "file", size: followed.size });
      continue;
    }
    if (stat.isDirectory()) entries.push({ name, kind: "dir", size: 0 });
    else if (stat.isFile()) entries.push({ name, kind: "file", size: stat.size });
  }
  entries.sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === "dir" ? -1 : 1;
    return left.name.localeCompare(right.name, "zh");
  });
  return { path: located.relative, entries };
}

export function readWorkspaceFile(
  cwd: string,
  relative: string,
  options?: WorkspaceRootOptions,
): WorkspaceFile {
  const located = locate(cwd, relative, options);
  if (!located.relative) throw new WorkspaceError("不是文件", 400);
  if (!located.exists) throw new WorkspaceError("找不到文件", 404);
  if (!fs.statSync(located.real).isFile()) throw new WorkspaceError("不是文件", 400);
  const size = fs.statSync(located.real).size;
  const name = path.basename(located.relative);
  const ext = path.extname(name).toLowerCase();
  const mediaType = imageMediaTypeForExtension(ext);
  if (mediaType) {
    if (size > IMAGE_PREVIEW_LIMIT) return { path: located.relative, kind: "too-large", size, media: "image" };
    return {
      path: located.relative,
      kind: "image",
      size,
      media_type: mediaType,
      data_base64: fs.readFileSync(located.real).toString("base64"),
    };
  }
  const textLike = TEXT_EXTENSIONS.has(ext) || ext === "" || sniffText(located.real, size);
  if (!textLike) return { path: located.relative, kind: "binary", size };
  if (size > TEXT_PREVIEW_LIMIT) return { path: located.relative, kind: "too-large", size, media: "text" };
  return { path: located.relative, kind: "text", size, text: fs.readFileSync(located.real, "utf8") };
}

export function writeWorkspaceText(
  cwd: string,
  relative: string,
  text: string,
  options?: WorkspaceRootOptions,
): { path: string; size: number } {
  if (Buffer.byteLength(text, "utf8") > TEXT_PREVIEW_LIMIT) throw new WorkspaceError("文件过大，无法保存", 413);
  const located = locate(cwd, relative, options);
  assertWritable(located.relative, options);
  if (!located.relative || !located.exists) throw new WorkspaceError("找不到文件", 404);
  if (!fs.statSync(located.real).isFile()) throw new WorkspaceError("不是文件", 400);
  fs.writeFileSync(located.real, text, "utf8");
  return { path: located.relative, size: Buffer.byteLength(text, "utf8") };
}

export function createWorkspaceEntry(
  cwd: string,
  relative: string,
  kind: "file" | "dir",
  options?: WorkspaceRootOptions,
): { path: string } {
  const rel = normalizeRelative(relative, options?.hiddenTopLevel ?? HIDDEN_WORKSPACE_TOP_LEVEL);
  assertWritable(rel, options);
  if (!rel) throw new WorkspaceError("名称无效", 400);
  const parent = parentRelative(rel);
  assertEntryName(path.basename(rel), parent, options);
  const located = locate(cwd, rel, { allowMissing: true, ...options });
  if (located.exists) throw new WorkspaceError("已经存在", 409);
  if (kind === "dir") fs.mkdirSync(located.lexical);
  else fs.writeFileSync(located.lexical, "");
  return { path: rel };
}

export function renameWorkspaceEntry(
  cwd: string,
  relative: string,
  name: string,
  options?: WorkspaceRootOptions,
): { path: string } {
  const located = locate(cwd, relative, options);
  assertWritable(located.relative, options);
  if (!located.relative || !located.exists) throw new WorkspaceError("找不到文件", 404);
  const parent = parentRelative(located.relative);
  const nextName = assertEntryName(name, parent, options);
  const nextRelative = parent ? `${parent}/${nextName}` : nextName;
  if (nextRelative === located.relative) return { path: located.relative };
  const destination = locate(cwd, nextRelative, { allowMissing: true, ...options });
  if (destination.exists) throw new WorkspaceError("已经存在", 409);
  fs.renameSync(located.lexical, destination.lexical);
  return { path: nextRelative };
}

export function deleteWorkspaceEntry(
  cwd: string,
  relative: string,
  options?: WorkspaceRootOptions,
): void {
  const located = locate(cwd, relative, options);
  assertWritable(located.relative, options);
  if (!located.relative) throw new WorkspaceError("不能删除工作目录", 400);
  if (!located.exists) throw new WorkspaceError("找不到文件", 404);
  const stat = lstat(located.lexical);
  if (stat?.isSymbolicLink()) {
    fs.unlinkSync(located.lexical);
    return;
  }
  fs.rmSync(located.real, { recursive: true, force: false });
}

/** 返回 cwd 内已存在条目的本机绝对路径，供桌面在 Finder 中显示。 */
export function resolveWorkspaceAbsolute(
  cwd: string,
  relative: string,
  options?: WorkspaceRootOptions,
): { path: string } {
  const located = locate(cwd, relative, options);
  if (!located.exists) throw new WorkspaceError("找不到文件", 404);
  return { path: located.real };
}

interface Located {
  relative: string;
  lexical: string;
  real: string;
  exists: boolean;
}

function locate(
  cwd: string,
  relative: string,
  options?: WorkspaceRootOptions & { allowMissing?: boolean },
): Located {
  const rel = normalizeRelative(relative, options?.hiddenTopLevel ?? HIDDEN_WORKSPACE_TOP_LEVEL);
  const root = cwdReal(cwd, { ensureLayout: options?.ensureLayout });
  const lexical = rel ? path.resolve(root, rel) : root;
  if (!isInside(root, lexical)) throw new WorkspaceError("路径无效", 400);
  const stat = lstat(lexical);
  if (!stat) {
    if (!options?.allowMissing) throw new WorkspaceError("找不到文件", 404);
    const parent = path.dirname(lexical);
    const parentStat = lstat(parent);
    if (!parentStat) throw new WorkspaceError("找不到文件", 404);
    const parentReal = realOrUndefined(parent);
    if (!parentReal || !isInside(root, parentReal) || !fs.statSync(parentReal).isDirectory()) {
      throw new WorkspaceError("路径无效", 400);
    }
    return { relative: rel, lexical, real: lexical, exists: false };
  }
  const real = realOrUndefined(lexical);
  if (!real || !isInside(root, real)) throw new WorkspaceError("路径无效", 400);
  return { relative: rel, lexical, real, exists: true };
}

function assertEntryName(name: string, parentRelative: string, options?: WorkspaceRootOptions): string {
  const value = name.trim();
  if (!value || value === "." || value === ".." || /[/\\\u0000]/.test(value) || value.length > 255) {
    throw new WorkspaceError("名称无效", 400);
  }
  if (parentRelative === "" && (options?.hiddenTopLevel ?? HIDDEN_WORKSPACE_TOP_LEVEL).has(value)) {
    throw new WorkspaceError("名称无效", 400);
  }
  return value;
}

function assertWritable(relative: string, options?: WorkspaceRootOptions): void {
  const top = relative.split("/", 1)[0] ?? "";
  if (top && options?.readOnlyTopLevel?.has(top)) throw new WorkspaceError("该目录只读", 403);
}

function parentRelative(relative: string): string {
  const index = relative.lastIndexOf("/");
  return index === -1 ? "" : relative.slice(0, index);
}

function assertUserId(userId: string): void {
  if (!userId || userId === "." || userId === ".." || /[/\\\u0000]/.test(userId)) {
    throw new WorkspaceError("请求无效", 400);
  }
}

function assertCwd(cwd: string, options?: { ensureLayout?: boolean }): void {
  if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) throw new WorkspaceError("工作目录不存在", 404);
  if (options?.ensureLayout !== false) ensureCwdLayout(cwd);
}

function cwdReal(cwd: string, options?: { ensureLayout?: boolean }): string {
  assertCwd(cwd, options);
  return fs.realpathSync(cwd);
}

function isInside(root: string, target: string): boolean {
  return isPathInside(root, target);
}

function lstat(target: string): fs.Stats | undefined {
  try {
    return fs.lstatSync(target);
  } catch {
    return undefined;
  }
}

function realOrUndefined(target: string): string | undefined {
  try {
    return fs.realpathSync(target);
  } catch {
    return undefined;
  }
}

function sniffText(filePath: string, size: number): boolean {
  if (size > TEXT_SNIFF_BYTES) return false;
  const sample = fs.readFileSync(filePath);
  if (sample.includes(0)) return false;
  return Buffer.from(sample.toString("utf8"), "utf8").equals(sample);
}

const PERSONAL_WORKSPACE = /^\/personal-assistant\/workspace(?:\/(file|rename|absolute))?$/;
const AGENT_WORKSPACE = /^\/agents\/([^/]+)\/workspace(?:\/(file|rename|absolute))?$/;
const GROUP_WORKSPACE = /^\/groups\/([^/]+)\/workspace(?:\/(file|rename|absolute))?$/;

export function isWorkspacePath(pathname: string): boolean {
  return PERSONAL_WORKSPACE.test(pathname) || AGENT_WORKSPACE.test(pathname) || GROUP_WORKSPACE.test(pathname);
}

/** 读写某次出诊的 cwd（或已挂载的项目根）。调用方须已完成登录校验。 */
export function serveWorkspace(
  userDataRoot: string,
  method: string,
  pathname: string,
  searchParams: URLSearchParams,
  body: Record<string, unknown>,
): { status: number; payload: unknown } {
  const personal = pathname.match(PERSONAL_WORKSPACE);
  const agent = pathname.match(AGENT_WORKSPACE);
  const group = pathname.match(GROUP_WORKSPACE);
  const action = personal ? personal[1] : agent ? agent[2] : group ? group[2] : undefined;
  if (!personal && !agent && !group) throw new WorkspaceError("没有这个接口", 404);
  const userId = method === "GET" || method === "DELETE" ? searchParams.get("user_id") ?? "" : stringField(body, "user_id");
  const scope =
    method === "GET" || method === "DELETE"
      ? (searchParams.get("scope") ?? "cwd")
      : typeof body.scope === "string"
        ? body.scope
        : "cwd";
  const rootParam =
    method === "GET" || method === "DELETE"
      ? (searchParams.get("root") ?? "")
      : typeof body.root === "string"
        ? body.root
        : "";
  if (group) {
    const groupId = decodeURIComponent(group[1] ?? "");
    // 群内浏览已挂载的项目根：只允许群 settings.json 里登记过的目录
    if (scope === "project") {
      if (!rootParam.trim()) throw new WorkspaceError("缺少项目根路径", 400);
      const granted = readProjectRoots(groupDirPath(userDataRoot, userId, groupId), "group");
      let requested: string;
      try {
        requested = fs.realpathSync(path.resolve(rootParam.trim()));
      } catch {
        throw new WorkspaceError("项目根无效", 400);
      }
      if (!granted.includes(requested)) {
        throw new WorkspaceError("未挂载该项目目录", 403);
      }
      return serveWorkspaceAt(requested, { ensureLayout: false }, method, action, searchParams, body);
    }
    const workspace = ensureGroupWorkspace(userDataRoot, userId, groupId);
    const options: WorkspaceRootOptions = {
      ensureLayout: false,
      hiddenTopLevel: HIDDEN_WORKSPACE_TOP_LEVEL,
      readOnlyTopLevel: new Set([ATTACHMENTS_DIR]),
    };
    return serveWorkspaceAt(workspace.root, options, method, action, searchParams, body);
  }
  const agentId = personal ? undefined : decodeURIComponent(agent?.[1] ?? "");
  const visitCwd = personal
    ? personalWorkspaceCwd(userDataRoot, userId)
    : agentWorkspaceCwd(userDataRoot, userId, agentId ?? "");
  const { cwd, options } = resolveWorkspaceRoot(
    userDataRoot,
    userId,
    personal ? "personal" : "agent",
    personal ? undefined : agentId,
    visitCwd,
    scope,
    rootParam,
  );
  return serveWorkspaceAt(cwd, options, method, action, searchParams, body);
}

function serveWorkspaceAt(
  cwd: string,
  options: WorkspaceRootOptions | undefined,
  method: string,
  action: string | undefined,
  searchParams: URLSearchParams,
  body: Record<string, unknown>,
): { status: number; payload: unknown } {
  const relative = method === "GET" || method === "DELETE" ? (searchParams.get("path") ?? "") : stringField(body, "path", true);
  if (!action && method === "GET") {
    const listed = listWorkspace(cwd, relative, options);
    return { status: 200, payload: listed };
  }
  if (!action && method === "POST") {
    const kind = body.kind;
    if (kind !== "file" && kind !== "dir") throw new WorkspaceError("请求无效", 400);
    return { status: 200, payload: createWorkspaceEntry(cwd, relative, kind, options) };
  }
  if (!action && method === "DELETE") {
    deleteWorkspaceEntry(cwd, relative, options);
    return { status: 200, payload: { deleted: true } };
  }
  if (action === "file" && method === "GET") {
    return { status: 200, payload: readWorkspaceFile(cwd, relative, options) };
  }
  if (action === "file" && method === "PUT") {
    if (typeof body.text !== "string") throw new WorkspaceError("请求无效", 400);
    return { status: 200, payload: writeWorkspaceText(cwd, relative, body.text, options) };
  }
  if (action === "rename" && method === "POST") {
    return {
      status: 200,
      payload: renameWorkspaceEntry(cwd, relative, stringField(body, "name"), options),
    };
  }
  if (action === "absolute" && method === "GET") {
    return { status: 200, payload: resolveWorkspaceAbsolute(cwd, relative, options) };
  }
  throw new WorkspaceError("没有这个接口", 404);
}

function resolveWorkspaceRoot(
  userDataRoot: string,
  userId: string,
  kind: "personal" | "agent",
  agentId: string | undefined,
  visitCwd: string,
  scope: string,
  rootParam: string,
): { cwd: string; options?: WorkspaceRootOptions } {
  if (scope !== "project") {
    return { cwd: visitCwd };
  }
  if (!rootParam.trim()) throw new WorkspaceError("缺少项目根路径", 400);
  const visitRoot = kind === "personal"
    ? ensurePersonalAssistant(userDataRoot, userId)
    : resolveAgentVisitRoot(userDataRoot, userId, agentId ?? "");
  const granted = readProjectRoots(visitRoot, kind);
  let requested: string;
  try {
    requested = fs.realpathSync(path.resolve(rootParam.trim()));
  } catch {
    throw new WorkspaceError("项目根无效", 400);
  }
  if (!granted.includes(requested)) {
    throw new WorkspaceError("未挂载该项目目录", 403);
  }
  return { cwd: requested, options: { ensureLayout: false } };
}

function resolveAgentVisitRoot(userDataRoot: string, userId: string, agentId: string): string {
  if (isLocalAgentId(agentId)) return localAgentRoot(userDataRoot, userId, agentId);
  return path.resolve(userDataRoot, "users", userId, "agents", agentId);
}

function stringField(body: Record<string, unknown>, key: string, allowEmpty = false): string {
  const value = body[key];
  if (typeof value !== "string") throw new WorkspaceError("请求无效", 400);
  if (!allowEmpty && !value.trim()) throw new WorkspaceError("请求无效", 400);
  return value;
}
