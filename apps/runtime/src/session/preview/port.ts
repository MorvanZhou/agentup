import { execFileSync } from "node:child_process";
import path from "node:path";

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
      // System32\netstat（避开 Git PATH 伪命令）；中文系统状态列是「侦听」。
      // 勿在未命中时再 spawn powershell：waitUntilPortFree 会高频调用，PS 冷启会拖死测例。
      const netstat = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "netstat.exe");
      const out = execFileSync(netstat, ["-ano"], {
        encoding: "utf8",
        windowsHide: true,
      });
      for (const line of out.split(/\r?\n/)) {
        if (!/\bTCP\b/i.test(line)) continue;
        if (!/(?:LISTENING|侦听)/i.test(line)) continue;
        const cols = line.trim().split(/\s+/);
        // Proto LocalAddress ForeignAddress State PID
        if (cols.length < 5) continue;
        const local = cols[1] ?? "";
        // `127.0.0.1:PORT` / `0.0.0.0:PORT` / `[::1]:PORT` / `[::]:PORT`
        const localPort = local.includes("]:")
          ? Number(local.slice(local.lastIndexOf("]:") + 2))
          : Number(local.slice(local.lastIndexOf(":") + 1));
        if (localPort !== port) continue;
        const pid = Number(cols[cols.length - 1]);
        if (Number.isInteger(pid) && pid > 0) return pid;
      }
      return null;
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
