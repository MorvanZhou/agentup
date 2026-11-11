/** 与 runtime `agentUpPreview` / `.agentup/workspace.json` recipe 对齐。 */

export type AgentUpPreviewRecipe = {
  id: string;
  title: string;
  command: string;
  cwd: string;
  preview_url: string;
  linked_job_id?: string | null;
  /** 人侧上次启动后端口 LISTEN pid。 */
  linked_pid?: number | null;
  /** 人侧选择后顶栏常驻「启动预览」。 */
  header_pinned?: boolean;
};

export type AgentUpPreview = {
  recipes: AgentUpPreviewRecipe[];
};

/** 从 UIMessage.metadata 读出本回合登记的预览配方。 */
export function readAgentUpPreview(metadata: unknown): AgentUpPreview | null {
  if (!metadata || typeof metadata !== "object") return null;
  const custom = (metadata as { custom?: unknown }).custom;
  const raw =
    custom && typeof custom === "object"
      ? (custom as { agentUpPreview?: unknown }).agentUpPreview
      : (metadata as { agentUpPreview?: unknown }).agentUpPreview;
  return parseAgentUpPreview(raw);
}

/**
 * 气泡脚预览卡：仅本条 message 的 metadata / present_preview parts；
 * 不回落 thread 工作区配方（无关回复不挂卡）。
 */
export function resolveMessagePreviewRecipes(
  metadata: unknown,
  parts: unknown,
): AgentUpPreview | null {
  return readAgentUpPreview(metadata) ?? previewRecipesFromParts(parts);
}

/** Pi 裸名或 SDK `mcp__agentup__present_preview`。 */
export function isPresentPreviewToolName(name: unknown): boolean {
  return name === "present_preview" || name === "mcp__agentup__present_preview";
}

/**
 * 群旧行 / SDK 回合可能未投影 agentUpPreview：从本条 present_preview 工具入参回落配方卡。
 */
export function previewRecipesFromParts(parts: unknown): AgentUpPreview | null {
  if (!Array.isArray(parts)) return null;
  const recipes: AgentUpPreviewRecipe[] = [];
  const seen = new Set<string>();
  for (const part of parts) {
    if (!part || typeof part !== "object") continue;
    const record = part as {
      type?: unknown;
      toolName?: unknown;
      input?: unknown;
      output?: unknown;
    };
    const isPresent =
      isPresentPreviewToolName(record.toolName) &&
      (record.type === "dynamic-tool" || record.type === "tool-present_preview");
    if (!isPresent) continue;
    const input =
      record.input && typeof record.input === "object"
        ? (record.input as Record<string, unknown>)
        : null;
    if (!input) continue;
    const title = typeof input.title === "string" ? input.title.trim() : "";
    const command = typeof input.command === "string" ? input.command.trim() : "";
    const previewUrl =
      typeof input.preview_url === "string" ? input.preview_url.trim() : "";
    if (!title || !command || !previewUrl) continue;
    const fromInput = typeof input.id === "string" ? input.id.trim() : "";
    const fromOutput = recipeIdFromPresentPreviewOutput(record.output);
    const id = fromInput || fromOutput || slugifyPreviewId(title || previewUrl);
    if (seen.has(id)) continue;
    seen.add(id);
    const linked =
      typeof input.linked_job_id === "string" ? input.linked_job_id.trim() : "";
    recipes.push({
      id,
      title,
      command,
      cwd: typeof input.cwd === "string" && input.cwd.trim() ? input.cwd.trim() : ".",
      preview_url: previewUrl,
      ...(linked ? { linked_job_id: linked } : {}),
    });
  }
  return recipes.length > 0 ? { recipes } : null;
}

export function parseAgentUpPreview(raw: unknown): AgentUpPreview | null {
  if (!raw || typeof raw !== "object") return null;
  const list = (raw as { recipes?: unknown }).recipes;
  if (!Array.isArray(list) || list.length === 0) return null;
  const recipes: AgentUpPreviewRecipe[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    if (
      typeof record.id !== "string" ||
      typeof record.title !== "string" ||
      typeof record.command !== "string" ||
      typeof record.preview_url !== "string"
    ) {
      continue;
    }
    recipes.push({
      id: record.id,
      title: record.title,
      command: record.command,
      cwd: typeof record.cwd === "string" && record.cwd.trim() ? record.cwd : ".",
      preview_url: record.preview_url,
      ...(record.linked_job_id === null
        ? { linked_job_id: null }
        : typeof record.linked_job_id === "string"
          ? { linked_job_id: record.linked_job_id }
          : {}),
      ...(record.header_pinned === true ? { header_pinned: true } : {}),
    });
  }
  return recipes.length > 0 ? { recipes } : null;
}

function recipeIdFromPresentPreviewOutput(output: unknown): string {
  const text =
    typeof output === "string"
      ? output
      : output && typeof output === "object" && "text" in (output as object)
        ? String((output as { text?: unknown }).text ?? "")
        : "";
  const match = text.match(/Preview recipe registered \(([^)]+)\)/);
  return match?.[1]?.trim() || "";
}

function slugifyPreviewId(input: string): string {
  const slug = input
    .toLowerCase()
    .replace(/https?:\/\//g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || "preview";
}
