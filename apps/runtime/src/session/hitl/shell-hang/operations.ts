import { constants } from "node:fs";
import { access as fsAccess } from "node:fs/promises";
import { spawn, type ChildProcess } from "node:child_process";
import os from "node:os";

import type { BashOperations } from "@earendil-works/pi-coding-agent";
import { getShellConfig, getPowerShellConfig } from "@earendil-works/pi-coding-agent";

import { killProcessTree } from "./process-kill.js";

/** 空闲无输出超过此时长 → park，让 agent 裁决。 */
export const SHELL_HANG_IDLE_MS = 12_000;

/** ops 返回此退出码表示「已空闲拆出」；extension 据此改写 tool_result。 */
export const SHELL_HANG_IDLE_EXIT = 124;

export type IdleParkContext = {
  command: string;
  cwd: string;
  child: ChildProcess;
  startedAt: number;
};

export type IdleAwareOperationsOptions = {
  shell: "bash" | "powershell";
  idleMs?: number;
  /** 返回 hang id；调用方负责登记 broker.park。 */
  onIdlePark: (ctx: IdleParkContext) => string;
};

function resolveTimeoutMs(timeout: number | undefined): number | undefined {
  if (timeout === undefined) return undefined;
  if (!Number.isFinite(timeout) || timeout <= 0) {
    throw new Error("Invalid timeout: must be a finite number of seconds");
  }
  return timeout * 1000;
}

function waitClose(child: ChildProcess): Promise<number | null> {
  return new Promise((resolve, reject) => {
    child.once("error", (err) => reject(err));
    child.once("close", (code) => resolve(code));
  });
}

/**
 * 带空闲拆出的本地 shell operations（覆盖 Pi 内置 bash/powershell）。
 * 连续 idleMs 无 stdout/stderr → 不杀进程，resolve exit 124，由 broker park。
 */
export function createIdleAwareShellOperations(
  options: IdleAwareOperationsOptions,
): BashOperations {
  const idleMs = options.idleMs ?? SHELL_HANG_IDLE_MS;
  const shellName = options.shell;

  return {
    exec: async (command, cwd, { onData, signal, timeout, env }) => {
      const timeoutMs = resolveTimeoutMs(timeout);
      if (signal?.aborted) throw new Error("aborted");

      try {
        await fsAccess(cwd, constants.F_OK);
      } catch {
        throw new Error(
          `Working directory does not exist: ${cwd}\nCannot execute ${shellName} commands.`,
        );
      }

      const shellConfig =
        shellName === "powershell" ? getPowerShellConfig() : getShellConfig();
      const commandFromStdin = shellConfig.commandTransport === "stdin";
      const startedAt = Date.now();
      const child = spawn(
        shellConfig.shell,
        commandFromStdin ? shellConfig.args : [...shellConfig.args, command],
        {
          cwd,
          detached: process.platform !== "win32",
          env: env ?? { ...process.env },
          stdio: [commandFromStdin ? "pipe" : "ignore", "pipe", "pipe"],
          windowsHide: true,
        },
      );
      if (commandFromStdin) {
        child.stdin?.on("error", () => {});
        child.stdin?.end(command);
      }

      let timedOut = false;
      let parked = false;
      let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
      let idleHandle: ReturnType<typeof setTimeout> | undefined;

      const clearIdle = () => {
        if (idleHandle) clearTimeout(idleHandle);
        idleHandle = undefined;
      };

      const armIdle = () => {
        clearIdle();
        idleHandle = setTimeout(() => {
          if (parked || timedOut || signal?.aborted) return;
          parked = true;
          clearIdle();
          try {
            options.onIdlePark({ command, cwd, child, startedAt });
          } catch {
            // park 失败则回退为杀进程超时
            parked = false;
            if (child.pid) killProcessTree(child.pid);
          }
        }, idleMs);
      };

      const onAbort = () => {
        if (parked) return; // 已拆出，abort 不再杀（由 decide/dispose 负责）
        if (child.pid) killProcessTree(child.pid);
      };

      try {
        if (timeoutMs !== undefined) {
          timeoutHandle = setTimeout(() => {
            timedOut = true;
            if (!parked && child.pid) killProcessTree(child.pid);
          }, timeoutMs);
        }

        const handleData = (data: Buffer) => {
          if (!parked) {
            onData(data);
            armIdle();
          }
        };
        child.stdout?.on("data", handleData);
        child.stderr?.on("data", handleData);
        armIdle();

        if (signal) {
          if (signal.aborted) onAbort();
          else signal.addEventListener("abort", onAbort, { once: true });
        }

        // 若已 park：立刻以 124 返回，不等 close
        const exitCode = await new Promise<number | null>((resolve, reject) => {
          const onParkPoll = setInterval(() => {
            if (parked) {
              clearInterval(onParkPoll);
              resolve(SHELL_HANG_IDLE_EXIT);
            }
          }, 20);
          waitClose(child)
            .then((code) => {
              clearInterval(onParkPoll);
              if (parked) resolve(SHELL_HANG_IDLE_EXIT);
              else resolve(code);
            })
            .catch((err) => {
              clearInterval(onParkPoll);
              reject(err);
            });
        });

        if (signal?.aborted && !parked) throw new Error("aborted");
        if (timedOut && !parked) throw new Error(`timeout:${timeout}`);
        if (parked) return { exitCode: SHELL_HANG_IDLE_EXIT };

        const signalCode = child.signalCode;
        return {
          exitCode:
            exitCode ??
            (signalCode
              ? 128 + ((os.constants.signals as Record<string, number>)[signalCode] ?? 0)
              : 1),
        };
      } finally {
        clearIdle();
        if (timeoutHandle) clearTimeout(timeoutHandle);
        if (signal) signal.removeEventListener("abort", onAbort);
        // park 后不在这里杀；未 park 且仍在跑时由 abort/timeout 已处理
      }
    },
  };
}
