import { randomUUID } from "node:crypto";
import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { ConfigError } from "../../load.js";
import { resolveNpmRunner, type NpmRunner } from "../../npm-runner.js";
import { getProviderTemplate, listAgentSdkTemplates } from "../../provider-templates.js";
import { agentSdkStateOf, setAgentSdkState } from "../../provider/agent-sdk-state.js";
import { readStored } from "../../provider/store.js";
import { killProcessTree } from "../../../session/hitl/shell-hang/process-kill.js";
import { disposeAgentSdkRuntimesForTemplate } from "../../../session/external/sdk/host/runtime-pool.js";

export { resolveNpmRunner, type NpmRunner };

/**
 * 本地 SDK 安装器（阶段 1）。
 *
 * 稳定性优先的三条：
 * 1. 只装进 runtime 自管目录 `<userDataRoot>/agent-sdks/<templateId>`，不碰 App 安装目录；
 * 2. 用 runtime 自己的 Node 跑 npm-cli.js（打包态优先 Desktop afterPack 注入的钉版 npm）；
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
  /** cancel 后仍记下路径，等 npm 退出再清（Win EBUSY） */
  lastTmpDir?: string;
  /** npm 输出尾部，失败时带到错误里，不然只能看到退出码 */
  npmTail?: string;
}

const jobs = new Map<string, InstallJob>();

export function agentSdkDir(userDataRoot: string, templateId: string): string {
  return path.join(userDataRoot, "agent-sdks", templateId);
}

/**
 * 盘上已有接入包、但 provider.json 状态丢失时对齐为 installed。
 * 典型：状态被冲掉 / 残留目录 → UI 仍「开始接入」，点接入却报「已经接入过了」。
 * 不降级 ready / logging_in 等已推进态。
 */
export function reconcileAgentSdkDiskState(userDataRoot: string): void {
  for (const template of listAgentSdkTemplates()) {
    const packageName = template.agentSdk?.package;
    if (!packageName) continue;
    const installed = readInstalledSdk(agentSdkDir(userDataRoot, template.id), packageName);
    if (!installed) continue;
    const record = readStored(userDataRoot).agentSdks.find(
      (item) => item.templateId === template.id,
    );
    const state = record?.state;
    if (!state || state === "not_installed" || state === "install_failed") {
      setAgentSdkState(userDataRoot, template.id, "installed", {
        installedVersion: installed.version,
      });
      continue;
    }
    if (!record?.installedVersion) {
      setAgentSdkState(userDataRoot, template.id, state, {
        installedVersion: installed.version,
      });
    }
  }
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
  // 无 override：盘上已有包 → 对齐状态并返回幂等 done（勿抛「已经接入过了」让 UI 卡在开始接入）
  if (!specOverride?.trim()) {
    reconcileAgentSdkDiskState(userDataRoot);
    const installed = readInstalledSdk(agentSdkDir(userDataRoot, templateId), profile.package);
    if (installed) {
      const state = agentSdkStateOf(userDataRoot, templateId);
      if (!state || state === "not_installed" || state === "install_failed") {
        setAgentSdkState(userDataRoot, templateId, "installed", {
          installedVersion: installed.version,
        });
      }
      return rememberDoneInstallJob(userDataRoot, templateId, packageName, installed.version);
    }
  }
  const runner = resolveNpmRunner();
  if (!runner) {
    throw new ConfigError(
      "本机没有可用的 npm（未找到 npm-cli.js），无法自动接入。请重装 AgentUp，或安装 Node.js 并加入 PATH",
    );
  }

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

/** 幂等「已接入」：给 Desktop 轮询一条立刻 done 的 job，避免 400 误报。 */
function rememberDoneInstallJob(
  userDataRoot: string,
  templateId: string,
  packageName: string,
  version: string,
): string {
  const jobId = randomUUID();
  jobs.set(jobId, {
    jobId,
    template_id: templateId,
    userDataRoot,
    packageName,
    spec: packageName,
    companionSpecs: [],
    phase: "done",
    detail: `已接入 ${version}`,
  });
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
    if ((job.phase as InstallPhase) === "cancelled") {
      // cancel 当时 npm 可能还占着目录（Win EBUSY）；子进程退出后再清一次
      cleanupTmp(job);
      return;
    }
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
    if ((job.phase as InstallPhase) === "cancelled") {
      cleanupTmp(job);
      return;
    }
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
  // 先踢保活进程（fire-and-forget 同步触发；destroy 异步收尾）
  void disposeAgentSdkRuntimesForTemplate(userDataRoot, templateId);
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
  // 允许 cancel 后再清：即使 job.tmpDir 已被置空，仍用上次路径重试
  const dir = job.tmpDir ?? job.lastTmpDir;
  if (!dir) return;
  job.lastTmpDir = dir;
  job.tmpDir = undefined;
  // 少量短重试即可；长时间阻塞会拖死测例事件循环。顽固 EBUSY 留给子进程 exit 后再调一次。
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      if (!fs.existsSync(dir)) {
        job.lastTmpDir = undefined;
        return;
      }
      fs.rmSync(dir, { recursive: true, force: true });
      job.lastTmpDir = undefined;
      return;
    } catch {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 40 * (attempt + 1));
    }
  }
}
