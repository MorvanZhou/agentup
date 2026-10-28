import { DesktopApiError } from "./error";
import type { RuntimeHttp } from "./http";

export interface WorkspaceEntry {
  name: string;
  kind: "file" | "dir";
  size: number;
}

export type WorkspaceFile =
  | { path: string; kind: "text"; size: number; text: string }
  | { path: string; kind: "image"; size: number; mediaType: string; dataBase64: string }
  | { path: string; kind: "binary"; size: number }
  | { path: string; kind: "too-large"; size: number; media: "text" | "image" };

/** scope=project 时须带已挂载的项目根绝对路径。 */
export type WorkspaceScope = { scope?: "cwd"; root?: string } | { scope: "project"; root: string };

export async function listWorkspace(
  http: RuntimeHttp,
  token: string,
  userId: string,
  agentId: string,
  personal: boolean,
  directory: string,
  workspaceScope?: WorkspaceScope,
): Promise<{ path: string; entries: WorkspaceEntry[] }> {
  const payload = await http.request(
    `${base(personal, agentId)}${query(userId, directory, workspaceScope)}`,
    token,
  );
  if (typeof payload.path !== "string" || !Array.isArray(payload.entries)) {
    throw new DesktopApiError("目录无效");
  }
  return {
    path: payload.path,
    entries: payload.entries.map(readEntry),
  };
}

export async function readWorkspaceFile(
  http: RuntimeHttp,
  token: string,
  userId: string,
  agentId: string,
  personal: boolean,
  filePath: string,
  workspaceScope?: WorkspaceScope,
): Promise<WorkspaceFile> {
  const payload = await http.request(
    `${base(personal, agentId)}/file${query(userId, filePath, workspaceScope)}`,
    token,
  );
  return readFile(payload);
}

export async function writeWorkspaceText(
  http: RuntimeHttp,
  token: string,
  userId: string,
  agentId: string,
  personal: boolean,
  filePath: string,
  text: string,
  workspaceScope?: WorkspaceScope,
): Promise<void> {
  await http.request(
    `${base(personal, agentId)}/file`,
    token,
    { user_id: userId, path: filePath, text, ...scopeBody(workspaceScope) },
    "PUT",
  );
}

export async function createWorkspaceEntry(
  http: RuntimeHttp,
  token: string,
  userId: string,
  agentId: string,
  personal: boolean,
  filePath: string,
  kind: "file" | "dir",
  workspaceScope?: WorkspaceScope,
): Promise<void> {
  await http.request(
    base(personal, agentId),
    token,
    { user_id: userId, path: filePath, kind, ...scopeBody(workspaceScope) },
    "POST",
  );
}

export async function renameWorkspaceEntry(
  http: RuntimeHttp,
  token: string,
  userId: string,
  agentId: string,
  personal: boolean,
  filePath: string,
  name: string,
  workspaceScope?: WorkspaceScope,
): Promise<string> {
  const payload = await http.request(
    `${base(personal, agentId)}/rename`,
    token,
    { user_id: userId, path: filePath, name, ...scopeBody(workspaceScope) },
    "POST",
  );
  if (typeof payload.path !== "string") throw new DesktopApiError("重命名结果无效");
  return payload.path;
}

export async function deleteWorkspaceEntry(
  http: RuntimeHttp,
  token: string,
  userId: string,
  agentId: string,
  personal: boolean,
  filePath: string,
  workspaceScope?: WorkspaceScope,
): Promise<void> {
  await http.request(
    `${base(personal, agentId)}${query(userId, filePath, workspaceScope)}`,
    token,
    undefined,
    "DELETE",
  );
}

export async function resolveWorkspaceAbsolute(
  http: RuntimeHttp,
  token: string,
  userId: string,
  agentId: string,
  personal: boolean,
  filePath: string,
  workspaceScope?: WorkspaceScope,
): Promise<string> {
  const payload = await http.request(
    `${base(personal, agentId)}/absolute${query(userId, filePath, workspaceScope)}`,
    token,
  );
  if (typeof payload.path !== "string" || !payload.path) throw new DesktopApiError("本机路径无效");
  return payload.path;
}

function base(personal: boolean, agentId: string): string {
  if (agentId.startsWith("group:")) {
    return `/groups/${encodeURIComponent(agentId.slice("group:".length))}/workspace`;
  }
  return personal ? "/personal-assistant/workspace" : `/agents/${encodeURIComponent(agentId)}/workspace`;
}

function query(userId: string, filePath: string, workspaceScope?: WorkspaceScope): string {
  const params = new URLSearchParams({ user_id: userId });
  if (filePath) params.set("path", filePath);
  if (workspaceScope?.scope === "project" && workspaceScope.root) {
    params.set("scope", "project");
    params.set("root", workspaceScope.root);
  }
  return `?${params.toString()}`;
}

function scopeBody(workspaceScope?: WorkspaceScope): Record<string, string> {
  if (workspaceScope?.scope === "project" && workspaceScope.root) {
    return { scope: "project", root: workspaceScope.root };
  }
  return {};
}

function readEntry(value: unknown): WorkspaceEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new DesktopApiError("目录无效");
  const entry = value as Record<string, unknown>;
  if (typeof entry.name !== "string" || (entry.kind !== "file" && entry.kind !== "dir")) {
    throw new DesktopApiError("目录无效");
  }
  return {
    name: entry.name,
    kind: entry.kind,
    size: typeof entry.size === "number" ? entry.size : 0,
  };
}

function readFile(payload: Record<string, unknown>): WorkspaceFile {
  if (typeof payload.path !== "string" || typeof payload.size !== "number") throw new DesktopApiError("文件无效");
  if (payload.kind === "text" && typeof payload.text === "string") {
    return { path: payload.path, kind: "text", size: payload.size, text: payload.text };
  }
  if (
    payload.kind === "image" &&
    typeof payload.media_type === "string" &&
    typeof payload.data_base64 === "string"
  ) {
    return {
      path: payload.path,
      kind: "image",
      size: payload.size,
      mediaType: payload.media_type,
      dataBase64: payload.data_base64,
    };
  }
  if (payload.kind === "binary") return { path: payload.path, kind: "binary", size: payload.size };
  if (payload.kind === "too-large" && (payload.media === "text" || payload.media === "image")) {
    return { path: payload.path, kind: "too-large", size: payload.size, media: payload.media };
  }
  throw new DesktopApiError("文件无效");
}
