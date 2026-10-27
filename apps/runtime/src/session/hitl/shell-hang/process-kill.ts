import { spawnSync } from "node:child_process";

/** 杀掉 pid 及其子树（Unix 优先进程组；Windows taskkill /T）。 */
export function killProcessTree(pid: number): void {
  if (!Number.isFinite(pid) || pid <= 0) return;
  if (process.platform === "win32") {
    try {
      spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], {
        windowsHide: true,
        timeout: 5_000,
      });
    } catch {
      // ignore
    }
    return;
  }
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // ignore
    }
  }
}
