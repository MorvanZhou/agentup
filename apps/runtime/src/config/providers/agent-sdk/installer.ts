import { randomUUID } from "node:crypto";
import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { ConfigError } from "../../load.js";
import { getProviderTemplate } from "../../provider-templates.js";
import { setAgentSdkState } from "../../provider/index.js";
import { killProcessTree } from "../../../session/hitl/shell-hang/process-kill.js";

/**
 * 本地 SDK 安装器（阶段 1）。
 *
 * 稳定性优先的三条：
 * 1. 只装进 runtime 自管目录 `<userDataRoot>/agent-sdks/<templateId>`，不碰 App 安装目录；
 * 2. 用 runtime 自己的 Node 跑 npm-cli.js，不依赖用户 PATH 上的 npm / node；
 * 3. 先在临时目录构建 → 自检 → 原子 rename，任何失败都删临时目录回滚。
 */

export type InstallPhase =
  | "resolving"
  | "downloading"
  | "verifying"
  | "finalizing"
  | "done"
  | "failed"
  | "cancelled";

export interface InstallJobView {
  job_id: string;
  template_id: string;
  phase: InstallPhase;
  detail?: string;
  error?: string;
}

interface InstallJob extends Omit<InstallJobView, "job_id"> {
  jobId: string;
  userDataRoot: string;
  packageName: string;
  spec: string;
  /** 与 spec 一并 npm install 的额外包 */
  companionSpecs: string[];
  child?: ChildProcess;
  tmpDir?: string;
  /** npm 输出尾部，失败时带到错误里，不然只能看到退出码 */
  npmTail?: string;
}

const jobs = new Map<string, InstallJob>();

export function agentSdkDir(userDataRoot: string, templateId: string): string {
  return path.join(userDataRoot, "agent-sdks", templateId);
}

/** 已安装包的信息；拿不到就是没装好。 */
export function readInstalledSdk(
  installPath: string,
  packageName: string,
): { version: string; cliPath?: string } | null {
  const manifest = path.join(installPath, "node_modules", packageName, "package.json");
  if (!fs.existsSync(manifest)) return null;
  try {
    const pkg = JSON.parse(fs.readFileSync(manifest, "utf8")) as { version?: string };
    if (!pkg.version) return null;
    const cliPath = path.join(installPath, "node_modules", packageName, "cli", "bin", "codebuddy");
    return { version: pkg.version, ...(fs.existsSync(cliPath) ? { cliPath } : {}) };
  } catch {
    return null;
  }
}

/**
 * 定位 npm：一律「当前 Node（含 ELECTRON_RUN_AS_NODE）+ npm-cli.js」。
 *
 * Windows 上 Node ≥20.12 直接 spawn `.cmd`/`.bat` 会 EINVAL（CVE-2024-27980），
 * 因此禁止把 `npm.cmd` 当作 command；打包 Electron 旁也没有附带 npm，需从 PATH 上的
 * Node 安装目录反查 `node_modules/npm/bin/npm-cli.js`。
 *
 * `npm_execpath` 不可信——被 pnpm / yarn 拉起时可能指向 pnpm.cjs，
 * 只有确认为 npm-cli.js 时才用。
 */
export type NpmRunner = { command: string; args: string[] };

export function resolveNpmRunner(options?: {
  platform?: NodeJS.Platform;
  execPath?: string;
  env?: NodeJS.ProcessEnv;
  existsSync?: (filePath: string) => boolean;
}): NpmRunner | null {
  const platform = options?.platform ?? process.platform;
  const execPath = options?.execPath ?? process.execPath;
  const env = options?.env ?? process.env;
  const exists = options?.existsSync ?? ((filePath: string) => fs.existsSync(filePath));
  const execDir = path.dirname(execPath);

  const bundled = [
    path.join(execDir, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
    path.join(execDir, "node_modules", "npm", "bin", "npm-cli.js"),
  ];
  for (const candidate of bundled) {
    if (exists(candidate)) return { command: execPath, args: [candidate] };
  }

  const fromEnv = env.npm_execpath;
  if (fromEnv && /npm-cli\.js$/i.test(fromEnv) && exists(fromEnv)) {
    return { command: execPath, args: [fromEnv] };
  }

  const pathDirs = (env.PATH ?? "").split(path.delimiter).filter(Boolean);
  const npmCliBeside = (dir: string): string | null => {
    const cli = path.join(dir, "node_modules", "npm", "bin", "npm-cli.js");
    return exists(cli) ? cli : null;
  };

  if (platform === "win32") {
    // 优先 node.exe 同目录的官方布局；再扫 npm.cmd 同目录（勿直接 spawn .cmd）
    for (const name of ["node.exe", "npm.cmd"] as const) {
      for (const dir of pathDirs) {
        if (!exists(path.join(dir, name))) continue;
        const cli = npmCliBeside(dir);
        if (cli) return { command: execPath, args: [cli] };
      }
    }
    return null;
  }

  for (const dir of pathDirs) {
    const cli = npmCliBeside(dir);
    if (cli) return { command: execPath, args: [cli] };
  }
  // Unix 兜底：PATH 上的 npm shell 脚本可直接 spawn（非 .cmd）
  const onPath = findOnPath("npm", env, exists);
  if (onPath) return { command: onPath, args: [] };
  return null;
}

function findOnPath(
  name: string,
  env: NodeJS.ProcessEnv = process.env,
  exists: (filePath: string) => boolean = (filePath) => fs.existsSync(filePath),
): string | null {
  for (const dir of (env.PATH ?? "").split(path.delimiter).filter(Boolean)) {
    const candidate = path.join(dir, name);
    if (exists(candidate)) return candidate;
  }
  return null;
}

/** 只保留可打印内容并截断，避免 npm 输出刷爆 UI 与日志。 */
function sanitizeTail(text: string, limit = 600): string {
  const cleaned = text
    .replace(/\u001b\[[0-9;]*[A-Za-z]/g, "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length > limit ? `…${cleaned.slice(-limit)}` : cleaned;
}

export function startAgentSdkInstall(
  userDataRoot: string,
  templateId: string,
  /** 覆盖安装 spec（重装指定版本 / 测试用轻量包） */
  specOverride?: string,
): string {
  const template = getProviderTemplate(templateId);
  const profile = template?.agentSdk;
  if (!template || template.access !== "agent-sdk" || !profile) {
    throw new ConfigError("该接入方式不支持本地接入");
  }
  const spec = specOverride?.trim() || profile.spec;
  const packageName = packageNameFromSpec(spec) ?? profile.package;
  const companionSpecs = (profile.companionSpecs ?? [])
    .map((item) => item.trim())
    .filter(Boolean);
  if (readInstalledSdk(agentSdkDir(userDataRoot, templateId), profile.package)) {
    throw new ConfigError("已经接入过了");
  }
  const runner = resolveNpmRunner();
  if (!runner) throw new ConfigError("本机没有可用的 npm（未找到 npm-cli.js），无法自动接入。请先安装 Node.js 并确保已加入 PATH");

  const jobId = randomUUID();
  const tmpDir = path.join(userDataRoot, "agent-sdks", `.tmp-${templateId}-${jobId.slice(0, 8)}`);
  const job: InstallJob = {
    jobId,
    template_id: templateId,
    userDataRoot,
    packageName,
    spec,
    companionSpecs,
    phase: "resolving",
    tmpDir,
  };
  jobs.set(jobId, job);
  setAgentSdkState(userDataRoot, templateId, "installing");
  void runInstall(job, runner);
  return jobId;
}

async function runInstall(
  job: InstallJob,
  runner: { command: string; args: string[] },
): Promise<void> {
  const target = agentSdkDir(job.userDataRoot, job.template_id);
  try {
    fs.mkdirSync(job.tmpDir!, { recursive: true });
    // 给它一个独立的 package.json + cwd：避免继承上层工作区（pnpm workspace / .npmrc / lockfile）
    fs.writeFileSync(
      path.join(job.tmpDir!, "package.json"),
      `${JSON.stringify({ name: "agentup-agent-sdk", version: "1.0.0", private: true }, null, 2)}\n`,
    );
    job.phase = "downloading";
    job.detail = "正在下载";

    // 用 runtime 自己的 Node 跑 npm，PATH 里前置它的目录，避免原生模块错配
    const execDir = path.dirname(runner.command);
    const env = {
      ...process.env,
      PATH: `${execDir}${path.delimiter}${process.env.PATH ?? ""}`,
      npm_config_audit: "false",
      npm_config_fund: "false",
      // 被 GUI 拉起时 HOME 可能缺失，npm 找缓存会失败
      ...(process.env.HOME ? {} : { HOME: os.homedir() }),
    };

    const code = await new Promise<number | null>((resolve, reject) => {
      // companionSpecs：同一前缀再装薄客户端等（如 OpenCode CLI + @opencode-ai/sdk）
      const child = spawn(
        runner.command,
        [
          ...runner.args,
          "install",
          "--prefix",
          job.tmpDir!,
          job.spec,
          ...job.companionSpecs,
          "--no-audit",
          "--no-fund",
        ],
        { env, cwd: job.tmpDir!, stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
      );
      job.child = child;
      let tail = "";
      const onChunk = (chunk: Buffer): void => {
        tail = `${tail}${chunk.toString("utf8")}`.slice(-4000);
        // 进度：把 npm 最后一行有意义的输出带上，便于排查
        const line = sanitizeTail(tail, 120);
        if (line) job.detail = line;
      };
      child.stdout?.on("data", onChunk);
      child.stderr?.on("data", onChunk);
      child.on("error", (error) => {
        // Windows 误 spawn .cmd 时常见 EINVAL；统一成可读接入错误
        reject(
          new ConfigError(
            `接入失败（无法启动 npm：${error instanceof Error ? error.message : String(error)}）`,
          ),
        );
      });
      child.on("close", (exit) => {
        job.child = undefined;
        job.npmTail = sanitizeTail(tail);
        resolve(exit);
      });
    });

    // phase 可能被 cancel 从外部改写，这里必须重新读，不能信 TS 的窄化
    if ((job.phase as InstallPhase) === "cancelled") return;
    if (code !== 0) {
      throw new ConfigError(
        job.npmTail ? `接入失败（npm 退出码 ${code}）：${job.npmTail}` : `接入失败（npm 退出码 ${code}）`,
      );
    }

    job.phase = "verifying";
    const installed = readInstalledSdk(job.tmpDir!, job.packageName);
    if (!installed) throw new ConfigError("接入完成但未找到包，已回滚");

    job.phase = "finalizing";
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
    fs.renameSync(job.tmpDir!, target);
    job.tmpDir = undefined;

    setAgentSdkState(job.userDataRoot, job.template_id, "installed", {
      installedVersion: installed.version,
    });
    job.phase = "done";
    job.detail = `已接入 ${installed.version}`;
  } catch (error) {
    if ((job.phase as InstallPhase) === "cancelled") return;
    const message = error instanceof Error ? error.message : "接入失败";
    job.phase = "failed";
    job.error = message;
    cleanupTmp(job);
    setAgentSdkState(job.userDataRoot, job.template_id, "install_failed", { lastError: message });
  }
}

export function readInstallJob(jobId: string): InstallJobView {
  const job = jobs.get(jobId);
  if (!job) throw new ConfigError("安装任务不存在");
  return {
    job_id: job.jobId,
    template_id: job.template_id,
    phase: job.phase,
    ...(job.detail ? { detail: job.detail } : {}),
    ...(job.error ? { error: job.error } : {}),
  };
}

export function cancelAgentSdkInstall(jobId: string): void {
  const job = jobs.get(jobId);
  if (!job) throw new ConfigError("安装任务不存在");
  job.phase = "cancelled";
  if (job.child?.pid) killProcessTree(job.child.pid);
  job.child = undefined;
  cleanupTmp(job);
  setAgentSdkState(job.userDataRoot, job.template_id, "not_installed");
}

/** 卸载：删目录 + 清状态；目录是自管的，删它不会碰到用户项目。 */
export function uninstallAgentSdk(userDataRoot: string, templateId: string): void {
  const template = getProviderTemplate(templateId);
  if (!template || template.access !== "agent-sdk") throw new ConfigError("未知的服务商");
  const target = agentSdkDir(userDataRoot, templateId);
  if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
  for (const [jobId, job] of jobs) {
    if (job.template_id === templateId && job.phase !== "done") {
      cancelAgentSdkInstall(jobId);
    }
  }
  setAgentSdkState(userDataRoot, templateId, "not_installed");
}

/** `@scope/pkg@1.2.3` → `@scope/pkg`；`pkg` → `pkg`。 */
function packageNameFromSpec(spec: string): string | null {
  const trimmed = spec.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("@")) {
    const slash = trimmed.indexOf("/");
    if (slash < 0) return null;
    const at = trimmed.indexOf("@", slash);
    return at > 0 ? trimmed.slice(0, at) : trimmed;
  }
  const at = trimmed.indexOf("@");
  return at > 0 ? trimmed.slice(0, at) : trimmed;
}

function cleanupTmp(job: InstallJob): void {
  if (!job.tmpDir) return;
  try {
    fs.rmSync(job.tmpDir, { recursive: true, force: true });
  } catch {
    /* 清理失败不阻塞主流程 */
  }
  job.tmpDir = undefined;
}
