import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionFactory, type ToolCallEvent } from "@earendil-works/pi-coding-agent";

import { PERSONAL_ASSISTANT_ID } from "../../local/assistant/personal-assistant.js";
import { DELEGATION_BRIEF_LOCATION_RULE } from "../delegation/collaboration-prompt.js";
import {
  AGENTUP_DELEGATION_DISPOSITION_TYPE,
  formatDelegationDispositionPrompt,
  MAX_DELEGATION_DISPOSITION_FORCES,
  parseDelegationDisposition,
  RESOLVE_DELEGATION_UPDATE_TOOL,
  selectOpenDelegationTaskIds,
  shouldForceDelegationDisposition,
  unresolvedDelegationTaskIds,
} from "../delegation/disposition.js";
import {
  discoverRecruitedAgents,
  formatAgentCardLine,
} from "../delegation/discover.js";
import {
  DelegationError,
  type DelegationService,
  type DelegationSteerOutcome,
} from "../delegation/service/index.js";
import { agentSearchGate, TOOLS_REQUIRING_AGENT_SEARCH } from "../delegation/search-gate.js";
import { STEER_NOTE_MAX } from "../delegation/steer.js";
import {
  MAX_DELEGATION_FANOUT,
  type DelegationTask,
} from "../delegation/types.js";

export const AGENT_SEARCH_TOOL = "agent_search";
export const DELEGATE_TO_AGENT_TOOL = "delegate_to_agent";
export const CHECK_DELEGATION_TOOL = "check_delegation";
export const CANCEL_DELEGATION_TOOL = "cancel_delegation";
export const STEER_DELEGATION_TOOL = "steer_delegation";
export { RESOLVE_DELEGATION_UPDATE_TOOL };

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
      "Bounded subtask for that specialist: user wording, confirmed facts, and the deliverable (format and filename). " +
      `${DELEGATION_BRIEF_LOCATION_RULE} Do not invent product/design defaults for them.`,
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
      "Brief for a single-specialist delegation: user wording, confirmed facts, and the deliverable (format and filename). " +
      `${DELEGATION_BRIEF_LOCATION_RULE} Do not invent product/design defaults. Mutually exclusive with tasks.`,

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

const ResolveParams = Type.Object({
  task_id: Type.String({
    description: "task_id of an in-progress delegation from this turn's Active delegations list",
  }),
  action: Type.Union([
    Type.Literal("steer"),
    Type.Literal("keep"),
    Type.Literal("cancel"),
    Type.Literal("new_task"),
  ]),
  note: Type.Optional(
    Type.String({
      description: "Required for action=steer. The new requirement for that same running task.",
      maxLength: STEER_NOTE_MAX,
    }),
  ),
  reason: Type.Optional(
    Type.String({
      description: "Required for action=keep or new_task. Why this message does not update that task.",
    }),
  ),
});

const SteerParams = Type.Object({
  task_id: Type.String({
    description: "task_id of a running delegation to update in place",
  }),
  note: Type.String({
    description:
      "New requirement for the same in-flight task. The specialist applies it after the current step. " +
      `Do not restate the whole brief. ${DELEGATION_BRIEF_LOCATION_RULE}`,
    minLength: 1,
    maxLength: STEER_NOTE_MAX,
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
type SteerDetails = { task?: DelegationTask; error?: string };

export function createDelegateExtension(
  service: DelegationService,
  userId: string,
  agentId: string,
): ExtensionFactory {
  return (pi) => {
    const enforceSearch = agentId === PERSONAL_ASSISTANT_ID;
    let searched = false;
    let rosterChecked = false;
    let hasOtherAgents = false;

    const resolvedTaskIds = new Set<string>();
    let openTaskIds: string[] = [];
    let dispositionForces = 0;

    const markResolved = (taskId: string) => {
      if (openTaskIds.includes(taskId)) resolvedTaskIds.add(taskId);
    };

    pi.on("agent_start", () => {
      searched = false;
      rosterChecked = false;
      hasOtherAgents = false;
      resolvedTaskIds.clear();
      dispositionForces = 0;
      openTaskIds = [];
      if (!service.delegationDispositionArmed(userId, agentId)) return;
      try {
        openTaskIds = selectOpenDelegationTaskIds(
          service.listTasks(userId, { fromAgentId: agentId }),
          agentId,
        );
      } catch {
        openTaskIds = [];
      }
    });

    pi.on("agent_before_settle", (event) => {
      const unresolved = unresolvedDelegationTaskIds(openTaskIds, resolvedTaskIds);
      if (
        !shouldForceDelegationDisposition({
          outcome: event.outcome,
          canContinue: Boolean(event.context?.canContinue),
          unresolvedTaskIds: unresolved,
          forces: dispositionForces,
          maxForces: MAX_DELEGATION_DISPOSITION_FORCES,
        })
      ) {
        return undefined;
      }
      dispositionForces += 1;
      return {
        entries: [
          ...event.entries,
          {
            type: "custom_message" as const,
            customType: AGENTUP_DELEGATION_DISPOSITION_TYPE,
            content: formatDelegationDispositionPrompt(unresolved),
            display: false,
          },
        ],
        continue: true,
      };
    });

    pi.on("tool_call", async (event: ToolCallEvent) => {
      if (event.toolName === AGENT_SEARCH_TOOL) {
        searched = true;
        return undefined;
      }
      if (!enforceSearch || searched || !TOOLS_REQUIRING_AGENT_SEARCH.has(event.toolName)) {
        return undefined;
      }
      if (!rosterChecked) {
        rosterChecked = true;
        try {
          const roster = await service.listRecruited(userId);
          hasOtherAgents = roster.some((agent) => agent.agentId !== agentId);
        } catch {
          hasOtherAgents = false;
        }
      }
      return agentSearchGate({
        toolName: event.toolName,
        enforce: enforceSearch,
        hasOtherAgents,
        searched,
      });
    });

    pi.registerTool(
      defineTool<typeof SearchAgentsParams, ListDetails>({
        name: AGENT_SEARCH_TOOL,
        label: "Agent Search",
        description:
          "Search the user's specialist contact list (local private + market recruited) by query " +
          "(name, role, background, AGENTS.md). Required before ask_user, file writes, or shell, and before " +
          "deciding no specialist fits. A # Relevant recruited agents hint is not this search. " +
          "If anyone matches, ask the user who should do it, then call delegate_to_agent — do not silently self-serve.",

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
                  text:
                    `No recruited agents matched query: ${query}. ` +
                    "Try different keywords, or ask the user whether you should do the work yourself.",

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
          "Delegate bounded subtask(s) to recruited specialist(s) after the user chooses who should do the work. " +
          "Single: agent_id + brief. Fan-out: tasks=[{agent_id, brief}, ...] (preferred for parallel). " +
          "Briefs: user wording + confirmed facts + the deliverable (format and filename). " +
          `${DELEGATION_BRIEF_LOCATION_RULE} Do not invent specialist-domain defaults. ` +
          "If Active delegations are listed this turn (or you already started async work), call check_delegation first; " +
          "do not re-delegate the same specialist for a duplicate/overlapping brief. " +
          "To refine a running task, call steer_delegation instead of cancelling and re-delegating. " +
          "If this specialist already has a running task from you, this call updates that same task and does not start another. " +
          "User must approve the tool. You remain the coordinator: summarize outcomes for the user; do not redo the specialist's deliverable. " +
          "Set wait by estimated duration: ≤~20s and need the answer now → wait=true; " +
          ">~20s / long / parallel / can continue other coordination → wait=false (or tasks fan-out). " +
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
            for (const id of result.steeredTaskIds ?? []) markResolved(id);
            return formatFanoutResult(result.tasks, result.texts, result.steeredTaskIds);
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
          "Use when the user asks to stop a specialist, or the subtask is no longer needed. " +
          "Do not cancel merely to change the brief; call steer_delegation while the task is running. " +
          "After cancel: re-delegate or ask the user who should take over — do not perform the specialist's work yourself unless they explicitly say so.",

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
            markResolved(task.id);
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
      defineTool<typeof SteerParams, SteerDetails>({
        name: STEER_DELEGATION_TOOL,
        label: "Steer Delegation",
        description:
          "Insert a new requirement into a running delegate_to_agent task without cancelling it. " +
          "Use when the user refines the same in-flight work (simpler method, narrower scope, extra constraint). " +
          "The specialist keeps the current session and applies the note after the current step, before the next model call. " +
          "Does not stop an in-flight tool call. " +
          "If the task is not running yet, already finished, or waiting on the user, this returns why — then wait, resolve that, cancel_delegation, or delegate_to_agent. " +
          "Do not call this to stop the task.",
        parameters: SteerParams,
        annotations: {
          readOnlyHint: false,
          openWorldHint: false,
          destructiveHint: false,
        },
        async execute(_toolCallId, params) {
          const taskId = typeof params.task_id === "string" ? params.task_id.trim() : "";
          const note = typeof params.note === "string" ? params.note : "";
          if (!taskId) {
            return {
              content: [{ type: "text" as const, text: "Error: task_id required" }],
              details: { error: "missing_task_id" },
            };
          }
          if (!note.trim()) {
            return {
              content: [{ type: "text" as const, text: "Error: note required" }],
              details: { error: "missing_note" },
            };
          }
          try {
            const outcome = await service.steer({
              taskId,
              userId,
              fromAgentId: agentId,
              note,
            });
            if (outcome.queued) markResolved(taskId);
            return {
              content: [{ type: "text" as const, text: formatSteerResult(outcome) }],
              details: { task: outcome.task },
            };
          } catch (error) {
            const message =
              error instanceof DelegationError
                ? error.message
                : error instanceof Error && error.message
                  ? error.message
                  : "插入失败";
            return {
              content: [{ type: "text" as const, text: `Error: ${message}` }],
              details: { error: message },
            };
          }
        },
      }),
    );

    pi.registerTool(
      defineTool<typeof ResolveParams, SteerDetails>({
        name: RESOLVE_DELEGATION_UPDATE_TOOL,
        label: "Resolve Delegation Update",
        description:
          "Required before you finish a user turn that started while you still had in-progress delegations. " +
          "Call once per task_id. Saying you forwarded or noted a change does not reach the specialist. " +
          "steer inserts the note into that running task (same as steer_delegation). " +
          "keep means this user message does not change that task. " +
          "cancel stops it. " +
          "new_task means this is different work; then call delegate_to_agent if a new specialist run is needed. " +
          "check_delegation does not dispose of the task.",
        parameters: ResolveParams,
        annotations: {
          readOnlyHint: false,
          openWorldHint: false,
          destructiveHint: false,
        },
        async execute(_toolCallId, params) {
          const parsed = parseDelegationDisposition({
            taskId: typeof params.task_id === "string" ? params.task_id : "",
            action: typeof params.action === "string" ? params.action : "",
            note: typeof params.note === "string" ? params.note : "",
            reason: typeof params.reason === "string" ? params.reason : "",
            openTaskIds,
          });
          if (!parsed.ok) {
            return {
              content: [{ type: "text" as const, text: `Error: ${parsed.error}` }],
              details: { error: parsed.error },
            };
          }
          if (parsed.action === "keep" || parsed.action === "new_task") {
            markResolved(parsed.taskId);
            return {
              content: [
                {
                  type: "text" as const,
                  text:
                    parsed.action === "keep"
                      ? `Kept task unchanged.\ntask_id: ${parsed.taskId}\nreason: ${parsed.reason}`
                      : `Marked as a different task.\ntask_id: ${parsed.taskId}\nreason: ${parsed.reason}\nCall delegate_to_agent only if new work should start.`,
                },
              ],
              details: {},
            };
          }
          if (parsed.action === "cancel") {
            try {
              const task = service.cancel(parsed.taskId, userId);
              markResolved(task.id);
              return {
                content: [
                  {
                    type: "text" as const,
                    text: `Delegation cancelled.\ntask_id: ${task.id}\nagent: ${task.toAgentName} (${task.toAgentId})`,
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
          }
          try {
            const outcome = await service.steer({
              taskId: parsed.taskId,
              userId,
              fromAgentId: agentId,
              note: parsed.note,
            });
            if (outcome.queued) markResolved(parsed.taskId);
            return {
              content: [{ type: "text" as const, text: formatSteerResult(outcome) }],
              details: { task: outcome.task },
            };
          } catch (error) {
            const message =
              error instanceof DelegationError
                ? error.message
                : error instanceof Error && error.message
                  ? error.message
                  : "插入失败";
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
          "Call before re-delegating when Active delegations are listed or you may overlap an in-progress brief. " +
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
  steeredTaskIds?: string[],
): { content: [{ type: "text"; text: string }]; details: DelegateDetails } {
  const steered = new Set(steeredTaskIds ?? []);
  if (tasks.length === 1 && tasks[0] && steered.has(tasks[0].id)) {
    return {
      content: [{ type: "text" as const, text: formatSteerResult({ queued: true, task: tasks[0] }) }],
      details: { task: tasks[0] },
    };
  }
  if (tasks.length === 1) {
    return formatDelegateResult(tasks[0]!, texts?.[0]);
  }
  if (steered.size > 0) {
    const lines = tasks.map((task) =>
      steered.has(task.id)
        ? `Steered existing task (no new task).\ntask_id: ${task.id}\nagent: ${task.toAgentName} (${task.toAgentId})`
        : `Delegation started (async).\ntask_id: ${task.id}\nagent: ${task.toAgentName} (${task.toAgentId})`,
    );
    return {
      content: [{ type: "text" as const, text: lines.join("\n\n") }],
      details: { tasks },
    };
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

function formatSteerResult(outcome: DelegationSteerOutcome): string {
  const task = outcome.task;
  const who = `task_id: ${task.id}\nagent: ${task.toAgentName} (${task.toAgentId})`;
  if (outcome.queued) {
    return (
      `Steering queued.\n${who}\n` +
      "The specialist keeps this run and applies the note after the current step, before the next model call. " +
      "Do not cancel or re-delegate this task for the same change."
    );
  }
  if (outcome.reason === "waiting_user") {
    return (
      `Cannot steer while the specialist is waiting on the user.\n${who}\n` +
      "Resolve the pending approval or question first, or cancel_delegation."
    );
  }
  if (outcome.reason === "finished") {
    return (
      `This delegation already finished (${task.status}).\n${who}\n` +
      "steer_delegation only works while it is running. delegate_to_agent if more work is needed."
    );
  }
  return (
    `Cannot steer yet.\n${who}\nstatus: ${task.status}\n` +
    "The specialist has not started this run. Wait and retry steer_delegation, or cancel_delegation if the user wants it stopped."
  );
}
