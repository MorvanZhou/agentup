import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** 每个 visit 最多挂载的项目目录数。 */
export const MAX_PROJECT_ROOTS = 8;

export class ProjectRootsError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** 挂载归属：personal=`profile.json`，agent=`instance.json`，group=群目录 `settings.json`。 */
export type ProjectRootsKind = "personal" | "agent" | "group";

function storedRootsFile(visitRoot: string, kind: ProjectRootsKind): string {
  if (kind === "personal") return path.join(visitRoot, "profile.json");
  if (kind === "group") return path.join(visitRoot, "settings.json");
  return path.join(visitRoot, "instance.json");
}

/** 从 instance / profile / 群 settings JSON 解析 `project_roots`；非法项丢弃。 */
export function parseStoredProjectRoots(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string" || !item.trim()) continue;
    const normalized = path.resolve(item.trim());
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
    if (out.length >= MAX_PROJECT_ROOTS) break;
  }
  return out;
}

/** 读已保存的挂载（agent=`instance.json`，personal=`profile.json`，group=群 `settings.json`）。 */
export function readProjectRoots(visitRoot: string, kind: ProjectRootsKind): string[] {
  const file = storedRootsFile(visitRoot, kind);
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
    return parseStoredProjectRoots((parsed as Record<string, unknown>).project_roots);
  } catch {
    return [];
  }
}

/** 写回 `project_roots`，保留文件其余字段。群挂载首次写入时自动建 `settings.json`。 */
export function writeProjectRoots(
  visitRoot: string,
  kind: ProjectRootsKind,
  roots: string[],
): void {
  const file = storedRootsFile(visitRoot, kind);
  let data: Record<string, unknown>;
  if (fs.existsSync(file)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new ProjectRootsError("配置损坏", 500);
      }
      data = parsed as Record<string, unknown>;
    } catch (error) {
      if (error instanceof ProjectRootsError) throw error;
      throw new ProjectRootsError("配置损坏", 500);
    }
  } else {
    if (kind !== "group") throw new ProjectRootsError("配置不存在", 404);
    // 群目录由建群保证存在；settings.json 惰性创建。
    data = {};
  }
  const cleaned = parseStoredProjectRoots(roots);
  if (cleaned.length > 0) data.project_roots = cleaned;
  else delete data.project_roots;
  const temporary = `${file}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, file);
}

/**
 * 校验用户挑选的目录可否挂载。
 * 返回 realpath；失败抛 ProjectRootsError。
 */
export function validateCandidateRoot(userDataRoot: string, rawPath: string): string {
  if (typeof rawPath !== "string" || !rawPath.trim()) {
    throw new ProjectRootsError("路径无效", 400);
  }
  if (rawPath.includes("\0")) throw new ProjectRootsError("路径无效", 400);
  const absolute = path.resolve(rawPath.trim());
  let real: string;
  try {
    if (!fs.existsSync(absolute) || !fs.statSync(absolute).isDirectory()) {
      throw new ProjectRootsError("不是有效目录", 400);
    }
    real = fs.realpathSync(absolute);
  } catch (error) {
    if (error instanceof ProjectRootsError) throw error;
    throw new ProjectRootsError("不是有效目录", 400);
  }
  if (!fs.statSync(real).isDirectory()) throw new ProjectRootsError("不是有效目录", 400);

  const dataRoot = safeRealpath(userDataRoot) ?? path.resolve(userDataRoot);
  if (isInside(dataRoot, real)) {
    throw new ProjectRootsError("不能挂载 AgentUp 数据目录内的路径", 400);
  }

  const home = safeRealpath(os.homedir()) ?? path.resolve(os.homedir());
  if (real === home) {
    throw new ProjectRootsError("不能挂载整个用户主目录", 400);
  }

  for (const blocked of blockedRoots()) {
    if (real === blocked || isInside(blocked, real)) {
      throw new ProjectRootsError("不能挂载受保护目录", 400);
    }
  }

  return real;
}

export function addProjectRoot(
  userDataRoot: string,
  visitRoot: string,
  kind: ProjectRootsKind,
  rawPath: string,
): string[] {
  const candidate = validateCandidateRoot(userDataRoot, rawPath);
  const current = readProjectRoots(visitRoot, kind);
  if (current.includes(candidate)) return current;
  if (current.length >= MAX_PROJECT_ROOTS) {
    throw new ProjectRootsError(`最多挂载 ${MAX_PROJECT_ROOTS} 个项目目录`, 400);
  }
  const next = [...current, candidate];
  writeProjectRoots(visitRoot, kind, next);
  return next;
}

export function removeProjectRoot(
  visitRoot: string,
  kind: ProjectRootsKind,
  rawPath: string,
): string[] {
  if (typeof rawPath !== "string" || !rawPath.trim()) {
    throw new ProjectRootsError("路径无效", 400);
  }
  const target = path.resolve(rawPath.trim());
  const current = readProjectRoots(visitRoot, kind);
  const next = current.filter((root) => root !== target && safeRealpath(root) !== safeRealpath(target));
  if (next.length === current.length) throw new ProjectRootsError("未挂载该目录", 404);
  writeProjectRoots(visitRoot, kind, next);
  return next;
}

/**
 * 为越界路径提议可挂载的目录：已存在的目录用自身，文件用父目录，缺失则向上找已存在祖先。
 * 找不到则返回 null。
 */
export function proposeMountDirectory(absolutePath: string): string | null {
  const absolute = path.resolve(absolutePath);
  try {
    if (fs.existsSync(absolute)) {
      const real = fs.realpathSync(absolute);
      if (fs.statSync(real).isDirectory()) return real;
      if (fs.statSync(real).isFile()) {
        const parent = path.dirname(real);
        return safeRealpath(parent) ?? parent;
      }
    }
  } catch {
    // fall through to walk
  }
  let cursor = path.dirname(absolute);
  for (let i = 0; i < 64; i += 1) {
    const real = safeRealpath(cursor);
    if (real && fs.statSync(real).isDirectory()) return real;
    const next = path.dirname(cursor);
    if (next === cursor) break;
    cursor = next;
  }
  return null;
}

/** visit cwd + 已挂载项目根（仍存在的目录）。 */
export function resolveAllowedRoots(visitCwd: string, projectRoots: string[]): string[] {
  const roots: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string) => {
    const real = safeRealpath(raw);
    if (!real || !fs.existsSync(real) || !fs.statSync(real).isDirectory()) return;
    if (seen.has(real)) return;
    seen.add(real);
    roots.push(real);
  };
  push(visitCwd);
  for (const root of projectRoots) push(root);
  return roots;
}

export function isInside(root: string, target: string): boolean {
  const prefix = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  return target === root || target.startsWith(prefix);
}

export function isInsideAnyRoot(target: string, roots: string[]): boolean {
  return roots.some((root) => isInside(root, target));
}

/**
 * 断言绝对路径落在 allowedRoots 内。
 * `allowMissing`：目标尚不存在时校验其父目录（write 新建文件）。
 */
export function assertInsideAnyRoot(
  target: string,
  roots: string[],
  options?: { allowMissing?: boolean },
): void {
  const normalizedRoots = roots
    .map((root) => safeRealpath(root) ?? path.resolve(root))
    .filter(Boolean);
  if (!normalizedRoots.length) throw new ProjectRootsError("路径超出允许范围", 403);
  const absolute = path.resolve(target);
  const real = safeRealpath(absolute);
  if (real) {
    if (!isInsideAnyRoot(real, normalizedRoots)) throw new ProjectRootsError("路径超出允许范围", 403);
    return;
  }
  if (!options?.allowMissing) throw new ProjectRootsError("路径超出允许范围", 403);
  // 新建文件时沿父目录向上找到已存在且落在 allowedRoots 内的祖先。
  let cursor = path.dirname(absolute);
  for (let i = 0; i < 64; i += 1) {
    const parentReal = safeRealpath(cursor);
    if (parentReal) {
      if (!isInsideAnyRoot(parentReal, normalizedRoots)) {
        throw new ProjectRootsError("路径超出允许范围", 403);
      }
      return;
    }
    const next = path.dirname(cursor);
    if (next === cursor) break;
    cursor = next;
  }
  throw new ProjectRootsError("路径超出允许范围", 403);
}

/** 注入 system prompt 的挂载说明。 */
export function formatProjectRootsPrompt(projectRoots: string[]): string {
  if (projectRoots.length === 0) return "";
  const lines = [
    "# Allowed Project Roots",
    "",
    "In addition to your session cwd, you may read and write files under these user-mounted project directories:",
    "",
  ];
  for (const root of projectRoots) {
    lines.push(`- \`${path.basename(root)}\`: \`${root}\``);
  }
  lines.push(
    "",
    "Do not access paths outside your cwd and these project roots. Prefer project roots for code changes; keep final user-facing outputs in `ARTIFACT/`.",
  );
  return lines.join("\n");
}

/** 升包写 instance 时保留旧 `project_roots`。 */
export function projectRootsFromPreviousInstance(
  previous: Record<string, unknown> | undefined,
): string[] | undefined {
  if (!previous) return undefined;
  const roots = parseStoredProjectRoots(previous.project_roots);
  return roots.length > 0 ? roots : undefined;
}

function blockedRoots(): string[] {
  const home = safeRealpath(os.homedir()) ?? path.resolve(os.homedir());
  // 勿把 macOS `/private` 整棵树列入：tmpdir 常落在 `/private/var/folders`。
  const list = [
    path.join(home, ".ssh"),
    path.join(home, ".gnupg"),
    path.join(home, ".aws"),
    path.join(home, ".config", "gcloud"),
    "/etc",
    "/System",
    "/private/etc",
    "/boot",
    "/root",
  ];
  if (process.platform === "win32") {
    list.push("C:\\Windows", "C:\\Program Files", "C:\\Program Files (x86)");
  }
  return list.map((item) => safeRealpath(item) ?? path.resolve(item));
}

/**
 * 路径是否落在禁读的系统 / 凭据敏感根内（`~/.ssh`、`/etc` 等）。
 * 供 project_roots 挂载与附件按路径复制等入口共用同一套判定。
 */
export function isBlockedPath(absolute: string): boolean {
  const real = safeRealpath(absolute) ?? path.resolve(absolute);
  return blockedRoots().some((root) => real === root || real.startsWith(`${root}${path.sep}`));
}

function safeRealpath(target: string): string | undefined {
  try {
    return fs.realpathSync(target);
  } catch {
    return undefined;
  }
}
