import type { RuntimeHttp } from "./http";

export type PreviewRecipeDto = {
  id: string;
  title: string;
  command: string;
  cwd: string;
  preview_url: string;
  linked_job_id?: string | null;
  linked_pid?: number | null;
  header_pinned?: boolean;
};

export type PreviewStartResultDto =
  | { status: "started"; recipe: PreviewRecipeDto; jobId: string }
  | {
      status: "conflict";
      recipe: PreviewRecipeDto;
      pid: number;
      preview_url: string;
    };

function previewRoot(agentId: string, personal: boolean): string {
  if (agentId.startsWith("group:")) {
    return `/groups/${encodeURIComponent(agentId.slice("group:".length))}/preview`;
  }
  return personal
    ? "/personal-assistant/preview"
    : `/agents/${encodeURIComponent(agentId)}/preview`;
}

export async function listPreviewRecipes(
  http: RuntimeHttp,
  token: string,
  userId: string,
  agentId: string,
  personal: boolean,
): Promise<PreviewRecipeDto[]> {
  const path = `${previewRoot(agentId, personal)}/recipes?user_id=${encodeURIComponent(userId)}`;
  const raw = await http.request(path, token);
  const recipes = (raw as { recipes?: unknown }).recipes;
  if (!Array.isArray(recipes)) return [];
  return recipes.filter(isRecipeDto);
}

export async function startPreviewRecipe(
  http: RuntimeHttp,
  token: string,
  userId: string,
  agentId: string,
  personal: boolean,
  recipeId: string,
  holderAgentId?: string,
  force?: boolean,
): Promise<PreviewStartResultDto> {
  const path = `${previewRoot(agentId, personal)}/recipes/${encodeURIComponent(recipeId)}/start`;
  // RuntimeHttp.request(path, token, body, method) — 第三参是 JSON body
  const body: Record<string, unknown> = { user_id: userId };
  if (agentId.startsWith("group:") && holderAgentId) body.agent_id = holderAgentId;
  if (force) body.force = true;
  const raw = await http.request(path, token, body, "POST");
  return parseStartResult(raw);
}

export async function stopPreviewRecipe(
  http: RuntimeHttp,
  token: string,
  userId: string,
  agentId: string,
  personal: boolean,
  recipeId: string,
  holderAgentId?: string,
): Promise<PreviewRecipeDto> {
  const path = `${previewRoot(agentId, personal)}/recipes/${encodeURIComponent(recipeId)}/stop`;
  const body: Record<string, string> = { user_id: userId };
  if (agentId.startsWith("group:") && holderAgentId) body.agent_id = holderAgentId;
  const raw = await http.request(path, token, body, "POST");
  return (raw as { recipe: PreviewRecipeDto }).recipe;
}

export async function pinPreviewRecipeHeader(
  http: RuntimeHttp,
  token: string,
  userId: string,
  agentId: string,
  personal: boolean,
  recipeId: string,
  pinned: boolean,
): Promise<PreviewRecipeDto> {
  const path = `${previewRoot(agentId, personal)}/recipes/${encodeURIComponent(recipeId)}/header-pin`;
  const raw = await http.request(path, token, { user_id: userId, pinned }, "POST");
  return (raw as { recipe: PreviewRecipeDto }).recipe;
}

/** 顶栏叉掉：停 job 并删除 workspace.json 配方。 */
export async function dismissPreviewRecipe(
  http: RuntimeHttp,
  token: string,
  userId: string,
  agentId: string,
  personal: boolean,
  recipeId: string,
  holderAgentId?: string,
): Promise<PreviewRecipeDto> {
  const path = `${previewRoot(agentId, personal)}/recipes/${encodeURIComponent(recipeId)}/dismiss`;
  const body: Record<string, string> = { user_id: userId };
  if (agentId.startsWith("group:") && holderAgentId) body.agent_id = holderAgentId;
  const raw = await http.request(path, token, body, "POST");
  return (raw as { recipe: PreviewRecipeDto }).recipe;
}

function isRecipeDto(value: unknown): value is PreviewRecipeDto {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    typeof record.title === "string" &&
    typeof record.command === "string" &&
    typeof record.preview_url === "string"
  );
}

function parseStartResult(raw: Record<string, unknown>): PreviewStartResultDto {
  if (raw.status === "conflict") {
    const pid = typeof raw.pid === "number" ? raw.pid : Number(raw.pid);
    const previewUrl = typeof raw.preview_url === "string" ? raw.preview_url : "";
    if (!Number.isInteger(pid) || pid <= 0 || !previewUrl || !isRecipeDto(raw.recipe)) {
      throw new Error("预览端口冲突响应无效");
    }
    return {
      status: "conflict",
      recipe: raw.recipe,
      pid,
      preview_url: previewUrl,
    };
  }
  // 兼容旧 runtime：无 status 但有 jobId
  if (raw.status === "started" || (typeof raw.jobId === "string" && isRecipeDto(raw.recipe))) {
    const jobId = typeof raw.jobId === "string" ? raw.jobId : "";
    if (!jobId || !isRecipeDto(raw.recipe)) throw new Error("启动预览响应无效");
    return { status: "started", recipe: raw.recipe, jobId };
  }
  throw new Error("启动预览响应无效");
}
