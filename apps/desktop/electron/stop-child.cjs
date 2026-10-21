/**
 * 停掉 spawn 出的子进程：先 SIGTERM，超时 SIGKILL。
 * 供 Desktop 退出时清理 runtime，避免孤儿占端口。
 *
 * @param {import("node:child_process").ChildProcess | null | undefined} child
 * @param {{
 *   forceMs?: number;
 *   hardMs?: number;
 *   logInfo?: (msg: string) => void;
 *   logError?: (msg: string) => void;
 *   setTimeoutFn?: typeof setTimeout;
 *   clearTimeoutFn?: typeof clearTimeout;
 * }} [options]
 * @returns {Promise<void>}
 */
function stopChildProcess(child, options = {}) {
  const forceMs = options.forceMs ?? 1500;
  const hardMs = options.hardMs ?? forceMs + 500;
  const logInfo = options.logInfo ?? (() => {});
  const logError = options.logError ?? (() => {});
  const setTimeoutFn = options.setTimeoutFn ?? setTimeout;
  const clearTimeoutFn = options.clearTimeoutFn ?? clearTimeout;

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
    const forceTimer = setTimeoutFn(() => {
      try {
        if (childAlive(child) && child.pid) {
          child.kill("SIGKILL");
          logInfo(`stop child pid=${child.pid} SIGKILL`);
        }
      } catch (error) {
        logError(`child SIGKILL 失败：${error instanceof Error ? error.message : String(error)}`);
        finish();
      }
    }, forceMs);
    const hardTimer = setTimeoutFn(finish, hardMs);
    try {
      child.kill("SIGTERM");
      logInfo(`stop child pid=${child.pid ?? "?"} SIGTERM`);
    } catch (error) {
      logError(`child SIGTERM 失败：${error instanceof Error ? error.message : String(error)}`);
      finish();
    }
  });
}

/** @param {import("node:child_process").ChildProcess} child */
function childAlive(child) {
  return child.exitCode === null && child.signalCode === null;
}

module.exports = { stopChildProcess, childAlive };
