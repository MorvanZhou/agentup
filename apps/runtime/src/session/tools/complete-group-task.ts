import fs from "node:fs";
import path from "node:path";

import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionFactory } from "@earendil-works/pi-coding-agent";

import type { DeliverArtifactsState } from "./deliver-artifacts.js";

/** 群内委托：确认共享工作区里属于本任务的文件，不复制到调用方私有目录。 */
export const COMPLETE_GROUP_TASK_TOOL = "complete_group_task";

const SHARED_ROOTS = ["WORK", "ARTIFACT"] as const;

const CompleteParams = Type.Object({
  paths: Type.Array(Type.String(), {
    description:
      "Files from THIS task under the group workspace. Use WORK/from-<name>-<task_id>/... or ARTIFACT/from-<name>-<task_id>/.... " +
      "Use [] if this task produced no shared files.",
  }),
  next_step: Type.String({
    description: "What the group should do next. Empty string if nobody needs to continue.",
  }),
});

type CompleteDetails = {
  paths: string[];
  nextStep: string;
  error?: string;
};

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
          "Confirm the shared group files this task produced and say what should happen next. " +
          "Paths are relative to the group workspace. Does not copy files into a private workspace.",
        promptSnippet: "Confirm shared group files and the next step",
        promptGuidelines: [
          "Call complete_group_task before finishing a group task.",
          "Only list files under WORK/ or ARTIFACT/ that belong to this task.",
        ],
        parameters: CompleteParams,
        executionMode: "sequential",
        async execute(_toolCallId, params) {
          try {
            const staged = stageGroupWorkspacePaths(workspaceRoot, params.paths ?? []);
            const nextStep = typeof params.next_step === "string" ? params.next_step.trim() : "";
            state.staged = staged;
            state.confirmed = true;
            const files =
              staged.length === 0
                ? "Confirmed: no shared files for this task."
                : `Confirmed ${staged.length} shared file(s):\n${staged.map((item) => `- ${item.path}`).join("\n")}`;
            const next = nextStep ? `Next step: ${nextStep}` : "Next step: none.";
            return {
              content: [{ type: "text" as const, text: `${files}\n${next}` }],
              details: { paths: staged.map((item) => item.path), nextStep },
            };
          } catch (error) {
            const message = error instanceof Error && error.message ? error.message : "invalid paths";
            return {
              content: [{ type: "text" as const, text: `Error: ${message}` }],
              details: { paths: [], nextStep: "", error: message },
            };
          }
        },
      }),
    );
  };
}
