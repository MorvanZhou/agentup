/**
 * 停掉 spawn 出的子进程：先温和信号，超时再强杀。
 * 供 Desktop 退出时清理 runtime，避免孤儿占端口 / 锁住安装目录。
 *
 * Windows：打包态 runtime 是 ELECTRON_RUN_AS_NODE 的同名 AgentUp.exe，
 * `child.kill` 只打本 pid、不带进程树；改用 `taskkill /T`（必要时再 `/F`）。
 *
 * @param {import("node:child_process").ChildProcess | null | undefined} child
 * @param {{
 *   forceMs?: number;
 *   hardMs?: number;
 *   platform?: NodeJS.Platform;
 *   logInfo?: (msg: string) => void;
 *   logError?: (msg: string) => void;
 *   setTimeoutFn?: typeof setTimeout;
 *   clearTimeoutFn?: typeof clearTimeout;
 *   execFileFn?: (
 *     file: string,
 *     args: readonly string[],
 *     options: { windowsHide?: boolean; timeout?: number },
 *     callback: (error: Error | null) => void,
 *   ) => void;
 * }} [options]
 * @returns {Promise<void>}
 */
function stopChildProcess(child, options = {}) {
  const forceMs = options.forceMs ?? 1500;
  const hardMs = options.hardMs ?? forceMs + 500;
  const platform = options.platform ?? process.platform;
  const logInfo = options.logInfo ?? (() => {});
  const logError = options.logError ?? (() => {});
  const setTimeoutFn = options.setTimeoutFn ?? setTimeout;
  const clearTimeoutFn = options.clearTimeoutFn ?? clearTimeout;
  const execFileFn =
    options.execFileFn ??
    ((file, args, opts, callback) => {
      require("node:child_process").execFile(file, args, opts, (error) => callback(error));
    });

  return new Promise((resolve) => {
    if (!child || !childAlive(child)) {
      resolve();
      return;
    }
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeoutFn(forceTimer);
      clearTimeoutFn(hardTimer);
      resolve();
    };
    child.once("exit", finish);

    const winTreeKill = (force) => {
      if (!child.pid) return;
      const args = force ? ["/F", "/T", "/PID", String(child.pid)] : ["/T", "/PID", String(child.pid)];
      execFileFn("taskkill", args, { windowsHide: true, timeout: 8000 }, (error) => {
        // 进程已不在时 taskkill 非 0，当作成功
        if (error && childAlive(child)) {
          logError(
            `taskkill ${force ? "/F /T" : "/T"} pid=${child.pid} 失败：${error instanceof Error ? error.message : String(error)}`,
          );
        }
      });
      logInfo(`stop child pid=${child.pid} taskkill ${force ? "/F /T" : "/T"}`);
    };

    const forceTimer = setTimeoutFn(() => {
      try {
        if (!childAlive(child) || !child.pid) return;
        if (platform === "win32") {
          winTreeKill(true);
        } else {
          child.kill("SIGKILL");
          logInfo(`stop child pid=${child.pid} SIGKILL`);
        }
      } catch (error) {
        logError(`child 强杀失败：${error instanceof Error ? error.message : String(error)}`);
        finish();
      }
    }, forceMs);
    const hardTimer = setTimeoutFn(finish, hardMs);

    try {
      if (platform === "win32") {
        winTreeKill(false);
      } else {
        child.kill("SIGTERM");
        logInfo(`stop child pid=${child.pid ?? "?"} SIGTERM`);
      }
    } catch (error) {
      logError(`child 温和停止失败：${error instanceof Error ? error.message : String(error)}`);
      finish();
    }
  });
}

/** @param {import("node:child_process").ChildProcess} child */
function childAlive(child) {
  return child.exitCode === null && child.signalCode === null;
}

module.exports = { stopChildProcess, childAlive };
