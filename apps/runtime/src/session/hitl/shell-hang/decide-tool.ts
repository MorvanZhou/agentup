import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionFactory } from "@earendil-works/pi-coding-agent";

import type { ShellHangBroker } from "./broker.js";
import { SHELL_HANG_IDLE_MS } from "./operations.js";
import type { ShellHangDecision } from "./types.js";

export const SHELL_HANG_DECIDE_TOOL = "shell_hang_decide";

const DecideParams = Type.Object({
  hang_id: Type.String({
    description: "hang_id from a prior idle shell result (exit 124 / shell_hang notice).",
  }),
  action: Type.Union([
    Type.Literal("kill"),
    Type.Literal("wait"),
    Type.Literal("bg"),
  ], {
    description:
      "kill = stop the process and use output so far; " +
      "wait = keep blocking until exit or another idle window; " +
      "bg = leave it running and continue other work.",
  }),
});

type DecideDetails = {
  error?: string;
  action?: ShellHangDecision;
  hang_id?: string;
  pid?: number;
  status?: string;
  exit_code?: number | null;
};

function isDecision(value: unknown): value is ShellHangDecision {
  return value === "kill" || value === "wait" || value === "bg";
}

function formatHangHint(hang: {
  id: string;
  command: string;
  outputTail: string;
  waitCount: number;
}): string {
  const tail = hang.outputTail.trim();
  const out = tail ? `\nOutput so far (tail):\n${tail.slice(-2000)}` : "\n(no output yet)";
  return (
    `[shell_hang] Process still running after idle.\n` +
    `hang_id: ${hang.id}\n` +
    `command: ${hang.command}\n` +
    `wait_count: ${hang.waitCount}` +
    out +
    `\n\nCall ${SHELL_HANG_DECIDE_TOOL} with hang_id and action kill|wait|bg.\n` +
    `- kill: stop it (likely open timers / servers / setInterval after work finished)\n` +
    `- wait: block again until exit or another idle window\n` +
    `- bg: leave running and continue`
  );
}

export function formatIdleToolResult(hang: {
  id: string;
  command: string;
  outputTail: string;
  waitCount: number;
}, priorText: string): string {
  const prior = priorText.trim();
  const body = formatHangHint(hang);
  if (!prior) return body;
  // 去掉 Pi 默认的 "Command exited with code 124"
  const cleaned = prior.replace(/\n*Command exited with code 124\s*$/i, "").trim();
  return cleaned ? `${cleaned}\n\n${body}` : body;
}

export function createShellHangDecideExtension(
  broker: ShellHangBroker,
  userId: string,
  agentId: string,
  options: { idleMs?: number } = {},
): ExtensionFactory {
  const idleMs = options.idleMs ?? SHELL_HANG_IDLE_MS;
  return (pi) => {
    pi.registerTool(
      defineTool<typeof DecideParams, DecideDetails>({
        name: SHELL_HANG_DECIDE_TOOL,
        label: "Shell Hang Decide",
        description:
          "Decide what to do with a blocking shell command that went idle but is still running " +
          `(hang_id from the idle notice). Prefer kill when output looks complete (e.g. setInterval left running).`,
        parameters: DecideParams,
        annotations: {
          readOnlyHint: false,
          openWorldHint: false,
          destructiveHint: true,
        },
        async execute(_toolCallId, params, signal) {
          const hangId = String(params.hang_id ?? "").trim();
          const action = params.action;
          if (!hangId || !isDecision(action)) {
            return {
              content: [{ type: "text" as const, text: "Error: hang_id and action (kill|wait|bg) required" }],
              details: { error: "invalid_args" },
            };
          }
          const hang = broker.getParked(hangId);
          if (!hang || hang.userId !== userId || hang.agentId !== agentId) {
            return {
              content: [{ type: "text" as const, text: `Error: hang_id not found or not owned: ${hangId}` }],
              details: { error: "missing" },
            };
          }

          if (action === "kill") {
            broker.decide(hangId, "kill");
            const tail = hang.outputTail.trim();
            return {
              content: [
                {
                  type: "text" as const,
                  text:
                    `Stopped hung shell process.\n` +
                    (tail ? `Output tail:\n${tail.slice(-2000)}` : "(no output)"),
                },
              ],
              details: { action: "kill", hang_id: hangId },
            };
          }

          if (action === "bg") {
            broker.decide(hangId, "bg");
            return {
              content: [
                {
                  type: "text" as const,
                  text:
                    `Left process running in the background (pid ${hang.pid}). ` +
                    `It will not block this turn. You will not get an automatic completion notice; ` +
                    `prefer bg_run for long jobs next time.`,
                },
              ],
              details: { action: "bg", hang_id: hangId, pid: hang.pid },
            };
          }

          // wait
          const result = await broker.waitMore(hangId, idleMs, signal);
          if (result.kind === "missing") {
            return {
              content: [{ type: "text" as const, text: `Error: hang_id gone: ${hangId}` }],
              details: { error: "missing" },
            };
          }
          if (result.kind === "aborted") {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Wait aborted.\n${result.outputTail.trim() || "(no output)"}`,
                },
              ],
              details: { action: "wait", status: "aborted" },
            };
          }
          if (result.kind === "exited") {
            const tail = result.outputTail.trim();
            return {
              content: [
                {
                  type: "text" as const,
                  text:
                    `Process exited with code ${result.exitCode ?? "?"}.\n` +
                    (tail ? tail.slice(-4000) : "(no output)"),
                },
              ],
              details: {
                action: "wait",
                status: "exited",
                exit_code: result.exitCode,
              },
            };
          }
          // idle again
          return {
            content: [{ type: "text" as const, text: formatHangHint(result.hang) }],
            details: { action: "wait", status: "idle", hang_id: result.hang.id },
          };
        },
      }),
    );
  };
}
