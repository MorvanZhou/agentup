import {
  createBashToolDefinition,
  createPowerShellToolDefinition,
  type ExtensionFactory,
} from "@earendil-works/pi-coding-agent";

import type { CommandToolName } from "../../environment.js";
import { hitlScopeFields, type HitlExtensionContext } from "../origin.js";
import type { ShellHangBroker } from "./broker.js";
import {
  createShellHangDecideExtension,
  formatIdleToolResult,
  SHELL_HANG_DECIDE_TOOL,
} from "./decide-tool.js";
import {
  createIdleAwareShellOperations,
  SHELL_HANG_IDLE_EXIT,
  SHELL_HANG_IDLE_MS,
} from "./operations.js";

/** 人审兜底：park 后无人裁决超过此时长再弹桌面。 */
export const SHELL_HANG_PROMPT_MS = 60_000;

const COMMAND_SUMMARY_MAX = 240;

export type ShellHangExtensionOptions = {
  cwd: string;
  /** 本会话启用的 shell 工具（覆盖为 idle-aware）。 */
  shellTools?: CommandToolName[];
  hitl?: HitlExtensionContext;
  /** 空闲无输出；默认 {@link SHELL_HANG_IDLE_MS}。 */
  idleMs?: number;
  /** 人审 escalate；默认 {@link SHELL_HANG_PROMPT_MS}。 */
  humanEscalateMs?: number;
};

function commandSummary(args: unknown): string {
  if (!args || typeof args !== "object") return "";
  const command = (args as { command?: unknown }).command;
  if (typeof command !== "string") return "";
  const trimmed = command.trim().replace(/\s+/g, " ");
  if (trimmed.length <= COMMAND_SUMMARY_MAX) return trimmed;
  return `${trimmed.slice(0, COMMAND_SUMMARY_MAX - 1)}…`;
}

function isBlockingShell(toolName: string): boolean {
  return toolName === "bash" || toolName === "powershell";
}

/**
 * 阻塞 shell 空闲看门狗：
 * 1. 覆盖 bash/powershell：连续无输出 → park 进程并以 exit 124 返回；
 * 2. 改写 tool_result，要求模型调 {@link SHELL_HANG_DECIDE_TOOL}；
 * 3. park 后超时仍未决 → 人审 dock（kill/wait/bg）。
 */
export function createShellHangExtension(
  broker: ShellHangBroker,
  userId: string,
  agentId: string,
  options: ShellHangExtensionOptions,
): ExtensionFactory {
  const idleMs = options.idleMs ?? SHELL_HANG_IDLE_MS;
  const humanEscalateMs = options.humanEscalateMs ?? SHELL_HANG_PROMPT_MS;
  const hitl = options.hitl ?? {};
  const scope = hitlScopeFields(hitl);
  const shellTools = options.shellTools?.length
    ? options.shellTools
    : (["bash"] as CommandToolName[]);
  const cwd = options.cwd;

  broker.setHumanEscalateMs(humanEscalateMs);

  const active = new Map<string, { toolName: string; args: unknown }>();
  /** 当前正在 exec 的 shell toolCall（start 早于 ops.exec）。 */
  let currentShellCallId: string | undefined;

  const decideFactory = createShellHangDecideExtension(broker, userId, agentId, {
    idleMs,
  });

  return (pi) => {
    decideFactory(pi);

    const bindOps = (shell: "bash" | "powershell") =>
      createIdleAwareShellOperations({
        shell,
        idleMs,
        onIdlePark: ({ command, cwd: execCwd, child, startedAt }) => {
          const toolCallId =
            currentShellCallId && active.get(currentShellCallId)?.toolName === shell
              ? currentShellCallId
              : [...active.entries()].reverse().find(([, m]) => m.toolName === shell)?.[0] ??
                `orphan-${startedAt}`;
          const meta = active.get(toolCallId);
          const summary =
            commandSummary(meta?.args) || commandSummary({ command }) || command.slice(0, COMMAND_SUMMARY_MAX);
          const hang = broker.park({
            userId,
            agentId,
            toolCallId,
            toolName: meta?.toolName ?? shell,
            command: summary,
            cwd: execCwd,
            child,
            startedAt,
            ...scope,
          });
          return hang.id;
        },
      });

    if (shellTools.includes("bash")) {
      pi.registerTool(
        createBashToolDefinition(cwd, {
          operations: bindOps("bash"),
        }),
      );
    }
    if (shellTools.includes("powershell")) {
      pi.registerTool(
        createPowerShellToolDefinition(cwd, {
          operations: bindOps("powershell"),
        }),
      );
    }

    pi.on("tool_execution_start", (event) => {
      if (!isBlockingShell(event.toolName)) return;
      active.set(event.toolCallId, {
        toolName: event.toolName,
        args: event.args,
      });
      currentShellCallId = event.toolCallId;
    });

    pi.on("tool_execution_end", (event) => {
      if (!isBlockingShell(event.toolName)) return;
      active.delete(event.toolCallId);
      if (currentShellCallId === event.toolCallId) currentShellCallId = undefined;
      // 正常结束（非 park）时清掉误触发的人审
      if (!broker.getParkedByToolCall(event.toolCallId)) {
        broker.cancelForToolCall(event.toolCallId);
      }
    });

    pi.on("tool_result", (event) => {
      if (!isBlockingShell(event.toolName)) return;
      const hang = broker.getParkedByToolCall(event.toolCallId);
      if (!hang) return;
      const prior =
        event.content
          ?.map((part) => ("text" in part ? String(part.text ?? "") : ""))
          .join("") ?? "";
      // 仅在空闲拆出（exit 124）时改写；其它错误原样
      const looksIdle =
        event.isError &&
        (/exited with code 124/i.test(prior) ||
          hang.parkedAt > 0);
      if (!looksIdle) return;
      return {
        content: [{ type: "text" as const, text: formatIdleToolResult(hang, prior) }],
        isError: true,
      };
    });

    pi.on("session_shutdown", () => {
      broker.disposeAgent(userId, agentId);
    });
  };
}

export { SHELL_HANG_IDLE_MS, SHELL_HANG_DECIDE_TOOL, SHELL_HANG_IDLE_EXIT };
