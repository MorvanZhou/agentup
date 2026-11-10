import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionFactory } from "@earendil-works/pi-coding-agent";

import {
  hasPreviewRecipes,
  isAllowedPreviewUrl,
  upsertPreviewRecipe,
  type PreviewRecipe,
  type WorkspaceConfig,
} from "../workspace/workspace-config.js";

/** 会话 custom entry：本回合登记的预览 recipe（气泡脚卡）。 */
export const AGENTUP_PREVIEW_CUSTOM_TYPE = "agentup-preview";

export const PRESENT_PREVIEW_TOOL = "present_preview";

/** SDK 侧模型全名（AgentUp MCP 前缀）。 */
export const PRESENT_PREVIEW_MCP_TOOL = `mcp__agentup__${PRESENT_PREVIEW_TOOL}`;

export type AgentUpPreviewData = {
  recipes: PreviewRecipe[];
};

type PresentPreviewDetails = {
  recipe: PreviewRecipe;
  error?: string;
};

const PresentPreviewParams = Type.Object({
  id: Type.Optional(
    Type.String({
      description: "Stable recipe id (slug). Default: derived from title or preview_url host/port.",
    }),
  ),
  title: Type.String({ description: "Short label shown on the preview card." }),
  command: Type.String({
    description: "Shell command to (re)start the preview process, e.g. npm run dev.",
  }),
  cwd: Type.Optional(
    Type.String({
      description: "Working directory relative to the thread workspace root. Default: .",
    }),
  ),
  preview_url: Type.String({
    description: "Local http(s) URL the user should open (localhost / 127.0.0.1 only).",
  }),
  linked_job_id: Type.Optional(
    Type.String({
      description: "Optional bg_run job id already serving this URL.",
    }),
  ),
});

/** Pi builtin 与 SDK MCP 共用：校验入参并 upsert workspace.json。 */
export type PresentPreviewRegisterResult =
  | { ok: true; recipe: PreviewRecipe; text: string }
  | { ok: false; error: string; text: string };

export function isPresentPreviewToolName(name: unknown): boolean {
  return name === PRESENT_PREVIEW_TOOL || name === PRESENT_PREVIEW_MCP_TOOL;
}

export function registerPresentPreviewRecipe(
  workspaceRoot: string,
  params: Record<string, unknown>,
): PresentPreviewRegisterResult {
  try {
    const title = String(params.title ?? "").trim();
    const command = String(params.command ?? "").trim();
    const previewUrl = String(params.preview_url ?? "").trim();
    const cwd = String(params.cwd ?? ".").trim() || ".";
    const id = String(params.id ?? "").trim() || slugifyPreviewId(title || previewUrl);
    if (!title) throw new Error("title is required");
    if (!command) throw new Error("command is required");
    if (!isAllowedPreviewUrl(previewUrl)) {
      throw new Error("preview_url must be http(s) on localhost / 127.0.0.1");
    }
    const recipe: PreviewRecipe = {
      id,
      title,
      command,
      cwd,
      preview_url: previewUrl,
    };
    const linked = String(params.linked_job_id ?? "").trim();
    if (linked) recipe.linked_job_id = linked;
    const config = upsertPreviewRecipe(workspaceRoot, recipe);
    const saved = config.preview?.recipes?.find((item) => item.id === id) ?? recipe;
    const text =
      `Preview recipe registered (${saved.id}): ${saved.title}\n` +
      `command: ${saved.command}\n` +
      `url: ${saved.preview_url}\n` +
      `The user can start or reopen it from the recipe card / thread header.`;
    return { ok: true, recipe: saved, text };
  } catch (error) {
    const message = error instanceof Error && error.message ? error.message : "invalid preview";
    return { ok: false, error: message, text: `Error: ${message}` };
  }
}

export function parsePreviewEntryData(data: unknown): AgentUpPreviewData | undefined {
  if (!data || typeof data !== "object") return undefined;
  const list = (data as { recipes?: unknown }).recipes;
  if (!Array.isArray(list) || list.length === 0) return undefined;
  const recipes: PreviewRecipe[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const record = item as PreviewRecipe;
    if (
      typeof record.id !== "string" ||
      typeof record.title !== "string" ||
      typeof record.command !== "string" ||
      typeof record.preview_url !== "string"
    ) {
      continue;
    }
    if (!isAllowedPreviewUrl(record.preview_url)) continue;
    recipes.push({
      id: record.id.trim(),
      title: record.title.trim(),
      command: record.command.trim(),
      cwd: typeof record.cwd === "string" && record.cwd.trim() ? record.cwd.trim() : ".",
      preview_url: record.preview_url.trim(),
      ...(record.linked_job_id === null
        ? { linked_job_id: null }
        : typeof record.linked_job_id === "string" && record.linked_job_id.trim()
          ? { linked_job_id: record.linked_job_id.trim() }
          : {}),
    });
  }
  return recipes.length > 0 ? { recipes } : undefined;
}

export function slugifyPreviewId(input: string): string {
  const slug = input
    .toLowerCase()
    .replace(/https?:\/\//g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || "preview";
}

/**
 * 登记 thread 工作区 `.agentup/workspace.json` 中的 preview recipe，
 * 并在本回合助手气泡投影卡片。不启进程、不操作浏览器。
 */
export function createPresentPreviewExtension(options: { workspaceRoot: string }): ExtensionFactory {
  return (pi) => {
    let started = false;
    const presented = new Map<string, PreviewRecipe>();

    pi.registerTool(
      defineTool<typeof PresentPreviewParams, PresentPreviewDetails>({
        name: PRESENT_PREVIEW_TOOL,
        label: "Present preview",
        description:
          "Register a launch recipe so the user can open an embedded preview of a local web server. " +
          "Writes `.agentup/workspace.json` under the thread workspace. " +
          "Start the server with bg_run first when needed; do not use this instead of Playwright MCP for verification.",
        promptSnippet: "Register a user-facing preview launch recipe",
        promptGuidelines: [
          "After bg_run starts a local web server, call present_preview with the localhost URL and restart command.",
          "Static ARTIFACT HTML/Markdown/images use the file preview UI — do not call present_preview for those.",
          "Browser automation/verification uses Playwright MCP via tool_search, not this tool.",
        ],
        parameters: PresentPreviewParams,
        executionMode: "sequential",
        async execute(_toolCallId, params) {
          const result = registerPresentPreviewRecipe(
            options.workspaceRoot,
            params as Record<string, unknown>,
          );
          if (result.ok) {
            presented.set(result.recipe.id, result.recipe);
            return {
              content: [{ type: "text" as const, text: result.text }],
              details: { recipe: result.recipe },
            };
          }
          return {
            content: [{ type: "text" as const, text: result.text }],
            details: {
              recipe: {
                id: "",
                title: "",
                command: "",
                cwd: ".",
                preview_url: "",
              },
              error: result.error,
            },
          };
        },
      }),
    );

    pi.on("agent_start", () => {
      if (started) return;
      started = true;
      presented.clear();
    });

    pi.on("agent_settled", () => {
      const recipes = [...presented.values()];
      if (recipes.length === 0) {
        started = false;
        return;
      }
      const payload: AgentUpPreviewData = { recipes };
      pi.appendEntry<AgentUpPreviewData>(AGENTUP_PREVIEW_CUSTOM_TYPE, payload);
      started = false;
    });
  };
}

export function workspaceHasPreviewRecipes(config: WorkspaceConfig | null): boolean {
  return hasPreviewRecipes(config);
}
