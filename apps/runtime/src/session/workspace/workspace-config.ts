import fs from "node:fs";
import path from "node:path";

/** 工作区根下平台保留目录（侧栏隐藏；Agent 仍可读写其中文件）。 */
export const AGENTUP_DIR = ".agentup";

export const WORKSPACE_CONFIG_FILE = "workspace.json";

/** 相对工作区根的统一配置路径。 */
export const WORKSPACE_CONFIG_RELATIVE = `${AGENTUP_DIR}/${WORKSPACE_CONFIG_FILE}`;

export type PreviewRecipe = {
  id: string;
  title: string;
  command: string;
  cwd: string;
  preview_url: string;
  linked_job_id?: string | null;
  /** 人侧上次启动后，preview_url 端口上的 LISTEN pid（冲突检测用）。 */
  linked_pid?: number | null;
  /** 人侧选择后，会话顶栏常驻「启动预览」。 */
  header_pinned?: boolean;
};

export type WorkspaceConfig = {
  version: number;
  preview?: {
    recipes?: PreviewRecipe[];
  };
};

export function workspaceConfigPath(workspaceRoot: string): string {
  return path.join(workspaceRoot, AGENTUP_DIR, WORKSPACE_CONFIG_FILE);
}

/** 宽松解析；缺段回落为空配置形状。无效 recipe 条目丢弃。 */
export function parseWorkspaceConfig(raw: unknown): WorkspaceConfig | null {
  if (raw == null) return { version: 1 };
  if (typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as { version?: unknown; preview?: unknown };
  const version =
    typeof record.version === "number" && Number.isFinite(record.version) && record.version >= 1
      ? Math.floor(record.version)
      : 1;
  const previewRaw =
    record.preview && typeof record.preview === "object" && !Array.isArray(record.preview)
      ? (record.preview as { recipes?: unknown })
      : undefined;
  const recipes: PreviewRecipe[] = [];
  if (Array.isArray(previewRaw?.recipes)) {
    for (const item of previewRaw.recipes) {
      const recipe = parsePreviewRecipe(item);
      if (recipe) recipes.push(recipe);
    }
  }
  const config: WorkspaceConfig = { version };
  if (previewRaw) config.preview = { recipes };
  return config;
}

export function hasPreviewRecipes(config: WorkspaceConfig | null | undefined): boolean {
  return (config?.preview?.recipes?.length ?? 0) > 0;
}

export function readWorkspaceConfig(workspaceRoot: string): WorkspaceConfig | null {
  const file = workspaceConfigPath(workspaceRoot);
  if (!fs.existsSync(file)) return null;
  try {
    const text = fs.readFileSync(file, "utf8");
    return parseWorkspaceConfig(JSON.parse(text) as unknown);
  } catch {
    return null;
  }
}

/** 按 id 合并一条 recipe；其余顶层键尽量保留。 */
export function upsertPreviewRecipe(workspaceRoot: string, recipe: PreviewRecipe): WorkspaceConfig {
  const file = workspaceConfigPath(workspaceRoot);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let existing: Record<string, unknown> = { version: 1 };
  if (fs.existsSync(file)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        existing = { ...(parsed as Record<string, unknown>) };
      }
    } catch {
      existing = { version: 1 };
    }
  }
  const normalized = parseWorkspaceConfig(existing) ?? { version: 1 };
  const current = [...(normalized.preview?.recipes ?? [])];
  const nextRecipe = normalizeRecipe(recipe);
  const index = current.findIndex((item) => item.id === nextRecipe.id);
  if (index >= 0) current[index] = nextRecipe;
  else current.push(nextRecipe);
  const next: WorkspaceConfig = {
    ...normalized,
    version: normalized.version || 1,
    preview: { recipes: current },
  };
  const serialized = {
    ...existing,
    version: next.version,
    preview: { ...(typeof existing.preview === "object" && existing.preview ? existing.preview : {}), recipes: current },
  };
  fs.writeFileSync(file, `${JSON.stringify(serialized, null, 2)}\n`, "utf8");
  return next;
}

/** 清空预览关联 job / pid（关窗后）；保留 recipe 本体。 */
export function clearRecipeLinkedJob(workspaceRoot: string, recipeId: string): WorkspaceConfig | null {
  const config = readWorkspaceConfig(workspaceRoot);
  const recipes = config?.preview?.recipes;
  if (!recipes?.length) return config;
  const target = recipes.find((item) => item.id === recipeId);
  if (!target || (target.linked_job_id == null && target.linked_pid == null)) return config;
  return upsertPreviewRecipe(workspaceRoot, {
    ...target,
    linked_job_id: null,
    linked_pid: null,
  });
}

/** 顶栏常驻开关：写入 recipe.header_pinned。 */
export function setRecipeHeaderPinned(
  workspaceRoot: string,
  recipeId: string,
  pinned: boolean,
): WorkspaceConfig {
  const config = readWorkspaceConfig(workspaceRoot);
  const target = config?.preview?.recipes?.find((item) => item.id === recipeId);
  if (!target) throw new Error("preview recipe not found");
  const next: PreviewRecipe = { ...target };
  if (pinned) next.header_pinned = true;
  else delete next.header_pinned;
  return upsertPreviewRecipe(workspaceRoot, next);
}

/**
 * 从 workspace.json 删除一条 recipe；若已无 recipes 则去掉 preview 段。
 * 返回被删 recipe（调用方可用于停 job）。
 */
export function removePreviewRecipe(
  workspaceRoot: string,
  recipeId: string,
): { config: WorkspaceConfig | null; removed: PreviewRecipe | null } {
  const file = workspaceConfigPath(workspaceRoot);
  if (!fs.existsSync(file)) return { config: null, removed: null };
  let existing: Record<string, unknown> = { version: 1 };
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      existing = { ...(parsed as Record<string, unknown>) };
    }
  } catch {
    return { config: null, removed: null };
  }
  const normalized = parseWorkspaceConfig(existing) ?? { version: 1 };
  const current = [...(normalized.preview?.recipes ?? [])];
  const index = current.findIndex((item) => item.id === recipeId);
  if (index < 0) return { config: normalized, removed: null };
  const [removed] = current.splice(index, 1);
  const next: WorkspaceConfig = { ...normalized, version: normalized.version || 1 };
  if (current.length > 0) next.preview = { recipes: current };
  else delete next.preview;
  if (current.length > 0) {
    const serialized = {
      ...existing,
      version: next.version,
      preview: {
        ...(typeof existing.preview === "object" && existing.preview ? existing.preview : {}),
        recipes: current,
      },
    };
    fs.writeFileSync(file, `${JSON.stringify(serialized, null, 2)}\n`, "utf8");
  } else if (Object.keys(existing).filter((key) => key !== "preview" && key !== "version").length === 0) {
    // 仅剩空配置：删掉文件，避免空壳 workspace.json
    try {
      fs.unlinkSync(file);
    } catch {
      fs.writeFileSync(file, `${JSON.stringify({ version: next.version }, null, 2)}\n`, "utf8");
    }
  } else {
    const { preview: _drop, ...rest } = existing;
    const serialized = { ...rest, version: next.version };
    fs.writeFileSync(file, `${JSON.stringify(serialized, null, 2)}\n`, "utf8");
  }
  return { config: next, removed: removed ?? null };
}

/** 清工作区时删除整个 `.agentup/`（含 workspace.json）。 */
export function removeAgentupWorkspaceConfig(workspaceRoot: string): void {
  const dir = path.join(workspaceRoot, AGENTUP_DIR);
  if (!fs.existsSync(dir)) return;
  fs.rmSync(dir, { recursive: true, force: true });
}

function parsePreviewRecipe(raw: unknown): PreviewRecipe | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const id = asNonEmptyString(record.id);
  const title = asNonEmptyString(record.title);
  const command = asNonEmptyString(record.command);
  const cwd = asNonEmptyString(record.cwd) ?? ".";
  const previewUrl = asNonEmptyString(record.preview_url);
  if (!id || !title || !command || !previewUrl) return null;
  if (!isAllowedPreviewUrl(previewUrl)) return null;
  const recipe: PreviewRecipe = {
    id,
    title,
    command,
    cwd,
    preview_url: previewUrl,
  };
  if (record.linked_job_id === null) recipe.linked_job_id = null;
  else if (typeof record.linked_job_id === "string" && record.linked_job_id.trim()) {
    recipe.linked_job_id = record.linked_job_id.trim();
  }
  if (record.linked_pid === null) recipe.linked_pid = null;
  else if (
    typeof record.linked_pid === "number" &&
    Number.isInteger(record.linked_pid) &&
    record.linked_pid > 0
  ) {
    recipe.linked_pid = record.linked_pid;
  }
  if (record.header_pinned === true) recipe.header_pinned = true;
  return recipe;
}

function normalizeRecipe(recipe: PreviewRecipe): PreviewRecipe {
  const parsed = parsePreviewRecipe(recipe);
  if (!parsed) {
    throw new Error("invalid preview recipe");
  }
  return parsed;
}

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

/** 仅允许本机预览 URL（http(s) + localhost / 127.0.0.1 / [::1]）。 */
export function isAllowedPreviewUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  const host = parsed.hostname.toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1";
}
