import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionFactory } from "@earendil-works/pi-coding-agent";

import {
  BackgroundJobError,
  type BackgroundJobs,
} from "../background/service.js";
import type { BackgroundJob } from "../background/types.js";
import { detectHostEnvironment } from "../environment.js";

export const BG_RUN_TOOL = "bg_run";
export const BG_STATUS_TOOL = "bg_status";
export const BG_KILL_TOOL = "bg_kill";

const RunParams = Type.Object({
  command: Type.String({
    description: "Shell command to run in the agent working directory (cwd). Returns immediately.",
  }),
  name: Type.Optional(
    Type.String({
      description: "Optional short label for the job (shown in status / UI).",
    }),
  ),
});

const StatusParams = Type.Object({
  job_id: Type.Optional(
    Type.String({
      description: "Job id from bg_run; omit to list recent jobs for this agent.",
    }),
  ),
});

const KillParams = Type.Object({
  job_id: Type.String({ description: "Job id to stop" }),
});

type RunDetails = { job?: BackgroundJob; error?: string };
type StatusDetails = { job?: BackgroundJob; jobs?: BackgroundJob[]; error?: string };
type KillDetails = { job?: BackgroundJob; error?: string };

export function createBackgroundJobsExtension(
  jobs: BackgroundJobs,
  userId: string,
  agentId: string,
  cwd: string,
  scope: { groupId?: string } = {},
): ExtensionFactory {
  const commandTool = detectHostEnvironment().commandTool;
  return (pi) => {
    pi.registerTool(
      defineTool<typeof RunParams, RunDetails>({
        name: BG_RUN_TOOL,
        label: "Background Run",
        description:
          "Start a shell command in the background without blocking the chat. " +
          "Prefer this over blocking " +
          commandTool +
          " when the command may take > ~20s (builds, watches, migrations, installs, heavy scripts). " +
          "Returns job_id immediately; use bg_status later or wait for a session notification. " +
          `Requires user approval (same as ${commandTool}); command syntax must match ${commandTool}. ` +
          "Prefer delegate_to_agent for specialist expertise.",
        parameters: RunParams,
        annotations: {
          readOnlyHint: false,
          openWorldHint: false,
          destructiveHint: true,
        },
        async execute(_toolCallId, params) {
          try {
            const job = await jobs.start({
              userId,
              agentId,
              command: String(params.command ?? ""),
              cwd,
              name: typeof params.name === "string" ? params.name : undefined,
              groupId: scope.groupId,
            });
            return {
              content: [
                {
                  type: "text" as const,
                  text:
                    `Background job started.\n` +
                    `job_id: ${job.id}\n` +
                    `name: ${job.name}\n` +
                    `command: ${job.command}\n` +
                    `Use bg_status with this job_id, or wait for a session notification when it finishes.`,
                },
              ],
              details: { job },
            };
          } catch (error) {
            const message =
              error instanceof BackgroundJobError
                ? error.message
                : error instanceof Error && error.message
                  ? error.message
                  : "启动后台任务失败";
            return {
              content: [{ type: "text" as const, text: `Error: ${message}` }],
              details: { error: message },
            };
          }
        },
      }),
    );

    pi.registerTool(
      defineTool<typeof StatusParams, StatusDetails>({
        name: BG_STATUS_TOOL,
        label: "Background Status",
        description: "Check status/output of a bg_run job, or list recent background jobs.",
        parameters: StatusParams,
        annotations: {
          readOnlyHint: true,
          openWorldHint: false,
          destructiveHint: false,
        },
        async execute(_toolCallId, params) {
          const jobId = typeof params.job_id === "string" ? params.job_id.trim() : "";
          if (jobId) {
            const job = jobs.get(jobId);
            if (!job || job.userId !== userId) {
              return {
                content: [{ type: "text" as const, text: `Error: job not found: ${jobId}` }],
                details: { error: "not_found" },
              };
            }
            if (job.status === "completed" || job.status === "failed" || job.status === "cancelled") {
              jobs.acknowledge(job.id);
            }
            const tail = jobs.readLogTail(job.id, userId);
            return {
              content: [{ type: "text" as const, text: formatJobText(job, tail) }],
              details: { job },
            };
          }
          const list = jobs.list(userId, { agentId }).slice(0, 20);
          if (list.length === 0) {
            return {
              content: [{ type: "text" as const, text: "No background jobs yet." }],
              details: { jobs: [] },
            };
          }
          return {
            content: [
              {
                type: "text" as const,
                text: list.map((job) => formatJobText(job)).join("\n\n"),
              },
            ],
            details: { jobs: list },
          };
        },
      }),
    );

    pi.registerTool(
      defineTool<typeof KillParams, KillDetails>({
        name: BG_KILL_TOOL,
        label: "Background Kill",
        description: "Stop a running or queued bg_run job by job_id.",
        parameters: KillParams,
        annotations: {
          readOnlyHint: false,
          openWorldHint: false,
          destructiveHint: true,
        },
        async execute(_toolCallId, params) {
          const jobId = typeof params.job_id === "string" ? params.job_id.trim() : "";
          if (!jobId) {
            return {
              content: [{ type: "text" as const, text: "Error: job_id required" }],
              details: { error: "missing_job_id" },
            };
          }
          try {
            const job = jobs.cancel(jobId, userId);
            return {
              content: [
                {
                  type: "text" as const,
                  text:
                    job.status === "cancelled"
                      ? `Background job cancelled.\njob_id: ${job.id}\nname: ${job.name}`
                      : `Background job already finished (${job.status}).\njob_id: ${job.id}`,
                },
              ],
              details: { job },
            };
          } catch (error) {
            const message =
              error instanceof BackgroundJobError
                ? error.message
                : error instanceof Error && error.message
                  ? error.message
                  : "取消失败";
            return {
              content: [{ type: "text" as const, text: `Error: ${message}` }],
              details: { error: message },
            };
          }
        },
      }),
    );
  };
}

function formatJobText(job: BackgroundJob, tail?: string): string {
  const lines = [
    `job_id: ${job.id}`,
    `status: ${job.status}`,
    `name: ${job.name}`,
    `command: ${job.command}`,
  ];
  if (job.exitCode !== undefined && job.exitCode !== null) {
    lines.push(`exit_code: ${job.exitCode}`);
  }
  if (job.error) lines.push(`error: ${job.error}`);
  const output = (tail ?? job.outputTail)?.trim();
  if (output) lines.push(`output_tail:\n${output}`);
  return lines.join("\n");
}
