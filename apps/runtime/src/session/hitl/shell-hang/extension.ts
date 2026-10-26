import type { ExtensionContext, ExtensionFactory } from "@earendil-works/pi-coding-agent";

import type { HitlExtensionContext, HitlOrigin } from "../origin.js";
import type { ShellHangBroker } from "./broker.js";

/** 阻塞 bash/powershell 超过此时长仍未结束 → 询问用户是否终止。 */
export const SHELL_HANG_PROMPT_MS = 60_000;

/** UI / 落盘用的命令摘要上限。 */
const COMMAND_SUMMARY_MAX = 240;

export type ShellHangExtensionOptions = {
  hitl?: HitlExtensionContext;
  /** 单测可缩短；默认 {@link SHELL_HANG_PROMPT_MS}。 */
  thresholdMs?: number;
};

function isBlockingShell(toolName: string): boolean {
  return toolName === "bash" || toolName === "powershell";
}

function commandSummary(args: unknown): string {
  if (!args || typeof args !== "object") return "";
  const command = (args as { command?: unknown }).command;
  if (typeof command !== "string") return "";
  const trimmed = command.trim().replace(/\s+/g, " ");
  if (trimmed.length <= COMMAND_SUMMARY_MAX) return trimmed;
  return `${trimmed.slice(0, COMMAND_SUMMARY_MAX - 1)}…`;
}

/**
 * 阻塞 shell 看门狗：执行过久时经 {@link ShellHangBroker} 问用户是否终止本轮。
 * 选终止 → `ctx.abort()`（与用户点「停止」同路径，kill 进程树）。
 * 选继续 → 再等一个阈值窗口后可再次询问。
 */
export function createShellHangExtension(
  broker: ShellHangBroker,
  userId: string,
  agentId: string,
  options: ShellHangExtensionOptions = {},
): ExtensionFactory {
  const thresholdMs = options.thresholdMs ?? SHELL_HANG_PROMPT_MS;
  const hitl = options.hitl ?? {};
  const origin: HitlOrigin = hitl.origin === "delegation" ? "delegation" : "visit";

  return (pi) => {
    const timers = new Map<string, ReturnType<typeof setTimeout>>();
    const aborts = new Map<string, () => void>();
    const meta = new Map<string, { toolName: string; args: unknown }>();

    const clearTimer = (toolCallId: string) => {
      const handle = timers.get(toolCallId);
      if (handle) clearTimeout(handle);
      timers.delete(toolCallId);
    };

    const finish = (toolCallId: string) => {
      clearTimer(toolCallId);
      aborts.delete(toolCallId);
      meta.delete(toolCallId);
      broker.cancelForToolCall(toolCallId);
    };

    const arm = (toolCallId: string, ctx: ExtensionContext) => {
      clearTimer(toolCallId);
      aborts.set(toolCallId, () => ctx.abort());
      const handle = setTimeout(() => {
        void (async () => {
          const info = meta.get(toolCallId);
          if (!info || !aborts.has(toolCallId)) return;
          const decision = await broker.request({
            userId,
            agentId,
            toolCallId,
            toolName: info.toolName,
            command: commandSummary(info.args),
            elapsedMs: thresholdMs,
            origin,
            ...(hitl.taskId ? { taskId: hitl.taskId } : {}),
            ...(hitl.parentAgentId ? { parentAgentId: hitl.parentAgentId } : {}),
          });
          if (decision === "kill") {
            aborts.get(toolCallId)?.();
            finish(toolCallId);
            return;
          }
          if (decision === "wait" && aborts.has(toolCallId)) {
            arm(toolCallId, ctx);
          }
        })();
      }, thresholdMs);
      timers.set(toolCallId, handle);
    };

    pi.on("tool_execution_start", (event, ctx) => {
      if (!isBlockingShell(event.toolName)) return;
      meta.set(event.toolCallId, { toolName: event.toolName, args: event.args });
      arm(event.toolCallId, ctx);
    });

    pi.on("tool_execution_end", (event) => {
      if (!isBlockingShell(event.toolName)) return;
      finish(event.toolCallId);
    });
  };
}
