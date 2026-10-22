import fs from "node:fs";
import path from "node:path";

/** 单文件在某一 user turn 首次被 Write/Edit 前的内容；null 表示当时不存在。 */
export type FileSnapshot = {
  relativePath: string;
  /** utf8 文本；缺失文件为 null。 */
  content: string | null;
};

const MAX_SNAPSHOT_BYTES = 2 * 1024 * 1024;
/** 与 Claude Code 默认接近：每个 visit 最多保留最近 N 个有文件快照的 user turn。 */
export const DEFAULT_MAX_CHECKPOINT_TURNS = 100;
const MISSING = "__missing__";
const INDEX_FILE = "index.json";

/** 检查点目录：`<visitRoot>/.runtime/checkpoints/`（cwd 外，模型工具默认碰不到）。 */
export function checkpointRoot(visitRoot: string): string {
  return path.join(visitRoot, ".runtime", "checkpoints");
}

/** `AGENTUP_CHECKPOINT_MAX_TURNS`，默认 100；非法值回退默认。 */
export function maxCheckpointTurns(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.AGENTUP_CHECKPOINT_MAX_TURNS;
  if (raw === undefined || raw === "") return DEFAULT_MAX_CHECKPOINT_TURNS;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) return DEFAULT_MAX_CHECKPOINT_TURNS;
  return Math.min(value, 10_000);
}

export function clearCheckpoints(visitRoot: string): void {
  const root = checkpointRoot(visitRoot);
  if (fs.existsSync(root)) fs.rmSync(root, { recursive: true, force: true });
}

/**
 * 在 Write/Edit 改文件前，若该 turn 尚未为该路径建快照则写入。
 * 路径必须落在 cwd 内；超大文件跳过。新 turn 写入后按上限淘汰最旧 turn。
 */
export function snapshotBeforeMutation(
  cwd: string,
  checkpointsDir: string,
  turnEntryId: string,
  filePath: string,
  options?: { maxTurns?: number },
): { snapped: boolean; reason?: string; pruned?: string[] } {
  if (!turnEntryId) return { snapped: false, reason: "no turn" };
  const resolved = resolveUnderCwd(cwd, filePath);
  if (!resolved) return { snapped: false, reason: "path outside cwd" };

  const relativePath = path.relative(cwd, resolved);
  const turnKey = sanitizeId(turnEntryId);
  const turnDir = path.join(checkpointsDir, turnKey);
  const metaPath = path.join(turnDir, "files.json");
  const existing = readTurnMeta(metaPath);
  if (relativePath in existing) return { snapped: false, reason: "already snapped" };

  let content: string | null = null;
  if (fs.existsSync(resolved)) {
    const stat = fs.statSync(resolved);
    if (!stat.isFile()) return { snapped: false, reason: "not a file" };
    if (stat.size > MAX_SNAPSHOT_BYTES) return { snapped: false, reason: "too large" };
    content = fs.readFileSync(resolved, "utf8");
  }

  const isNewTurn = !fs.existsSync(metaPath);
  fs.mkdirSync(turnDir, { recursive: true });
  existing[relativePath] = content === null ? MISSING : content;
  fs.writeFileSync(metaPath, `${JSON.stringify(existing)}\n`, "utf8");

  let pruned: string[] | undefined;
  if (isNewTurn) {
    pruned = rememberTurnAndPrune(checkpointsDir, turnKey, options?.maxTurns ?? maxCheckpointTurns());
  }
  return pruned?.length ? { snapped: true, pruned } : { snapped: true };
}

/**
 * 按时间顺序还原一组被放弃的 turn：每个文件取最早 turn 的快照（即该 turn 开始时的内容）。
 */
export function restoreAbandonedTurns(
  cwd: string,
  checkpointsDir: string,
  abandonedTurnIds: readonly string[],
): { restored: string[]; skipped: string[]; deleted: string[] } {
  const earliest = new Map<string, string | null>();
  for (const turnId of abandonedTurnIds) {
    const meta = readTurnMeta(path.join(checkpointsDir, sanitizeId(turnId), "files.json"));
    for (const [relativePath, value] of Object.entries(meta)) {
      if (earliest.has(relativePath)) continue;
      earliest.set(relativePath, value === MISSING ? null : value);
    }
  }

  const restored: string[] = [];
  const skipped: string[] = [];
  const deleted: string[] = [];

  for (const [relativePath, content] of earliest) {
    const absolute = resolveUnderCwd(cwd, relativePath);
    if (!absolute) {
      skipped.push(relativePath);
      continue;
    }
    try {
      if (content === null) {
        if (fs.existsSync(absolute) && fs.statSync(absolute).isFile()) {
          fs.rmSync(absolute, { force: true });
          deleted.push(relativePath);
        }
        continue;
      }
      fs.mkdirSync(path.dirname(absolute), { recursive: true });
      fs.writeFileSync(absolute, content, "utf8");
      restored.push(relativePath);
    } catch {
      skipped.push(relativePath);
    }
  }

  return { restored, skipped, deleted };
}

export function resolveUnderCwd(cwd: string, filePath: string): string | null {
  const root = path.resolve(cwd);
  const absolute = path.resolve(root, filePath);
  if (absolute !== root && !absolute.startsWith(`${root}${path.sep}`)) return null;
  return absolute;
}

/** 记录 turn 顺序并淘汰超出上限的最旧目录；返回被删 turn key。 */
export function rememberTurnAndPrune(
  checkpointsDir: string,
  turnKey: string,
  maxTurns: number = maxCheckpointTurns(),
): string[] {
  fs.mkdirSync(checkpointsDir, { recursive: true });
  const indexPath = path.join(checkpointsDir, INDEX_FILE);
  const turns = readTurnIndex(indexPath).filter((id) => id !== turnKey);
  turns.push(turnKey);
  const pruned: string[] = [];
  while (turns.length > maxTurns) {
    const oldest = turns.shift();
    if (!oldest) break;
    const dir = path.join(checkpointsDir, oldest);
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    pruned.push(oldest);
  }
  writeTurnIndex(indexPath, turns);
  return pruned;
}

/** 测试 / 运维：当前 index 中的 turn 顺序（旧 → 新）。 */
export function listCheckpointTurnOrder(checkpointsDir: string): string[] {
  return readTurnIndex(path.join(checkpointsDir, INDEX_FILE));
}

function readTurnIndex(indexPath: string): string[] {
  if (!fs.existsSync(indexPath)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(indexPath, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
    const turns = (parsed as { turns?: unknown }).turns;
    if (!Array.isArray(turns)) return [];
    return turns.filter((item): item is string => typeof item === "string" && item.length > 0);
  } catch {
    return [];
  }
}

function writeTurnIndex(indexPath: string, turns: readonly string[]): void {
  fs.writeFileSync(indexPath, `${JSON.stringify({ turns }, null, 0)}\n`, "utf8");
}

function readTurnMeta(metaPath: string): Record<string, string> {
  if (!fs.existsSync(metaPath)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(metaPath, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === "string") result[key] = value;
    }
    return result;
  } catch {
    return {};
  }
}

function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9._-]/g, "_");
}

/** 测试用：读出某 turn 已记录的快照。 */
export function listTurnSnapshots(
  checkpointsDir: string,
  turnEntryId: string,
): FileSnapshot[] {
  const meta = readTurnMeta(path.join(checkpointsDir, sanitizeId(turnEntryId), "files.json"));
  return Object.entries(meta).map(([relativePath, value]) => ({
    relativePath,
    content: value === MISSING ? null : value,
  }));
}
