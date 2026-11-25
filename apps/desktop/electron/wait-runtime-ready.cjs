/**
 * 等本进程拉起的 runtime /health 就绪。
 *
 * Windows 打包态冷启动（Defender 扫 node_modules、ELECTRON_RUN_AS_NODE 首次加载）
 * 常超过旧的 8s 门闩 → fetch failed → UI 仍开窗 →「本机 runtime 没有启动」。
 * 子进程其实还在加载，稍后会 listening。
 */

/** 非 Windows / 开发态默认窗口；可用 AGENTUP_RUNTIME_READY_MS 覆盖。 */
const DEFAULT_READY_MS = 30_000;
/** Win 打包冷启动实测可 >8s；给足余量，热启动仍会早返回。 */
const WIN_PACKAGED_READY_MS = 60_000;
const POLL_MS = 150;
const OWN_PROCESS_CONFIRM_MS = 800;

/**
 * @param {{
 *   platform?: NodeJS.Platform;
 *   packaged?: boolean;
 *   env?: NodeJS.ProcessEnv;
 * }} [options]
 * @returns {number}
 */
function runtimeReadyDeadlineMs(options = {}) {
  const env = options.env ?? process.env;
  const raw = env.AGENTUP_RUNTIME_READY_MS;
  if (typeof raw === "string" && raw.trim()) {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return Math.floor(n);
  }
  const platform = options.platform ?? process.platform;
  if (platform === "win32" && options.packaged) return WIN_PACKAGED_READY_MS;
  return DEFAULT_READY_MS;
}

/**
 * @param {{
 *   runtimeUrl: string;
 *   runtimePort: string | number;
 *   isProcessExited: () => boolean;
 *   getExitCode: () => number | null;
 *   packaged: boolean;
 *   platform?: NodeJS.Platform;
 *   deadlineMs?: number;
 *   fetchImpl?: typeof fetch;
 *   sleep?: (ms: number) => Promise<void>;
 *   now?: () => number;
 *   expectedBackendUrl?: string;
 *   logError?: (msg: string) => void;
 * }} options
 * @returns {Promise<boolean>}
 */
async function waitForOwnRuntime(options) {
  const fetchImpl = options.fetchImpl ?? fetch.bind(globalThis);
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const now = options.now ?? Date.now;
  const logError = options.logError ?? (() => {});
  const port = options.runtimePort;
  const deadlineMs =
    options.deadlineMs ??
    runtimeReadyDeadlineMs({ platform: options.platform, packaged: options.packaged });
  const started = now();
  const deadline = started + deadlineMs;
  let lastError = "";

  while (now() < deadline) {
    if (options.isProcessExited()) {
      lastError = `spawn 已退出 code=${options.getExitCode() ?? "null"}（若为 EADDRINUSE，请先退出占用 127.0.0.1:${port} 的旧 AgentUp/runtime）`;
      break;
    }
    try {
      const response = await fetchImpl(`${options.runtimeUrl}/health`);
      if (response.ok) {
        // EADDRINUSE 时旧进程仍会响应 health；多等一会确认子进程没有随后退出。
        await sleep(OWN_PROCESS_CONFIRM_MS);
        if (options.isProcessExited()) {
          lastError = `spawn 已退出 code=${options.getExitCode() ?? "null"}（端口 ${port} 被其他 AgentUp/runtime 占用）`;
          break;
        }
        // 开发态核对 health.backendUrl（勿再打 /auth/turnstile：runtime 无此路由，会对正式 API 误杀）
        if (!options.packaged) {
          const expectedBackend = (options.expectedBackendUrl || "").replace(/\/$/, "");
          if (expectedBackend) {
            let health;
            try {
              health = await response.json();
            } catch (error) {
              lastError = error instanceof Error ? error.message : String(error);
              break;
            }
            const got = String(health?.backendUrl ?? health?.backend_url ?? "").replace(/\/$/, "");
            if (got !== expectedBackend) {
              lastError = `runtime 连的不是 ${expectedBackend}（health.backendUrl=${got || "缺失"}；可能仍是占用端口的正式版 AgentUp）`;
              break;
            }
          }
        }
        return true;
      }
      lastError = `status=${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await sleep(POLL_MS);
  }
  if (lastError) {
    const waited = Math.max(0, now() - started);
    logError(
      `runtime health 最后错误：${lastError}（已等 ${waited}ms / 上限 ${deadlineMs}ms；Win 冷启动慢属常见，勿只当 EADDRINUSE）`,
    );
  }
  return false;
}

module.exports = {
  runtimeReadyDeadlineMs,
  waitForOwnRuntime,
  DEFAULT_READY_MS,
  WIN_PACKAGED_READY_MS,
};
