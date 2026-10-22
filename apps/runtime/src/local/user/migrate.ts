import fs from "node:fs";
import path from "node:path";

export class MigrateUserError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

/** 把本机 users/<from> 迁到 users/<to>（登录后接手游客数据）。 */
export function migrateUserData(userDataRoot: string, fromUserId: string, toUserId: string): void {
  const from = sanitizeUserId(fromUserId);
  const to = sanitizeUserId(toUserId);
  if (from === to) throw new MigrateUserError("源与目标不能相同");
  if (from !== "guest") throw new MigrateUserError("仅支持从游客目录迁移");

  const usersRoot = path.resolve(userDataRoot, "users");
  const fromRoot = path.resolve(usersRoot, from);
  const toRoot = path.resolve(usersRoot, to);
  if (!fromRoot.startsWith(usersRoot + path.sep) || !toRoot.startsWith(usersRoot + path.sep)) {
    throw new MigrateUserError("路径无效");
  }
  if (!fs.existsSync(fromRoot)) return;

  fs.mkdirSync(usersRoot, { recursive: true });
  if (!fs.existsSync(toRoot)) {
    fs.renameSync(fromRoot, toRoot);
    return;
  }

  mergeDirectory(fromRoot, toRoot);
  fs.rmSync(fromRoot, { recursive: true, force: true });
}

function mergeDirectory(fromDir: string, toDir: string): void {
  fs.mkdirSync(toDir, { recursive: true });
  for (const entry of fs.readdirSync(fromDir, { withFileTypes: true })) {
    const fromPath = path.join(fromDir, entry.name);
    const toPath = path.join(toDir, entry.name);
    if (entry.isDirectory()) {
      if (!fs.existsSync(toPath)) fs.renameSync(fromPath, toPath);
      else mergeDirectory(fromPath, toPath);
      continue;
    }
    if (!fs.existsSync(toPath)) fs.renameSync(fromPath, toPath);
  }
}

function sanitizeUserId(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "." || trimmed === ".." || /[/\\\u0000]/.test(trimmed)) {
    throw new MigrateUserError("用户 ID 无效");
  }
  return trimmed;
}
