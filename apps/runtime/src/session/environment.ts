/**
 * 本机执行环境探测：选 shell 工具、注入 system prompt、对齐 bg_run spawn。
 * 对齐 Claude Code / Codex：环境块与真实 command tool 必须一致。
 */
import { existsSync } from "node:fs";
import os from "node:os";
import { delimiter } from "node:path";
import { spawnSync } from "node:child_process";

export type CommandToolName = "bash" | "powershell";

export type ShellSpawnConfig = {
  shell: string;
  args: string[];
  /** 与 Pi bash 一致：部分 WSL bash 需把命令写 stdin */
  commandTransport?: "argv" | "stdin";
};

export type HostEnvironment = {
  platform: NodeJS.Platform;
  arch: string;
  osVersion: string;
  /** 模型应优先使用、且 bg_run 实际执行的 shell 工具名 */
  commandTool: CommandToolName;
  bashAvailable: boolean;
  powershellAvailable: boolean;
  /** 写入 Pi tools 白名单的 shell 工具（主工具在前） */
  shellTools: CommandToolName[];
  shellLabel: string;
  shellHint: string;
};

export type DetectHostEnvironmentOptions = {
  platform?: NodeJS.Platform;
  arch?: string;
  osVersion?: string;
  /** 测试注入：跳过本机探测 */
  bashAvailable?: boolean;
  powershellAvailable?: boolean;
  bashPath?: string | null;
  powershellPath?: string | null;
};

const POWERSHELL_ARGS = [
  "-NoProfile",
  "-NonInteractive",
  "-ExecutionPolicy",
  "Bypass",
  "-Command",
] as const;

let cached: HostEnvironment | undefined;

/** 测试用：清掉探测缓存。 */
export function resetHostEnvironmentCache(): void {
  cached = undefined;
}

export function detectHostEnvironment(
  options: DetectHostEnvironmentOptions = {},
): HostEnvironment {
  const injectable =
    options.platform != null ||
    options.arch != null ||
    options.osVersion != null ||
    options.bashAvailable != null ||
    options.powershellAvailable != null ||
    options.bashPath !== undefined ||
    options.powershellPath !== undefined;

  if (!injectable && cached) return cached;

  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const osVersion = options.osVersion ?? `${os.type()} ${os.release()}`;

  const bashPath =
    options.bashPath !== undefined
      ? options.bashPath
      : options.bashAvailable === false
        ? null
        : findBashExecutable(platform);
  const powershellPath =
    options.powershellPath !== undefined
      ? options.powershellPath
      : options.powershellAvailable === false
        ? null
        : findPowerShellExecutable(platform);

  const bashAvailable = options.bashAvailable ?? bashPath != null;
  const powershellAvailable = options.powershellAvailable ?? powershellPath != null;

  const env = buildHostEnvironment({
    platform,
    arch,
    osVersion,
    bashAvailable,
    powershellAvailable,
    bashPath,
    powershellPath,
  });

  if (!injectable) cached = env;
  return env;
}

function buildHostEnvironment(input: {
  platform: NodeJS.Platform;
  arch: string;
  osVersion: string;
  bashAvailable: boolean;
  powershellAvailable: boolean;
  bashPath: string | null;
  powershellPath: string | null;
}): HostEnvironment {
  const { platform, arch, osVersion, bashAvailable, powershellAvailable } = input;

  let commandTool: CommandToolName;
  let shellTools: CommandToolName[];

  if (platform === "win32") {
    if (powershellAvailable) {
      commandTool = "powershell";
      shellTools = bashAvailable ? ["powershell", "bash"] : ["powershell"];
    } else if (bashAvailable) {
      commandTool = "bash";
      shellTools = ["bash"];
    } else {
      // 极罕见：仍暴露 powershell，执行期由 Pi 报清晰错误
      commandTool = "powershell";
      shellTools = ["powershell"];
    }
  } else {
    commandTool = "bash";
    shellTools = ["bash"];
  }

  const shellLabel =
    commandTool === "powershell"
      ? input.powershellPath?.toLowerCase().includes("pwsh")
        ? "powershell (pwsh)"
        : "powershell"
      : "bash";

  const shellHint =
    commandTool === "powershell"
      ? "use PowerShell syntax — e.g. $env:VAR, Join-Path; do not assume Unix utilities unless invoking bash"
      : "use Unix shell syntax, not Windows — e.g. /dev/null not NUL, forward slashes in paths";

  return {
    platform,
    arch,
    osVersion,
    commandTool,
    bashAvailable: platform === "win32" ? bashAvailable : true,
    powershellAvailable: platform === "win32" ? powershellAvailable : false,
    shellTools,
    shellLabel,
    shellHint,
  };
}

/** 写入 appendSystemPrompt 的环境块（与白名单 command tool 一致）。 */
export function formatEnvironmentPrompt(env: HostEnvironment, cwd: string): string {
  const lines = [
    "# Environment",
    "You are running in the following environment:",
    `- Platform: ${env.platform}`,
    `- Arch: ${env.arch}`,
    `- OS Version: ${env.osVersion}`,
    `- Working directory: ${cwd.replace(/\\/g, "/")}`,
    `- Command tool: ${env.commandTool} (${env.shellHint})`,
  ];
  if (env.platform === "win32" && env.shellTools.includes("bash") && env.commandTool === "powershell") {
    lines.push(
      "- Also available: `bash` (Git Bash) for POSIX scripts — prefer `powershell` for normal Windows work",
    );
  }
  if (env.platform === "win32") {
    lines.push(
      "- Path style: Windows paths; file tools accept either slash style; shell syntax must match the command tool",
    );
  }
  return lines.join("\n");
}

/**
 * 解析主 shell 的 spawn 配置，供 bg_run 与 bash/powershell 工具语义对齐。
 * 找不到可执行文件时抛错（与 Pi 一致）。
 */
export function resolveCommandShell(
  commandTool: CommandToolName = detectHostEnvironment().commandTool,
  platform: NodeJS.Platform = process.platform,
): ShellSpawnConfig {
  if (commandTool === "powershell") {
    if (platform !== "win32") {
      throw new Error("The powershell tool is only available on Windows.");
    }
    const shell = findPowerShellExecutable(platform);
    if (!shell) {
      throw new Error(
        "No PowerShell executable found. Install PowerShell or add powershell.exe/pwsh.exe to PATH.",
      );
    }
    return { shell, args: [...POWERSHELL_ARGS] };
  }

  return resolveBashShell(platform);
}

/** 用主 command tool 执行一条命令（bg_run）；避免 Windows 上 `shell: true` 落到 cmd。 */
export function spawnArgsForCommand(
  command: string,
  commandTool?: CommandToolName,
): { file: string; args: string[]; stdinCommand?: string } {
  const config = resolveCommandShell(commandTool);
  if (config.commandTransport === "stdin") {
    return { file: config.shell, args: config.args, stdinCommand: command };
  }
  return { file: config.shell, args: [...config.args, command] };
}

function resolveBashShell(platform: NodeJS.Platform): ShellSpawnConfig {
  const shell = findBashExecutable(platform);
  if (!shell) {
    if (platform === "win32") {
      throw new Error(
        "No bash shell found. Options:\n" +
          "  1. Install Git for Windows: https://git-scm.com/download/win\n" +
          "  2. Add your bash to PATH (Cygwin, MSYS2, etc.)",
      );
    }
    return { shell: "sh", args: ["-c"] };
  }
  return bashConfigForPath(shell);
}

function bashConfigForPath(shell: string): ShellSpawnConfig {
  const normalized = shell.replace(/\//g, "\\").toLowerCase();
  const legacyWsl = /^[a-z]:\\windows\\(?:system32|sysnative)\\bash\.exe$/.test(normalized);
  return legacyWsl
    ? { shell, args: ["-s"], commandTransport: "stdin" }
    : { shell, args: ["-c"] };
}

/** 与 Pi getShellConfig 同序：Windows Git Bash 已知路径 → PATH；Unix /bin/bash → PATH → null（上层回落 sh）。 */
export function findBashExecutable(platform: NodeJS.Platform = process.platform): string | null {
  if (platform === "win32") {
    const paths: string[] = [];
    const programFiles = process.env.ProgramFiles;
    if (programFiles) paths.push(`${programFiles}\\Git\\bin\\bash.exe`);
    const programFilesX86 = process.env["ProgramFiles(x86)"];
    if (programFilesX86) paths.push(`${programFilesX86}\\Git\\bin\\bash.exe`);
    for (const candidate of paths) {
      if (existsSync(candidate)) return candidate;
    }
    return findExecutableOnPath("bash.exe", platform);
  }
  if (existsSync("/bin/bash")) return "/bin/bash";
  return findExecutableOnPath("bash", platform);
}

export function findPowerShellExecutable(
  platform: NodeJS.Platform = process.platform,
): string | null {
  if (platform !== "win32") return null;
  return findExecutableOnPath("pwsh.exe", platform) ?? findExecutableOnPath("powershell.exe", platform);
}

function findExecutableOnPath(
  executable: string,
  platform: NodeJS.Platform,
): string | null {
  if (platform === "win32") {
    try {
      const result = spawnSync("where", [executable], {
        encoding: "utf-8",
        timeout: 5000,
        windowsHide: true,
      });
      if (result.status === 0 && result.stdout) {
        const firstMatch = result.stdout.trim().split(/\r?\n/)[0];
        if (firstMatch && existsSync(firstMatch)) return firstMatch;
      }
    } catch {
      // ignore
    }
    // where 不可用时扫 PATH
    const pathEnv = process.env.Path ?? process.env.PATH ?? "";
    for (const dir of pathEnv.split(delimiter).filter(Boolean)) {
      const candidate = `${dir}\\${executable}`;
      if (existsSync(candidate)) return candidate;
    }
    return null;
  }
  try {
    const result = spawnSync("which", [executable], { encoding: "utf-8", timeout: 5000 });
    if (result.status === 0 && result.stdout) {
      const firstMatch = result.stdout.trim().split(/\r?\n/)[0];
      if (firstMatch) return firstMatch;
    }
  } catch {
    // ignore
  }
  return null;
}
