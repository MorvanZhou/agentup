/**
 * 运行包表面：与 `.agentup` / 活 `cwd/.pi` 同构的可发布内容。
 * 宿主运行时状态（如 `.agentup-runtime/`）不在此列，读包时直接跳过。
 */
import fs from "node:fs";
import path from "node:path";

export const PACKAGE_ROOT_FILES = new Set(["SYSTEM.md", "AGENTS.md", "mcp.json", "settings.json"]);
export const PACKAGE_ROOT_DIRS = new Set(["skills", "hooks"]);

export type ReadPackageSurfaceOptions = {
  /** 活 `.pi` 默认跳过链接；开发源整树读取另有抛错路径。 */
  onSymlink?: "skip" | "throw";
};

/**
 * 只收集包表面文件；顶层杂文件 / 未知目录（含历史 skills-project.json）一律跳过。
 */
export function readPackageSurface(
  packageRoot: string,
  options: ReadPackageSurfaceOptions = {},
): Record<string, Uint8Array> {
  const onSymlink = options.onSymlink ?? "skip";
  if (!fs.existsSync(packageRoot) || !fs.statSync(packageRoot).isDirectory()) return {};
  const files: Record<string, Uint8Array> = {};

  for (const entry of fs.readdirSync(packageRoot, { withFileTypes: true })) {
    const full = path.join(packageRoot, entry.name);
    if (entry.isSymbolicLink()) {
      if (onSymlink === "throw") {
        throw new Error(`不读取符号链接: ${entry.name}`);
      }
      continue;
    }
    if (entry.isFile()) {
      // APPEND_SYSTEM.md 留给 validate 给出迁移提示
      if (!PACKAGE_ROOT_FILES.has(entry.name) && entry.name !== "APPEND_SYSTEM.md") continue;
      files[entry.name] = fs.readFileSync(full);
      continue;
    }
    if (!entry.isDirectory() || !PACKAGE_ROOT_DIRS.has(entry.name)) continue;
    walkDir(full, entry.name, files, onSymlink);
  }
  return files;
}

function walkDir(
  directory: string,
  relativePrefix: string,
  files: Record<string, Uint8Array>,
  onSymlink: "skip" | "throw",
): void {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    const relative = `${relativePrefix}/${entry.name}`;
    if (entry.isSymbolicLink()) {
      if (onSymlink === "throw") {
        throw new Error(`不读取符号链接: ${relative}`);
      }
      continue;
    }
    if (entry.isDirectory()) {
      walkDir(full, relative, files, onSymlink);
      continue;
    }
    if (!entry.isFile()) continue;
    files[relative] = fs.readFileSync(full);
  }
}
