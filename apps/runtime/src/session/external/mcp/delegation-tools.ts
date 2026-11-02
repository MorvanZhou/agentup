import {
  selectOpenDelegationTaskIds,
  parseDelegationDisposition,
} from "../../delegation/disposition.js";
import {
  discoverRecruitedAgents,
  formatAgentCardLine,
} from "../../delegation/discover.js";
import { DelegationError } from "../../delegation/service/index.js";
import { STEER_NOTE_MAX } from "../../delegation/steer.js";
import type { DelegationTask, RecruitedAgentInfo } from "../../delegation/types.js";
import {
  ROOM_DELEGATION_TOOLS,
  SINGLE_ONLY_DELEGATION_TOOLS,
} from "../../context/tool-policy.js";
import type { McpTool } from "./server.js";

/**
 * 外部 agent 的委托工具（docs/agent_cli §12.7）。
 *
 * 只依赖 `DelegationService` 的最小面，避免本模块把整个委托服务拖进来（那会和 run 互相引用）。
 * 语义与 Pi 侧 `ROOM_DELEGATION_TOOLS`（+ 单聊 `agent_search`）对齐；
 * 完备性由测试对照 `ROOM_DELEGATION_TOOLS` 锁死——Pi 扩工具而 MCP 未跟时会红。
 * **异步优先**：wait 缺省 false，立刻回 task_id（主轮预算宝贵，见 §12.7 超时那条）。
 * 群聊不挂 `agent_search`（与 Pi 一致）。
 */

export type DelegationBridge = {
  delegateFanout(input: {
    userId: string;
    fromAgentId: string;
    items: Array<{ toAgentId: string; brief: string }>;
    wait?: boolean;
    groupId?: string;
  }): Promise<{ tasks: DelegationTask[]; texts?: string[]; steeredTaskIds?: string[] }>;
  getTask(taskId: string): DelegationTask | undefined;
  listTasks(userId: string, filters?: { fromAgentId?: string }): DelegationTask[];
  cancel(taskId: string, userId: string): DelegationTask;
  steer(input: {
    taskId: string;
    userId: string;
    fromAgentId: string;
    note: string;
  }): Promise<{ queued: boolean; reason?: string; task: DelegationTask }>;
  listRecruited(userId: string): Promise<RecruitedAgentInfo[]>;
};

export type DelegationToolScope = {
  service: DelegationBridge;
  userId: string;
  agentId: string;
  groupId?: string;
};

/** MCP 应挂载的委托工具名（与 Pi 房间协调工具同集；单聊另加 agent_search）。 */
export function expectedMcpDelegationToolNames(scope: { groupId?: string }): string[] {
  if (scope.groupId) return [...ROOM_DELEGATION_TOOLS];
  return [...SINGLE_ONLY_DELEGATION_TOOLS, ...ROOM_DELEGATION_TOOLS];
}

export function delegationTools(scope: DelegationToolScope): McpTool[] {
  const tools: McpTool[] = [];
  // 群聊花名册是房间成员，不挂全局 agent_search（与 Pi 一致）。
  if (!scope.groupId) tools.push(agentSearchTool(scope));
  tools.push(
    delegateTool(scope),
    checkTool(scope),
    cancelTool(scope),
    steerTool(scope),
    resolveTool(scope),
  );
  return tools;
}

function agentSearchTool(scope: DelegationToolScope): McpTool {
  return {
    name: "agent_search",
    description:
      "Search the user's specialist contact list (local private + market recruited) by query " +
      "(name, role, background, AGENTS.md). Required before ask_user, file writes, or shell, and before " +
      "deciding no specialist fits. A # Relevant recruited agents hint is not this search. " +
      "If anyone matches, ask the user who should do it, then call delegate_to_agent — do not silently self-serve.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Required search keywords over name / role / background / remark / identity. " +
            "Use short domain terms (e.g. exchange rate, weather, legal). Do not omit.",
        },
      },
      required: ["query"],
    },
    handler: async (args) => {
      const roster = await scope.service.listRecruited(scope.userId);
      const others = roster.filter((agent) => agent.agentId !== scope.agentId);
      if (others.length === 0) {
        return {
          text: "No recruited agents. Ask the user to recruit a specialist from the market first.",
        };
      }
      const query = typeof args.query === "string" ? args.query.trim() : "";
      const discovered = discoverRecruitedAgents(others, query);
      if (discovered.mode === "need_query") {
        return {
          text: "query is required. Pass short keywords (role or domain), then retry agent_search.",
          isError: true,
        };
      }
      if (discovered.agents.length === 0) {
        return {
          text:
            `No recruited agents matched query: ${query}. ` +
            "Try different keywords, or ask the user whether you should do the work yourself.",
        };
      }
      const footer = discovered.truncated ? "\n\n(More available — refine query.)" : "";
      const lines = discovered.agents.map(formatAgentCardLine);
      return { text: `Matching recruited agents:\n${lines.join("\n")}${footer}` };
    },
  };
}

function delegateTool(scope: DelegationToolScope): McpTool {
  return {
    name: "delegate_to_agent",
    description:
      "Hand a bounded subtask to a recruited specialist and keep coordinating. " +
      "Pass agent_id + brief, or tasks=[{agent_id, brief}] for parallel fan-out. " +
      "Async by default: returns task_id immediately; set wait=true only when you need the answer this turn and it is likely fast. " +
      "Briefs must carry the user's wording, confirmed facts, and the deliverable (format and filename). " +
      "If the specialist already has a running task from you, this updates that task instead of opening another. " +
      "You remain the coordinator: summarize outcomes for the user; do not redo the specialist's deliverable.",
    inputSchema: {
      type: "object",
      properties: {
        agent_id: { type: "string", description: "agent_id of a recruited specialist" },
        brief: { type: "string", description: "Bounded subtask for that specialist" },
        tasks: {
          type: "array",
          description: "Parallel fan-out: several independent subtasks",
          items: {
            type: "object",
            properties: { agent_id: { type: "string" }, brief: { type: "string" } },
            required: ["agent_id", "brief"],
          },
        },
        wait: { type: "boolean", description: "Join the result this turn (only for fast subtasks)" },
      },
    },
    handler: async (args) => {
      const items = parseItems(args);
      if (items.length === 0) {
        return { text: "Error: provide agent_id + brief, or a non-empty tasks array", isError: true };
      }
      const wait = args.wait === true ? true : undefined;
      const result = await scope.service.delegateFanout({
        userId: scope.userId,
        fromAgentId: scope.agentId,
        items,
        ...(wait === undefined ? {} : { wait }),
        ...(scope.groupId ? { groupId: scope.groupId } : {}),
      });
      const steered = new Set(result.steeredTaskIds ?? []);
      const lines = result.tasks.map((task, index) => {
        const body = result.texts?.[index] ?? task.resultSummary ?? task.error ?? "";
        const head = steered.has(task.id)
          ? `Steered existing task (no new task).\ntask_id: ${task.id}\nagent: ${task.toAgentName} (${task.toAgentId})`
          : `task_id: ${task.id}\nstatus: ${task.status}\nagent: ${task.toAgentName} (${task.toAgentId})`;
        return `${head}${body ? `\n${task.status === "failed" ? "error" : "result"}: ${body}` : ""}`;
      });
      if (lines.length === 0) {
        return { text: "Queued. No new running task." };
      }
      return {
        text:
          `${lines.join("\n\n")}\n\n` +
          "Use check_delegation with these task_ids later. If a specialist failed, report it and do not redo the work yourself.",
      };
    },
  };
}

function checkTool(scope: DelegationToolScope): McpTool {
  return {
    name: "check_delegation",
    description:
      "Check status/result of prior delegate_to_agent task(s). Pass task_ids (or task_id); " +
      "omit both to list recent tasks. Checking does not dispose of a task.",
    inputSchema: {
      type: "object",
      properties: {
        task_id: { type: "string" },
        task_ids: { type: "array", items: { type: "string" } },
      },
    },
    handler: async (args) => {
      const ids = collectIds(args);
      if (ids.length === 0) {
        const tasks = scope.service.listTasks(scope.userId, { fromAgentId: scope.agentId }).slice(0, 20);
        if (tasks.length === 0) return { text: "No delegation tasks yet." };
        return { text: tasks.map(taskLine).join("\n\n") };
      }
      const blocks: string[] = [];
      const missing: string[] = [];
      for (const id of ids) {
        const task = scope.service.getTask(id);
        // 归属校验与 Pi 侧一致：不是自己派出的就不给看
        if (
          !task ||
          task.userId !== scope.userId ||
          task.fromAgentId !== scope.agentId
        ) {
          missing.push(id);
          continue;
        }
        blocks.push(taskLine(task));
      }
      if (blocks.length === 0) {
        return { text: `Error: task not found: ${missing.join(", ")}`, isError: true };
      }
      return { text: [...blocks, ...(missing.length ? [`missing: ${missing.join(", ")}`] : [])].join("\n\n") };
    },
  };
}

function cancelTool(scope: DelegationToolScope): McpTool {
  return {
    name: "cancel_delegation",
    description:
      "Cancel a running or queued delegate_to_agent task by task_id. " +
      "Use when the user asks to stop a specialist, or the subtask is no longer needed. " +
      "Do not cancel merely to change the brief; call steer_delegation while the task is running. " +
      "Do not kill OS processes or send vendor team shutdown messages — this tool is the stop path. " +
      "After cancel: re-delegate or ask the user who should take over — do not perform the specialist's work yourself unless they explicitly say so.",
    inputSchema: {
      type: "object",
      properties: {
        task_id: { type: "string", description: "Delegation task id to cancel (running or queued)" },
      },
      required: ["task_id"],
    },
    handler: async (args) => {
      const taskId = typeof args.task_id === "string" ? args.task_id.trim() : "";
      if (!taskId) return { text: "Error: task_id required", isError: true };
      try {
        const task = scope.service.cancel(taskId, scope.userId);
        return {
          text:
            task.status === "cancelled"
              ? `Delegation cancelled.\ntask_id: ${task.id}\nagent: ${task.toAgentName} (${task.toAgentId})`
              : `Delegation already finished (${task.status}).\ntask_id: ${task.id}`,
        };
      } catch (error) {
        return { text: `Error: ${errorMessage(error, "取消失败")}`, isError: true };
      }
    },
  };
}

function steerTool(scope: DelegationToolScope): McpTool {
  return {
    name: "steer_delegation",
    description:
      "Insert a new requirement into a running task without cancelling it. " +
      "The specialist keeps the current session and applies the note after the current step. " +
      "Returns why if it cannot be applied (still starting, already finished, or waiting on the user). " +
      "Do not use this to stop a task — call cancel_delegation instead.",
    inputSchema: {
      type: "object",
      properties: {
        task_id: { type: "string", description: "task_id of a running delegation" },
        note: {
          type: "string",
          description: `The new requirement; do not restate the whole brief. Max ${STEER_NOTE_MAX} chars.`,
        },
      },
      required: ["task_id", "note"],
    },
    handler: async (args) => {
      const taskId = typeof args.task_id === "string" ? args.task_id.trim() : "";
      const note = typeof args.note === "string" ? args.note : "";
      if (!taskId) return { text: "Error: task_id required", isError: true };
      if (!note.trim()) return { text: "Error: note required", isError: true };
      try {
        const outcome = await scope.service.steer({
          taskId,
          userId: scope.userId,
          fromAgentId: scope.agentId,
          note,
        });
        const who = `task_id: ${outcome.task.id}\nagent: ${outcome.task.toAgentName} (${outcome.task.toAgentId})`;
        if (outcome.queued) {
          return {
            text:
              `Steering queued.\n${who}\n` +
              "The specialist keeps this run and applies the note after the current step. " +
              "Do not cancel or re-delegate this task for the same change.",
          };
        }
        const reason = outcome.reason ?? "unknown";
        return {
          text: `Cannot steer (${reason}).\n${who}\nstatus: ${outcome.task.status}`,
          isError: true,
        };
      } catch (error) {
        return { text: `Error: ${errorMessage(error, "插入失败")}`, isError: true };
      }
    },
  };
}

function resolveTool(scope: DelegationToolScope): McpTool {
  return {
    name: "resolve_delegation_update",
    description:
      "Dispose of an in-progress delegation for this user message. Call once per open task_id. " +
      "Saying you forwarded or noted a change does not reach the specialist. " +
      "steer inserts the note into that running task (same as steer_delegation). " +
      "keep means this user message does not change that task. " +
      "cancel stops it (same as cancel_delegation). " +
      "new_task means this is different work; then call delegate_to_agent if a new specialist run is needed. " +
      "check_delegation does not dispose of the task.",
    inputSchema: {
      type: "object",
      properties: {
        task_id: {
          type: "string",
          description: "task_id of an in-progress delegation from the Active delegations list",
        },
        action: {
          type: "string",
          description: "steer | keep | cancel | new_task",
          enum: ["steer", "keep", "cancel", "new_task"],
        },
        note: {
          type: "string",
          description: `Required for action=steer. Max ${STEER_NOTE_MAX} chars.`,
        },
        reason: {
          type: "string",
          description: "Required for action=keep or new_task.",
        },
      },
      required: ["task_id", "action"],
    },
    handler: async (args) => {
      const openTaskIds = selectOpenDelegationTaskIds(
        scope.service.listTasks(scope.userId, { fromAgentId: scope.agentId }),
        scope.agentId,
      );
      const parsed = parseDelegationDisposition({
        taskId: typeof args.task_id === "string" ? args.task_id : "",
        action: typeof args.action === "string" ? args.action : "",
        note: typeof args.note === "string" ? args.note : "",
        reason: typeof args.reason === "string" ? args.reason : "",
        openTaskIds,
      });
      if (!parsed.ok) {
        return { text: `Error: ${parsed.error}`, isError: true };
      }
      if (parsed.action === "keep" || parsed.action === "new_task") {
        return {
          text:
            parsed.action === "keep"
              ? `Kept task unchanged.\ntask_id: ${parsed.taskId}\nreason: ${parsed.reason}`
              : `Marked as a different task.\ntask_id: ${parsed.taskId}\nreason: ${parsed.reason}\nCall delegate_to_agent only if new work should start.`,
        };
      }
      if (parsed.action === "cancel") {
        try {
          const task = scope.service.cancel(parsed.taskId, scope.userId);
          return {
            text: `Delegation cancelled.\ntask_id: ${task.id}\nagent: ${task.toAgentName} (${task.toAgentId})`,
          };
        } catch (error) {
          return { text: `Error: ${errorMessage(error, "取消失败")}`, isError: true };
        }
      }
      // steer
      try {
        const outcome = await scope.service.steer({
          taskId: parsed.taskId,
          userId: scope.userId,
          fromAgentId: scope.agentId,
          note: parsed.note,
        });
        const who = `task_id: ${outcome.task.id}\nagent: ${outcome.task.toAgentName} (${outcome.task.toAgentId})`;
        if (outcome.queued) {
          return {
            text:
              `Steering queued.\n${who}\n` +
              "The specialist keeps this run and applies the note after the current step. " +
              "Do not cancel or re-delegate this task for the same change.",
          };
        }
        return {
          text: `Cannot steer (${outcome.reason ?? "unknown"}).\n${who}\nstatus: ${outcome.task.status}`,
          isError: true,
        };
      } catch (error) {
        return { text: `Error: ${errorMessage(error, "插入失败")}`, isError: true };
      }
    },
  };
}

function parseItems(args: Record<string, unknown>): Array<{ toAgentId: string; brief: string }> {
  const raw = Array.isArray(args.tasks) ? args.tasks : [];
  if (raw.length > 0) {
    return raw.flatMap((item) => {
      const row = (item ?? {}) as { agent_id?: unknown; brief?: unknown };
      const toAgentId = typeof row.agent_id === "string" ? row.agent_id.trim() : "";
      if (!toAgentId) return [];
      return [{ toAgentId, brief: typeof row.brief === "string" ? row.brief : "" }];
    });
  }
  const toAgentId = typeof args.agent_id === "string" ? args.agent_id.trim() : "";
  if (!toAgentId) return [];
  return [{ toAgentId, brief: typeof args.brief === "string" ? args.brief : "" }];
}

function collectIds(args: Record<string, unknown>): string[] {
  const ids: string[] = [];
  if (typeof args.task_id === "string" && args.task_id.trim()) ids.push(args.task_id.trim());
  if (Array.isArray(args.task_ids)) {
    for (const value of args.task_ids) {
      if (typeof value === "string" && value.trim()) ids.push(value.trim());
    }
  }
  return [...new Set(ids)];
}

function taskLine(task: DelegationTask): string {
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

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof DelegationError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}
