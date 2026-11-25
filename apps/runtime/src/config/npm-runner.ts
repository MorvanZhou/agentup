import fs from "node:fs";
import path from "node:path";

/**
 * 定位 npm：一律「当前 Node（含 ELECTRON_RUN_AS_NODE）+ npm-cli.js」。
 *
 * 优先级：
 * 1. Desktop 注入的 `AGENTUP_NPM_CLI`（afterPack 拷入的钉版 npm）
 * 2. 打包布局：mac `Contents/Resources/npm`、win `resources/npm`
 * 3. 官方 Node 旁 `lib/node_modules/npm`（开发机 / 系统 Node）
 * 4. PATH 反查；Unix 最后才直接 spawn PATH 上的 `npm` 脚本
 *
 * Windows 上 Node ≥20.12 直接 spawn `.cmd`/`.bat` 会 EINVAL（CVE-2024-27980），
 * 因此禁止把 `npm.cmd` 当作 command。
 *
 * `npm_execpath` 不可信——被 pnpm / yarn 拉起时可能指向 pnpm.cjs，
 * 只有确认为 npm-cli.js 时才用。
 */
export type NpmRunner = { command: string; args: string[] };

/** 与 {@link resolveNpmRunner} 同布局，指向 npx-cli.js（禁止 Windows 上 spawn npx.cmd）。 */
export function resolveNpxRunner(options?: {
  platform?: NodeJS.Platform;
  execPath?: string;
  env?: NodeJS.ProcessEnv;
  existsSync?: (filePath: string) => boolean;
}): NpmRunner | null {
  const exists = options?.existsSync ?? ((filePath: string) => fs.existsSync(filePath));
  const npm = resolveNpmRunner(options);
  if (!npm) {
    if ((options?.platform ?? process.platform) === "win32") return null;
    const onPath = findOnPath("npx", options?.env ?? process.env, exists);
    return onPath ? { command: onPath, args: [] } : null;
  }
  if (npm.args.length >= 1 && /npm-cli\.js$/i.test(npm.args[0]!)) {
    const npxCli = npm.args[0]!.replace(/npm-cli\.js$/i, "npx-cli.js");
    if (exists(npxCli)) return { command: npm.command, args: [npxCli] };
    return null;
  }
  // Unix：PATH 上的 npm 脚本旁常有 npx
  if (npm.args.length === 0 && npm.command) {
    const dir = path.dirname(npm.command);
    const sibling = path.join(dir, "npx");
    if (exists(sibling)) return { command: sibling, args: [] };
    const onPath = findOnPath("npx", options?.env ?? process.env, exists);
    if (onPath) return { command: onPath, args: [] };
  }
  return null;
}

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

  const asRunner = (cli: string): NpmRunner => ({ command: execPath, args: [cli] });

  // Desktop 主进程写入；打包态优先，避免误用用户 PATH 上的旧 npm
  const fromAgentUp = env.AGENTUP_NPM_CLI?.trim();
  if (fromAgentUp && /npm-cli\.js$/i.test(fromAgentUp) && exists(fromAgentUp)) {
    return asRunner(fromAgentUp);
  }

  // afterPack 注入 → Resources/npm（mac）或 resources/npm（win）
  const packaged = [
    path.join(execDir, "..", "Resources", "npm", "bin", "npm-cli.js"),
    path.join(execDir, "resources", "npm", "bin", "npm-cli.js"),
  ];
  for (const candidate of packaged) {
    if (exists(candidate)) return asRunner(candidate);
  }

  const besideNode = [
    path.join(execDir, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
    path.join(execDir, "node_modules", "npm", "bin", "npm-cli.js"),
  ];
  for (const candidate of besideNode) {
    if (exists(candidate)) return asRunner(candidate);
  }

  const fromEnv = env.npm_execpath;
  if (fromEnv && /npm-cli\.js$/i.test(fromEnv) && exists(fromEnv)) {
    return asRunner(fromEnv);
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
        if (cli) return asRunner(cli);
      }
    }
    return null;
  }

  for (const dir of pathDirs) {
    const cli = npmCliBeside(dir);
    if (cli) return asRunner(cli);
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
