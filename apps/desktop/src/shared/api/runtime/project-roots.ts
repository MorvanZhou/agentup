import { DesktopApiError } from "./error";
import type { RuntimeHttp } from "./http";

export async function listProjectRoots(
  http: RuntimeHttp,
  token: string,
  userId: string,
  agentId: string,
  personal: boolean,
): Promise<string[]> {
  const payload = await http.request(`${base(personal, agentId)}${query(userId)}`, token);
  return readRoots(payload);
}

export async function addProjectRoot(
  http: RuntimeHttp,
  token: string,
  userId: string,
  agentId: string,
  personal: boolean,
  path: string,
): Promise<string[]> {
  const payload = await http.request(
    base(personal, agentId),
    token,
    { user_id: userId, path },
    "POST",
  );
  return readRoots(payload);
}

export async function removeProjectRoot(
  http: RuntimeHttp,
  token: string,
  userId: string,
  agentId: string,
  personal: boolean,
  path: string,
): Promise<string[]> {
  const params = new URLSearchParams({ user_id: userId, path });
  const payload = await http.request(
    `${base(personal, agentId)}?${params.toString()}`,
    token,
    undefined,
    "DELETE",
  );
  return readRoots(payload);
}

function base(personal: boolean, agentId: string): string {
  // 群工作区传 `group:<groupId>`：与 workspace.ts 同一套前缀约定
  if (agentId.startsWith("group:")) {
    return `/groups/${encodeURIComponent(agentId.slice("group:".length))}/project-roots`;
  }
  return personal
    ? "/personal-assistant/project-roots"
    : `/agents/${encodeURIComponent(agentId)}/project-roots`;
}

function query(userId: string): string {
  return `?${new URLSearchParams({ user_id: userId }).toString()}`;
}

function readRoots(payload: Record<string, unknown>): string[] {
  if (!Array.isArray(payload.roots)) throw new DesktopApiError("项目目录列表无效");
  return payload.roots.filter((item): item is string => typeof item === "string" && item.length > 0);
}
