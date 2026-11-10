import { execFileSync } from "node:child_process";

/** 从本机 preview_url 解析 TCP 端口；非法或不含端口则 null。 */
export function parsePreviewPort(previewUrl: string): number | null {
  try {
    const parsed = new URL(previewUrl);
    if (parsed.port) {
      const port = Number(parsed.port);
      return Number.isInteger(port) && port > 0 && port <= 65535 ? port : null;
    }
    if (parsed.protocol === "http:") return 80;
    if (parsed.protocol === "https:") return 443;
    return null;
  } catch {
    return null;
  }
}

/**
 * 查本机某 TCP 端口当前 LISTEN 进程 pid（darwin/linux: lsof；win: netstat）。
 * 仅用于预览启停冲突检测；查不到返回 null。
 */
export function findTcpListenPid(port: number): number | null {
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  try {
    if (process.platform === "win32") {
      const out = execFileSync("netstat", ["-ano", "-p", "TCP"], {
        encoding: "utf8",
        windowsHide: true,
      });
      const re = new RegExp(
        String.raw`(?:0\.0\.0\.0|127\.0\.0\.1|\[::1\]|\[::\]):${port}\s+\S+\s+LISTENING\s+(\d+)`,
        "i",
      );
      const match = out.match(re);
      const pid = match ? Number(match[1]) : NaN;
      return Number.isInteger(pid) && pid > 0 ? pid : null;
    }
    const out = execFileSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], {
      encoding: "utf8",
    })
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    const pid = Number(out[0]);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

/** 向 pid 发 SIGTERM；失败忽略（进程可能已退出）。 */
export function terminatePid(pid: number): void {
  if (!Number.isInteger(pid) || pid <= 0) return;
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    // ESRCH 等
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 等到端口空闲或超时。 */
export async function waitUntilPortFree(port: number, timeoutMs = 2000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!findTcpListenPid(port)) return true;
    await sleep(80);
  }
  return !findTcpListenPid(port);
}

/** 等到端口出现监听进程或超时。 */
export async function waitForListenPid(
  port: number,
  timeoutMs = 4000,
  isAborted?: () => boolean,
): Promise<number | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (isAborted?.()) return null;
    const pid = findTcpListenPid(port);
    if (pid) return pid;
    await sleep(100);
  }
  return findTcpListenPid(port);
}
