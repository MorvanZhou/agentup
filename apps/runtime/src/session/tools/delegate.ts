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
import {
  MAX_DELEGATION_FANOUT,
  type DelegationTask,
} from "../delegation/types.js";

export const AGENT_SEARCH_TOOL = "agent_search";
export const DELEGATE_TO_AGENT_TOOL = "delegate_to_agent";
export const CHECK_DELEGATION_TOOL = "check_delegation";
export const CANCEL_DELEGATION_TOOL = "cancel_delegation";

const SearchAgentsParams = Type.Object({
  query: Type.String({
    description:
      "Required search keywords over name / role / background / remark / identity. " +
      "Use short domain terms (e.g. exchange rate, weather, legal). Do not omit.",
    minLength: 1,
  }),
});

const FanoutItem = Type.Object({
  agent_id: Type.String({
    description: "agent_id of a recruited specialist",
  }),
  brief: Type.String({
    description:
      "Bounded subtask for that specialist (only the information they need)",
  }),
});

const DelegateParams = Type.Object({
  agent_id: Type.Optional(
    Type.String({
      description:
        "agent_id for a single-specialist delegation. Mutually exclusive with tasks; use tasks for fan-out.",
    }),
  ),
  brief: Type.Optional(
    Type.String({
      description:
        "Brief for a single-specialist delegation. Mutually exclusive with tasks.",
    }),
  ),
  tasks: Type.Optional(
    Type.Array(FanoutItem, {
      minItems: 1,
      maxItems: MAX_DELEGATION_FANOUT,
      description:
        `Parallel fan-out: up to ${MAX_DELEGATION_FANOUT} independent specialist subtasks. ` +
        "Async by default (returns each task_id immediately); set wait=true to join results this turn.",
    }),
  ),
  wait: Type.Optional(
    Type.Boolean({
      description:
        "Set explicitly after estimating duration: true if the specialist is likely ≤~20s and you need the result this turn; " +
        "false if likely >~20s, uncertain, or you can continue other work (returns task_id immediately). " +
        "Fan-out (tasks): defaults to false; true waits until all finish. Do not default to true merely because there is one specialist.",
    }),
  ),
});

const CheckParams = Type.Object({
  task_id: Type.Optional(
    Type.String({ description: "Delegation task id to inspect" }),
  ),
  task_ids: Type.Optional(
    Type.Array(Type.String(), {
      minItems: 1,
      maxItems: MAX_DELEGATION_FANOUT,
      description:
        "Batch-inspect multiple task_ids (fan-out join); use instead of or together with task_id (merged, deduped)",
    }),
  ),
});

const CancelParams = Type.Object({
  task_id: Type.String({
    description: "Delegation task id to cancel (running or queued)",
  }),
});

type ListDetails = { agents: unknown[]; error?: string };
type DelegateDetails = {
  task?: DelegationTask;
  tasks?: DelegationTask[];
  error?: string;
};
type CheckDetails = { task?: DelegationTask; tasks?: DelegationTask[]; error?: string };
type CancelDetails = { task?: DelegationTask; error?: string };

export function createDelegateExtension(
  service: DelegationService,
  userId: string,
  agentId: string,
): ExtensionFactory {
  return (pi) => {
    pi.registerTool(
      defineTool<typeof SearchAgentsParams, ListDetails>({
        name: AGENT_SEARCH_TOOL,
        label: "Agent Search",
        description:
          "Search the user's specialist contact list (local private + market recruited) by query " +
          "(name, role, background, remark). This is a collaboration workspace — when the task may " +
          "fit a specialist, call agent_search before guessing. Matching candidates may also appear " +
          "in context for the current turn; use this tool to refine. Then call delegate_to_agent when one fits.",
        parameters: SearchAgentsParams,
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
          const query = typeof params.query === "string" ? params.query.trim() : "";
          const discovered = discoverRecruitedAgents(others, query);
          if (discovered.mode === "need_query") {
            return {
              content: [
                {
                  type: "text" as const,
                  text: "query is required. Pass short keywords (role or domain), then retry agent_search.",
                },
              ],
              details: { agents: [], error: "query required" },
            };
          }
          if (discovered.agents.length === 0) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `No recruited agents matched query: ${query}. Try different keywords, or answer yourself.`,
                },
              ],
              details: { agents: [] },
            };
          }
          const footer = discovered.truncated
            ? "\n\n(More available — refine query.)"
            : "";
          const lines = discovered.agents.map(formatAgentCardLine);
          return {
            content: [
              {
                type: "text" as const,
                text: `Matching recruited agents:\n${lines.join("\n")}${footer}`,
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
          "Delegate bounded subtask(s) to recruited specialist(s) when their role/background fits. " +
          "Single: agent_id + brief. Fan-out: tasks=[{agent_id, brief}, ...] (preferred for parallel). " +
          "User must approve. You keep ownership of the user-facing reply; synthesize results. " +
          "Set wait by estimated duration: ≤~20s and need the answer now → wait=true; " +
          ">~20s / long / parallel / can continue other work → wait=false (or tasks fan-out). " +
          "Do not default to wait=true merely because there is one specialist.",
        parameters: DelegateParams,
        annotations: {
          readOnlyHint: false,
          openWorldHint: false,
          destructiveHint: false,
        },
        async execute(toolCallId, params, signal) {
          try {
            const items = parseDelegateItems(params);
            const result = await service.delegateFanout({
              userId,
              fromAgentId: agentId,
              items,
              wait: params.wait,
              signal,
              toolCallId,
            });
            return formatFanoutResult(result.tasks, result.texts);
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
      defineTool<typeof CancelParams, CancelDetails>({
        name: CANCEL_DELEGATION_TOOL,
        label: "Cancel Delegation",
        description:
          "Cancel a running or queued delegate_to_agent task by task_id. " +
          "Use when the user asks to stop a specialist, or the subtask is no longer needed.",
        parameters: CancelParams,
        annotations: {
          readOnlyHint: false,
          openWorldHint: false,
          destructiveHint: true,
        },
        async execute(_toolCallId, params) {
          const taskId = typeof params.task_id === "string" ? params.task_id.trim() : "";
          if (!taskId) {
            return {
              content: [{ type: "text" as const, text: "Error: task_id required" }],
              details: { error: "missing_task_id" },
            };
          }
          try {
            const task = service.cancel(taskId, userId);
            return {
              content: [
                {
                  type: "text" as const,
                  text:
                    task.status === "cancelled"
                      ? `Delegation cancelled.\ntask_id: ${task.id}\nagent: ${task.toAgentName} (${task.toAgentId})`
                      : `Delegation already finished (${task.status}).\ntask_id: ${task.id}`,
                },
              ],
              details: { task },
            };
          } catch (error) {
            const message =
              error instanceof DelegationError
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

    pi.registerTool(
      defineTool<typeof CheckParams, CheckDetails>({
        name: CHECK_DELEGATION_TOOL,
        label: "Check Delegation",
        description:
          "Check status/result of prior delegate_to_agent task(s). " +
          "Pass task_id, or task_ids for fan-out join; omit both to list recent tasks.",
        parameters: CheckParams,
        annotations: {
          readOnlyHint: true,
          openWorldHint: false,
          destructiveHint: false,
        },
        async execute(_toolCallId, params) {
          const ids = collectTaskIds(params);
          if (ids.length > 0) {
            const tasks: DelegationTask[] = [];
            const missing: string[] = [];
            for (const id of ids) {
              const task = service.getTask(id);
              if (!task || task.userId !== userId) {
                missing.push(id);
                continue;
              }
              if (task.status === "completed" || task.status === "failed") {
                service.acknowledge(task.id);
              }
              tasks.push(task);
            }
            if (tasks.length === 0) {
              return {
                content: [
                  {
                    type: "text" as const,
                    text: `Error: task not found: ${missing.join(", ")}`,
                  },
                ],
                details: { error: "not_found" },
              };
            }
            const summary = formatFanoutCheckSummary(tasks, missing);
            return {
              content: [{ type: "text" as const, text: summary }],
              details: tasks.length === 1 ? { task: tasks[0] } : { tasks },
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

function parseDelegateItems(params: {
  agent_id?: unknown;
  brief?: unknown;
  tasks?: unknown;
}): Array<{ toAgentId: string; brief: string }> {
  const rawTasks = Array.isArray(params.tasks) ? params.tasks : [];
  if (rawTasks.length > 0) {
    return rawTasks.map((item, index) => {
      const row = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
      const toAgentId = typeof row.agent_id === "string" ? row.agent_id.trim() : "";
      const brief = typeof row.brief === "string" ? row.brief : "";
      if (!toAgentId) throw new DelegationError(`tasks[${index}].agent_id 无效`);
      return { toAgentId, brief };
    });
  }
  const toAgentId = typeof params.agent_id === "string" ? params.agent_id.trim() : "";
  const brief = typeof params.brief === "string" ? params.brief : "";
  if (!toAgentId) {
    throw new DelegationError("请提供 agent_id+brief，或 tasks 数组");
  }
  return [{ toAgentId, brief }];
}

function collectTaskIds(params: {
  task_id?: unknown;
  task_ids?: unknown;
}): string[] {
  const ids: string[] = [];
  if (typeof params.task_id === "string" && params.task_id.trim()) {
    ids.push(params.task_id.trim());
  }
  if (Array.isArray(params.task_ids)) {
    for (const value of params.task_ids) {
      if (typeof value === "string" && value.trim()) ids.push(value.trim());
    }
  }
  return [...new Set(ids)];
}

function formatFanoutResult(
  tasks: DelegationTask[],
  texts?: string[],
): { content: [{ type: "text"; text: string }]; details: DelegateDetails } {
  if (tasks.length === 1) {
    return formatDelegateResult(tasks[0]!, texts?.[0]);
  }
  const running = tasks.every(
    (task) => task.status === "running" || (task.status !== "completed" && task.status !== "failed" && !task.wait),
  );
  if (running || tasks.some((task) => task.status === "running")) {
    const lines = [
      `Delegation started (async fan-out, ${tasks.length} tasks).`,
      ...tasks.map(
        (task) =>
          `- task_id: ${task.id} · ${task.toAgentName} (${task.toAgentId}) · ${task.brief.slice(0, 80)}`,
      ),
      "Use check_delegation with task_ids later, or wait for session notifications.",
    ];
    return {
      content: [{ type: "text" as const, text: lines.join("\n") }],
      details: { tasks },
    };
  }
  const lines = [
    `Delegation fan-out finished (${tasks.length} tasks).`,
    ...tasks.map((task, index) => {
      const body = texts?.[index] || task.resultSummary || task.error || "";
      return (
        `---\n` +
        `task_id: ${task.id}\n` +
        `status: ${task.status}\n` +
        `agent: ${task.toAgentName} (${task.toAgentId})\n` +
        (task.status === "failed"
          ? `error: ${task.error ?? "unknown"}\n${body ? `partial:\n${body}` : ""}`
          : `result:\n${body}`)
      );
    }),
  ];
  return {
    content: [{ type: "text" as const, text: lines.join("\n") }],
    details: { tasks },
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

function formatFanoutCheckSummary(tasks: DelegationTask[], missing: string[]): string {
  const done = tasks.filter((task) => task.status === "completed" || task.status === "failed");
  const running = tasks.filter((task) => task.status === "running" || task.status === "pending_auth");
  const header =
    `Fan-out status: ${done.length}/${tasks.length} finished` +
    (running.length ? `, ${running.length} still running` : "") +
    (missing.length ? `, ${missing.length} missing` : "") +
    ".";
  const blocks = tasks.map((task) => formatTaskText(task));
  if (missing.length) {
    blocks.push(`missing: ${missing.join(", ")}`);
  }
  return [header, "", ...blocks].join("\n\n");
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
