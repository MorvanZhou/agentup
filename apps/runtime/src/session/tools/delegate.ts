import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionFactory } from "@earendil-works/pi-coding-agent";

import {
  discoverRecruitedAgents,
  formatAgentCardLine,
} from "../delegation/discover.js";
import {
  DelegationError,
  type DelegationService,
} from "../delegation/service.js";
import type { DelegationTask } from "../delegation/types.js";

export const LIST_RECRUITED_AGENTS_TOOL = "list_recruited_agents";
export const DELEGATE_TO_AGENT_TOOL = "delegate_to_agent";
export const CHECK_DELEGATION_TOOL = "check_delegation";

const ListParams = Type.Object({
  query: Type.Optional(
    Type.String({
      description:
        "Optional search over name / role / background / remark. " +
        "Omit when the roster is small; use a short query when many agents are recruited.",
    }),
  ),
});

const DelegateParams = Type.Object({
  agent_id: Type.String({
    description: "已招募专家的 agent_id（先看本轮候选卡或 list_recruited_agents）",
  }),
  brief: Type.String({
    description:
      "交给专家的有界子任务说明。只写完成任务所需信息，不要粘贴完整私密对话。",
  }),
  wait: Type.Optional(
    Type.Boolean({
      description:
        "true/省略：同步等待结果；false：立即返回 task_id，完成后会通知你（再用 check_delegation 或等待会话通知）",
    }),
  ),
});

const CheckParams = Type.Object({
  task_id: Type.Optional(Type.String({ description: "要查询的委托任务 id；省略则列出最近任务" })),
});

type ListDetails = { agents: unknown[]; error?: string };
type DelegateDetails = { task?: DelegationTask; error?: string };
type CheckDetails = { task?: DelegationTask; tasks?: DelegationTask[]; error?: string };

export function createDelegateExtension(
  service: DelegationService,
  userId: string,
  agentId: string,
): ExtensionFactory {
  return (pi) => {
    pi.registerTool(
      defineTool<typeof ListParams, ListDetails>({
        name: LIST_RECRUITED_AGENTS_TOOL,
        label: "List Recruited Agents",
        description:
          "List available specialist agents (local private + market recruited) by optional query " +
          "(name, role, background). Relevant candidates may already appear in context each turn; " +
          "use this to refine or list more. Then call delegate_to_agent when a specialist fits.",
        parameters: ListParams,
        annotations: {
          readOnlyHint: true,
          openWorldHint: false,
          destructiveHint: false,
        },
        async execute(_toolCallId, params) {
          const roster = await service.listRecruited(userId);
          const others = roster.filter((agent) => agent.agentId !== agentId);
          if (others.length === 0) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: "No recruited agents. Ask the user to recruit a specialist from the market first.",
                },
              ],
              details: { agents: [] },
            };
          }
          const query = typeof params.query === "string" ? params.query : "";
          const discovered = discoverRecruitedAgents(others, query);
          if (discovered.agents.length === 0) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: query.trim()
                    ? `No recruited agents matched query: ${query.trim()}`
                    : "No recruited agents to list.",
                },
              ],
              details: { agents: [] },
            };
          }
          const header =
            discovered.mode === "sample"
              ? "Recruited agents (partial — pass query to search):\n"
              : discovered.mode === "search"
                ? "Matching recruited agents:\n"
                : "Recruited agents:\n";
          const footer =
            discovered.truncated && discovered.mode !== "all"
              ? "\n\n(More available — refine with query.)"
              : "";
          const lines = discovered.agents.map(formatAgentCardLine);
          return {
            content: [
              {
                type: "text" as const,
                text: `${header}${lines.join("\n")}${footer}`,
              },
            ],
            details: { agents: discovered.agents },
          };
        },
      }),
    );

    pi.registerTool(
      defineTool<typeof DelegateParams, DelegateDetails>({
        name: DELEGATE_TO_AGENT_TOOL,
        label: "Delegate To Agent",
        description:
          "Delegate a bounded subtask to a recruited specialist when their role/background fits. " +
          "Prefer this over guessing outside your expertise. The user must approve the consultation. " +
          "You keep ownership of the user-facing reply; synthesize the specialist's result. Prefer wait=true for short tasks.",
        parameters: DelegateParams,
        annotations: {
          readOnlyHint: false,
          openWorldHint: false,
          destructiveHint: false,
        },
        async execute(toolCallId, params, signal) {
          try {
            const result = await service.delegate({
              userId,
              fromAgentId: agentId,
              toAgentId: String(params.agent_id ?? "").trim(),
              brief: String(params.brief ?? ""),
              wait: params.wait !== false,
              signal,
              toolCallId,
            });
            return formatDelegateResult(result.task, result.text);
          } catch (error) {
            const message =
              error instanceof DelegationError
                ? error.message
                : error instanceof Error && error.message
                  ? error.message
                  : "委托失败";
            return {
              content: [{ type: "text" as const, text: `Error: ${message}` }],
              details: { error: message },
            };
          }
        },
      }),
    );

    pi.registerTool(
      defineTool<typeof CheckParams, CheckDetails>({
        name: CHECK_DELEGATION_TOOL,
        label: "Check Delegation",
        description:
          "Check status/result of a prior delegate_to_agent task (by task_id), or list recent delegation tasks.",
        parameters: CheckParams,
        annotations: {
          readOnlyHint: true,
          openWorldHint: false,
          destructiveHint: false,
        },
        async execute(_toolCallId, params) {
          const taskId =
            typeof params.task_id === "string" ? params.task_id.trim() : "";
          if (taskId) {
            const task = service.getTask(taskId);
            if (!task || task.userId !== userId) {
              return {
                content: [{ type: "text" as const, text: `Error: task not found: ${taskId}` }],
                details: { error: "not_found" },
              };
            }
            if (task.status === "completed" || task.status === "failed") {
              service.acknowledge(task.id);
            }
            return {
              content: [{ type: "text" as const, text: formatTaskText(task) }],
              details: { task },
            };
          }
          const tasks = service.listTasks(userId).slice(0, 20);
          if (tasks.length === 0) {
            return {
              content: [{ type: "text" as const, text: "No delegation tasks yet." }],
              details: { tasks: [] },
            };
          }
          return {
            content: [
              {
                type: "text" as const,
                text: tasks.map((task) => formatTaskText(task)).join("\n\n"),
              },
            ],
            details: { tasks },
          };
        },
      }),
    );
  };
}

function formatDelegateResult(
  task: DelegationTask,
  text?: string,
): { content: [{ type: "text"; text: string }]; details: DelegateDetails } {
  if (task.status === "running" || (task.status !== "completed" && task.status !== "failed" && !task.wait)) {
    return {
      content: [
        {
          type: "text" as const,
          text:
            `Delegation started (async).\n` +
            `task_id: ${task.id}\n` +
            `agent: ${task.toAgentName} (${task.toAgentId})\n` +
            `Use check_delegation with this task_id later, or wait for a session notification when it finishes.`,
        },
      ],
      details: { task },
    };
  }
  if (task.status === "failed") {
    return {
      content: [
        {
          type: "text" as const,
          text:
            `Delegation failed.\n` +
            `task_id: ${task.id}\n` +
            `agent: ${task.toAgentName} (${task.toAgentId})\n` +
            `error: ${task.error ?? "unknown"}\n` +
            (text || task.resultSummary
              ? `partial:\n${text || task.resultSummary}`
              : ""),
        },
      ],
      details: { task },
    };
  }
  return {
    content: [
      {
        type: "text" as const,
        text:
          `Delegation completed.\n` +
          `task_id: ${task.id}\n` +
          `agent: ${task.toAgentName} (${task.toAgentId})\n` +
          `result:\n${text || task.resultSummary || ""}`,
      },
    ],
    details: { task },
  };
}

function formatTaskText(task: DelegationTask): string {
  const lines = [
    `task_id: ${task.id}`,
    `status: ${task.status}`,
    `agent: ${task.toAgentName} (${task.toAgentId})`,
    `brief: ${task.brief}`,
  ];
  if (task.resultSummary) lines.push(`result: ${task.resultSummary}`);
  if (task.error) lines.push(`error: ${task.error}`);
  return lines.join("\n");
}
