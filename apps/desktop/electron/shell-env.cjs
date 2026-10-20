/**
 * 解析用户 login shell 环境（仿 VS Code resolveShellEnv）。
 * 打包后从 Finder 启动时 launchd PATH 不含 nvm/Homebrew；采一次后注入 runtime，
 * 使 bash 工具能找到本机 node / git 等。
 */
const { spawn } = require("node:child_process");
const { randomBytes } = require("node:crypto");
const path = require("node:path");

const DEFAULT_TIMEOUT_MS = 10_000;

/** @type {Promise<Record<string, string>> | undefined} */
let cachedPromise;

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @param {NodeJS.Platform} [platform]
 */
function shouldResolveShellEnv(env = process.env, platform = process.platform) {
  if (env.AGENTUP_FORCE_DISABLE_USER_ENV === "1") return false;
  if (platform === "win32") return false;
  // 已从终端启动（PATH 通常已含 nvm 等）；可用 AGENTUP_FORCE_USER_ENV=1 强制再采
  if (env.AGENTUP_CLI === "1" && env.AGENTUP_FORCE_USER_ENV !== "1") return false;
  return true;
}

/**
 * 将 shell 采到的变量合并进 base：PATH 等以 shell 为准；保留 base 里已有的 AGENTUP_* / ELECTRON_*。
 * @param {NodeJS.ProcessEnv} base
 * @param {Record<string, string>} shell
 * @returns {NodeJS.ProcessEnv}
 */
function mergeShellEnv(base, shell) {
  const out = { ...base };
  for (const [key, value] of Object.entries(shell)) {
    if (typeof value !== "string") continue;
    if (key === "XDG_RUNTIME_DIR") continue;
    if (
      (key.startsWith("AGENTUP_") || key.startsWith("ELECTRON_")) &&
      Object.prototype.hasOwnProperty.call(base, key) &&
      base[key] !== undefined
    ) {
      continue;
    }
    out[key] = value;
  }
  return out;
}

/**
 * @param {string} raw
 * @param {string} mark
 * @returns {Record<string, string>}
 */
function parseMarkedEnv(raw, mark) {
  const escaped = mark.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`${escaped}(\\{.*\\})${escaped}`, "s").exec(raw);
  if (!match) return {};
  const parsed = JSON.parse(match[1]);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  /** @type {Record<string, string>} */
  const out = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value === "string") out[key] = value;
  }
  return out;
}

/**
 * @param {{
 *   env?: NodeJS.ProcessEnv;
 *   platform?: NodeJS.Platform;
 *   execPath?: string;
 *   timeoutMs?: number;
 *   spawnFn?: typeof spawn;
 *   logInfo?: (msg: string) => void;
 *   logError?: (msg: string) => void;
 * }} [options]
 * @returns {Promise<Record<string, string>>}
 */
function resolveUserShellEnv(options = {}) {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const logInfo = options.logInfo ?? (() => undefined);
  const logError = options.logError ?? (() => undefined);

  if (!shouldResolveShellEnv(env, platform)) {
    logInfo(
      `shell-env: skipped (platform=${platform} cli=${env.AGENTUP_CLI === "1" ? "1" : "0"} disable=${env.AGENTUP_FORCE_DISABLE_USER_ENV === "1" ? "1" : "0"})`,
    );
    return Promise.resolve({});
  }

  if (!cachedPromise) {
    cachedPromise = doResolveUnixShellEnv({
      env,
      platform,
      execPath: options.execPath ?? process.execPath,
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      spawnFn: options.spawnFn ?? spawn,
      logInfo,
      logError,
    }).catch((error) => {
      logError(`shell-env: 解析失败：${error instanceof Error ? error.message : String(error)}`);
      return {};
    });
  }
  return cachedPromise;
}

function resetShellEnvCache() {
  cachedPromise = undefined;
}

/**
 * @param {{
 *   env: NodeJS.ProcessEnv;
 *   platform: NodeJS.Platform;
 *   execPath: string;
 *   timeoutMs: number;
 *   spawnFn: typeof spawn;
 *   logInfo: (msg: string) => void;
 *   logError: (msg: string) => void;
 * }} opts
 */
function doResolveUnixShellEnv(opts) {
  const mark = randomBytes(6).toString("hex");
  const shell = resolveSystemShell(opts.env, opts.platform);
  const shellName = path.basename(shell);

  const childEnv = {
    ...opts.env,
    ELECTRON_RUN_AS_NODE: "1",
    ELECTRON_NO_ATTACH_CONSOLE: "1",
    AGENTUP_RESOLVING_ENVIRONMENT: "1",
  };

  let command;
  /** @type {string[]} */
  let shellArgs;
  if (/^(?:pwsh|powershell)(?:-preview)?$/.test(shellName)) {
    command = `& '${opts.execPath}' -p '''${mark}'' + JSON.stringify(process.env) + ''${mark}'''`;
    shellArgs = ["-Login", "-Command"];
  } else if (shellName === "nu") {
    command = `^'${opts.execPath}' -p '"${mark}" + JSON.stringify(process.env) + "${mark}"'`;
    shellArgs = ["-i", "-l", "-c"];
  } else if (shellName === "xonsh") {
    command = `import os, json; print("${mark}", json.dumps(dict(os.environ)), "${mark}")`;
    shellArgs = ["-i", "-l", "-c"];
  } else if (shellName === "tcsh" || shellName === "csh") {
    command = `'${opts.execPath}' -p '"${mark}" + JSON.stringify(process.env) + "${mark}"'`;
    shellArgs = ["-ic"];
  } else {
    command = `'${opts.execPath}' -p '"${mark}" + JSON.stringify(process.env) + "${mark}"'`;
    shellArgs = ["-i", "-l", "-c"];
  }

  opts.logInfo(`shell-env: resolving shell=${shell} args=${shellArgs.join(" ")}`);
  const started = Date.now();

  return new Promise((resolve) => {
    /** @type {import("node:child_process").ChildProcess | null} */
    let child = null;
    let settled = false;
    const finish = (/** @type {Record<string, string>} */ value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };

    const timer = setTimeout(() => {
      opts.logError(`shell-env: 超时 ${opts.timeoutMs}ms`);
      try {
        child?.kill();
      } catch {
        // ignore
      }
      finish({});
    }, opts.timeoutMs);

    try {
      child = opts.spawnFn(shell, [...shellArgs, command], {
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
        env: childEnv,
      });
    } catch (error) {
      opts.logError(`shell-env: spawn 失败：${error instanceof Error ? error.message : String(error)}`);
      finish({});
      return;
    }

    const stdoutChunks = [];
    const stderrChunks = [];
    child.stdout?.on("data", (chunk) => stdoutChunks.push(chunk));
    child.stderr?.on("data", (chunk) => stderrChunks.push(chunk));

    child.on("error", (error) => {
      opts.logError(`shell-env: 子进程错误：${error.message}`);
      finish({});
    });

    child.on("close", (code, signal) => {
      const raw = Buffer.concat(stdoutChunks).toString("utf8");
      const stderr = Buffer.concat(stderrChunks).toString("utf8").trim();
      if (stderr) opts.logInfo(`shell-env: stderr ${stderr.slice(0, 500)}`);

      if (code || signal) {
        opts.logError(`shell-env: 异常退出 code=${code ?? "null"} signal=${signal ?? "null"}`);
        finish({});
        return;
      }

      try {
        const parsed = parseMarkedEnv(raw, mark);
        delete parsed.ELECTRON_RUN_AS_NODE;
        delete parsed.ELECTRON_NO_ATTACH_CONSOLE;
        delete parsed.AGENTUP_RESOLVING_ENVIRONMENT;
        delete parsed.XDG_RUNTIME_DIR;
        const pathPreview = parsed.PATH ? parsed.PATH.split(":").slice(0, 5).join(":") : "";
        opts.logInfo(
          `shell-env: ok in ${Date.now() - started}ms keys=${Object.keys(parsed).length} PATH≈${pathPreview}`,
        );
        finish(parsed);
      } catch (error) {
        opts.logError(`shell-env: 解析 JSON 失败：${error instanceof Error ? error.message : String(error)}`);
        finish({});
      }
    });
  });
}

/**
 * @param {NodeJS.ProcessEnv} env
 * @param {NodeJS.Platform} platform
 */
function resolveSystemShell(env, platform) {
  const fromEnv = typeof env.SHELL === "string" ? env.SHELL.trim() : "";
  if (fromEnv) return fromEnv;
  if (platform === "darwin") return "/bin/zsh";
  return "/bin/bash";
}

module.exports = {
  shouldResolveShellEnv,
  mergeShellEnv,
  parseMarkedEnv,
  resolveUserShellEnv,
  resetShellEnvCache,
  DEFAULT_TIMEOUT_MS,
};
