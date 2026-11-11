import {
  COMPLETE_GROUP_TASK_TOOL,
  USER_SUMMARY_PARAM_DESCRIPTION,
  formatCompleteGroupTaskResult,
  stageGroupWorkspacePaths,
} from "../../tools/complete-group-task.js";
import {
  DELIVER_ARTIFACTS_TOOL,
  stageArtifactPaths,
  type DeliverArtifactsState,
} from "../../tools/deliver-artifacts.js";
import type { McpTool } from "./server.js";

/**
 * 外部 SDK 委托子会话的产物确认工具。
 * 与 Pi 侧 `deliver_artifacts` / `complete_group_task` 同语义，写同一份 `DeliverArtifactsState`；
 * 模型侧全名带 `mcp__agentup__` 前缀（见 .cursor/skills/agentup-sdk-adapter/references/context-and-approvals.md §4）。
 */

export type ArtifactMcpKind = "deliver_artifacts" | "complete_group_task";

export function expectedArtifactMcpToolNames(flags: {
  deliverArtifacts?: boolean;
  completeGroupTask?: boolean;
}): string[] {
  if (flags.completeGroupTask) return [COMPLETE_GROUP_TASK_TOOL];
  if (flags.deliverArtifacts) return [DELIVER_ARTIFACTS_TOOL];
  return [];
}

export function artifactDeliveryTools(
  input:
    | {
        kind: "complete_group_task";
        workspaceRoot: string;
        state: DeliverArtifactsState;
      }
    | {
        kind: "deliver_artifacts";
        cwd: string;
        state: DeliverArtifactsState;
      },
): McpTool[] {
  if (input.kind === "complete_group_task") {
    return [completeGroupTaskTool(input.workspaceRoot, input.state)];
  }
  return [deliverArtifactsTool(input.cwd, input.state)];
}

function completeGroupTaskTool(workspaceRoot: string, state: DeliverArtifactsState): McpTool {
  return {
    name: COMPLETE_GROUP_TASK_TOOL,
    description:
      "Confirm the shared group files this task produced, write a short human-facing outcome, and say what should happen next. " +
      "Paths are relative to the group workspace (WORK/… or ARTIFACT/…). Does not copy files into a private workspace. " +
      "Call this before finishing a group delegated task.",
    inputSchema: {
      type: "object",
      properties: {
        paths: {
          type: "array",
          items: { type: "string" },
          description:
            "Files from THIS task under the group workspace. Use WORK/from-<name>-<task_id>/... or ARTIFACT/from-<name>-<task_id>/.... " +
            "Use [] if this task produced no shared files.",
        },
        user_summary: {
          type: "string",
          description: USER_SUMMARY_PARAM_DESCRIPTION,
        },
        next_step: {
          type: "string",
          description: "What the group should do next. Empty string if nobody needs to continue.",
        },
      },
      required: ["paths", "user_summary", "next_step"],
    },
    async handler(args) {
      try {
        const paths = Array.isArray(args.paths) ? (args.paths as string[]) : [];
        const staged = stageGroupWorkspacePaths(workspaceRoot, paths);
        const nextStep = typeof args.next_step === "string" ? args.next_step.trim() : "";
        const userSummary = typeof args.user_summary === "string" ? args.user_summary.trim() : "";
        state.staged = staged;
        state.confirmed = true;
        state.nextStep = nextStep;
        state.userSummary = userSummary;
        return {
          text: formatCompleteGroupTaskResult({
            paths: staged.map((item) => item.path),
            userSummary,
            nextStep,
          }),
        };
      } catch (error) {
        const message = error instanceof Error && error.message ? error.message : "invalid paths";
        return { text: `Error: ${message}`, isError: true };
      }
    },
  };
}

function deliverArtifactsTool(cwd: string, state: DeliverArtifactsState): McpTool {
  return {
    name: DELIVER_ARTIFACTS_TOOL,
    description:
      "Confirm which ARTIFACT files from this delegated task should be delivered to the caller. " +
      "Pass only paths that belong to this brief; use [] if nothing should be sent. " +
      "Call this before finishing a one-to-one delegated task.",
    inputSchema: {
      type: "object",
      properties: {
        paths: {
          type: "array",
          items: { type: "string" },
          description:
            "ARTIFACT files that belong to THIS task and should be delivered to the caller. " +
            "Use [] if none of the candidates are yours. Paths may be `file.ext` or `ARTIFACT/file.ext`.",
        },
      },
      required: ["paths"],
    },
    async handler(args) {
      try {
        const paths = Array.isArray(args.paths) ? (args.paths as string[]) : [];
        const staged = stageArtifactPaths(cwd, paths);
        state.staged = staged;
        state.confirmed = true;
        const files =
          staged.length === 0
            ? "Confirmed: no ARTIFACT files to deliver."
            : `Confirmed ${staged.length} ARTIFACT file(s):\n${staged.map((item) => `- ${item.path}`).join("\n")}`;
        return { text: files };
      } catch (error) {
        const message = error instanceof Error && error.message ? error.message : "invalid paths";
        return { text: `Error: ${message}`, isError: true };
      }
    },
  };
}
