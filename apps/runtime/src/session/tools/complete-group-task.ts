import fs from "node:fs";
import path from "node:path";

import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionFactory } from "@earendil-works/pi-coding-agent";

import type { DeliverArtifactsState } from "./deliver-artifacts.js";

/** 群内委托：确认共享工作区里属于本任务的文件，不复制到调用方私有目录。 */
export const COMPLETE_GROUP_TASK_TOOL = "complete_group_task";

/**
 * user_summary 参数说明（Pi / MCP 共用）。
 * 面向人类聊天气泡：口语、短、只写用户要知道的重点。
 */
export const USER_SUMMARY_PARAM_DESCRIPTION =
  "1–2 short spoken sentences for the human chat bubble: what they get / can do now, and any decision they need. " +
  "Plain conversational language (as if texting a teammate). " +
  "Focus on outcomes that matter to a person — e.g. “调试入口默认藏起来了，加 ?debug=1 才出现；说明文档也改好了，可以打开预览看看。” " +
  "Do NOT dump QA checklists, PASS/FAIL counts, byte sizes, SHA hashes, AC ids, § refs, or a process diary. " +
  "Empty string if nothing needs telling the user yet.";

const SHARED_ROOTS = ["WORK", "ARTIFACT"] as const;

const CompleteParams = Type.Object({
  paths: Type.Array(Type.String(), {
    description:
      "Files from THIS task under the group workspace. Use WORK/from-<name>-<task_id>/... or ARTIFACT/from-<name>-<task_id>/.... " +
      "Use [] if this task produced no shared files.",
  }),
  user_summary: Type.String({
    description: USER_SUMMARY_PARAM_DESCRIPTION,
  }),
  next_step: Type.String({
    description: "What the group should do next. Empty string if nobody needs to continue.",
  }),
});

type CompleteDetails = {
  paths: string[];
  userSummary: string;
  nextStep: string;
  error?: string;
};

/** 拼 complete_group_task 成功回文：文件清单 + User summary + Next step。 */
export function formatCompleteGroupTaskResult(input: {
  paths: readonly string[];
  userSummary: string;
  nextStep: string;
}): string {
  const files =
    input.paths.length === 0
      ? "Confirmed: no shared files for this task."
      : `Confirmed ${input.paths.length} shared file(s):\n${input.paths.map((item) => `- ${item}`).join("\n")}`;
  const user = input.userSummary.trim();
  const next = input.nextStep.trim()
    ? `Next step: ${input.nextStep.trim()}`
    : "Next step: none.";
  return user ? `${files}\nUser summary: ${user}\n${next}` : `${files}\n${next}`;
}

/** 规范化为共享 WORK/ 或 ARTIFACT/ 下的相对路径。拒绝对路径、附件目录和穿越。 */
export function normalizeGroupWorkspacePaths(paths: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of paths) {
    if (typeof raw !== "string") throw new Error("paths must be strings under WORK/ or ARTIFACT/");
    const trimmed = raw.trim().replace(/\\/g, "/").replace(/^\.?\//, "");
    if (!trimmed) throw new Error("empty path; use WORK/ or ARTIFACT/ relative paths");
    if (trimmed.includes("\0") || /\/{2,}/.test(trimmed) || path.isAbsolute(raw.trim())) {
      throw new Error(`path must stay inside the group workspace: ${raw}`);
    }
    const parts = trimmed.split("/");
    if (parts.some((part) => !part || part === "." || part === "..")) {
      throw new Error(`path must stay inside the group workspace: ${raw}`);
    }
    const root = parts[0];
    if (root !== SHARED_ROOTS[0] && root !== SHARED_ROOTS[1]) {
      throw new Error(`path must be under WORK/ or ARTIFACT/: ${raw}`);
    }
    if (parts.length < 2) throw new Error(`path must be a file under WORK/ or ARTIFACT/: ${raw}`);
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

/** 校验文件存在且为常规文件。`paths: []` 表示本任务没有共享文件。 */
export function stageGroupWorkspacePaths(workspaceRoot: string, paths: readonly string[]): { path: string; size: number }[] {
  const normalized = normalizeGroupWorkspacePaths(paths);
  const root = path.resolve(workspaceRoot);
  const staged: { path: string; size: number }[] = [];
  for (const relative of normalized) {
    const absolute = path.resolve(root, ...relative.split("/"));
    if (absolute !== root && !absolute.startsWith(`${root}${path.sep}`)) {
      throw new Error(`path must stay inside the group workspace: ${relative}`);
    }
    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(absolute);
    } catch {
      throw new Error(`missing group workspace file: ${relative}`);
    }
    if (stat.isSymbolicLink()) throw new Error(`refusing symlink: ${relative}`);
    if (!stat.isFile()) throw new Error(`not a file: ${relative}`);
    staged.push({ path: relative, size: stat.size });
  }
  return staged;
}

export function createCompleteGroupTaskExtension(options: {
  workspaceRoot: string;
  state: DeliverArtifactsState;
}): ExtensionFactory {
  const { workspaceRoot, state } = options;
  return (pi) => {
    pi.registerTool(
      defineTool<typeof CompleteParams, CompleteDetails>({
        name: COMPLETE_GROUP_TASK_TOOL,
        label: "Complete group task",
        description:
          "Confirm the shared group files this task produced, write a short human-facing outcome, and say what should happen next. " +
          "Paths are relative to the group workspace. Does not copy files into a private workspace.",
        promptSnippet: "Confirm shared files, user summary, and next step",
        promptGuidelines: [
          "Call complete_group_task before finishing a group task.",
          "Only list files under WORK/ or ARTIFACT/ that belong to this task.",
          "user_summary: short spoken lines for the human — outcome they care about, no hashes / AC counts / QA dumps; next_step is for the group.",
        ],
        parameters: CompleteParams,
        executionMode: "sequential",
        async execute(_toolCallId, params) {
          try {
            const staged = stageGroupWorkspacePaths(workspaceRoot, params.paths ?? []);
            const nextStep = typeof params.next_step === "string" ? params.next_step.trim() : "";
            const userSummary =
              typeof params.user_summary === "string" ? params.user_summary.trim() : "";
            state.staged = staged;
            state.confirmed = true;
            state.nextStep = nextStep;
            state.userSummary = userSummary;
            const paths = staged.map((item) => item.path);
            return {
              content: [
                {
                  type: "text" as const,
                  text: formatCompleteGroupTaskResult({ paths, userSummary, nextStep }),
                },
              ],
              details: { paths, userSummary, nextStep },
            };
          } catch (error) {
            const message = error instanceof Error && error.message ? error.message : "invalid paths";
            return {
              content: [{ type: "text" as const, text: `Error: ${message}` }],
              details: { paths: [], userSummary: "", nextStep: "", error: message },
            };
          }
        },
      }),
    );
  };
}
