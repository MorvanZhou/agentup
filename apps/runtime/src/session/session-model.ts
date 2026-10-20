import fs from "node:fs";
import path from "node:path";

import { SessionManager } from "@earendil-works/pi-coding-agent";

import {
  firstEnabledModelRef,
  loadModelConfig,
  loadModelConfigFromRef,
  touchActiveModel,
  type ModelRef,
} from "../config/provider.js";
import type { ModelConfig } from "../config/load.js";
import { ConfigError } from "../config/load.js";
import type { Visit } from "../package/sync.js";

/** 与 Pi jsonl 同目录的会话模型 sidecar：空会话也能落盘（custom entry 要等首条消息才 flush）。 */
export function sessionModelSidecarPath(sessionFile: string): string {
  if (sessionFile.endsWith(".jsonl")) {
    return `${sessionFile.slice(0, -".jsonl".length)}.model.json`;
  }
  return `${sessionFile}.model.json`;
}

export function readSessionModelRef(sessionFile: string): ModelRef | null {
  const file = sessionModelSidecarPath(sessionFile);
  if (!fs.existsSync(file)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
    const templateId = typeof raw.templateId === "string" ? raw.templateId.trim() : "";
    const modelId = typeof raw.modelId === "string" ? raw.modelId.trim() : "";
    if (!templateId || !modelId) return null;
    return { templateId, modelId };
  } catch {
    return null;
  }
}

export function writeSessionModelRef(sessionFile: string, ref: ModelRef): void {
  const file = sessionModelSidecarPath(sessionFile);
  const directory = path.dirname(file);
  fs.mkdirSync(directory, { recursive: true });
  const temporary = `${file}.tmp`;
  fs.writeFileSync(
    temporary,
    `${JSON.stringify({ templateId: ref.templateId, modelId: ref.modelId }, null, 2)}\n`,
    { mode: 0o600 },
  );
  fs.renameSync(temporary, file);
}

/** 按 mtime 列出 sessions 目录下的 jsonl（与 Pi continueRecent 一致）。 */
export function listSessionFilesByMtime(sessionDir: string): string[] {
  if (!fs.existsSync(sessionDir)) return [];
  return fs
    .readdirSync(sessionDir)
    .filter((name) => name.endsWith(".jsonl"))
    .map((name) => path.join(sessionDir, name))
    .filter((file) => fs.statSync(file).isFile())
    .map((file) => ({ file, mtime: fs.statSync(file).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)
    .map((item) => item.file);
}

/**
 * 只读：最近 session sidecar → 更早 session → enabled 第一个。
 * 供 GET /session/model，不写盘。
 */
export function peekVisitModelRef(
  userDataRoot: string,
  sessionDir: string,
): ModelRef | null {
  const files = listSessionFilesByMtime(sessionDir);
  for (const file of files) {
    const ref = readSessionModelRef(file);
    if (ref) return ref;
  }
  return firstEnabledModelRef(userDataRoot);
}

/**
 * 解析并锚定 Visit 当前模型（prompt 前）：
 * 1. 最近 session 的 sidecar
 * 2. 更早 session 的 sidecar（新空对话继承）
 * 3. enabled 第一个
 * 写回当前 session sidecar，并刷新设备级 activeModel（委托等回落）。
 */
export function resolveVisitModelRef(
  userDataRoot: string,
  cwd: string,
  sessionDir: string,
): { ref: ModelRef; sessionFile: string | undefined } {
  fs.mkdirSync(cwd, { recursive: true });
  fs.mkdirSync(sessionDir, { recursive: true });

  const files = listSessionFilesByMtime(sessionDir);
  const sessionFile = files[0];

  let ref: ModelRef | null = null;
  if (sessionFile) {
    ref = readSessionModelRef(sessionFile);
    if (!ref) {
      for (const older of files.slice(1)) {
        ref = readSessionModelRef(older);
        if (ref) break;
      }
    }
  }
  if (!ref) ref = firstEnabledModelRef(userDataRoot);
  if (!ref) {
    throw new ConfigError("打开会话前请先在设置中连接服务商并启用一个模型");
  }

  if (sessionFile) {
    const current = readSessionModelRef(sessionFile);
    if (!current || current.templateId !== ref.templateId || current.modelId !== ref.modelId) {
      writeSessionModelRef(sessionFile, ref);
    }
  }

  rememberActiveModel(userDataRoot, ref);
  return { ref, sessionFile };
}

export function resolveVisitModelConfig(
  userDataRoot: string,
  visit: Visit,
  env: NodeJS.ProcessEnv = process.env,
): ModelConfig {
  // 环境覆盖仍优先（开发 / CI）
  if (env.AGENTUP_MODEL_NAME?.trim()) {
    return loadModelConfig(userDataRoot, env);
  }
  const cwd = path.join(visit.root, "cwd");
  const sessionDir = path.join(visit.root, "sessions");
  const { ref } = resolveVisitModelRef(userDataRoot, cwd, sessionDir);
  return loadModelConfigFromRef(userDataRoot, ref, env);
}

function rememberActiveModel(userDataRoot: string, ref: ModelRef): void {
  try {
    touchActiveModel(userDataRoot, ref);
  } catch {
    /* 连接已删等：忽略 */
  }
}

/** 为当前（最近）session 设置模型；无文件则创建后写入 sidecar。 */
export function setVisitSessionModel(
  userDataRoot: string,
  cwd: string,
  sessionDir: string,
  ref: ModelRef,
): ModelRef {
  fs.mkdirSync(cwd, { recursive: true });
  fs.mkdirSync(sessionDir, { recursive: true });
  let sessionFile = listSessionFilesByMtime(sessionDir)[0];
  if (!sessionFile) {
    const created = SessionManager.create(cwd, sessionDir);
    const file = created.getSessionFile();
    if (!file) throw new ConfigError("没有生成会话文件");
    sessionFile = file;
    // 与 clearContext 一致：占位空文件，便于 sidecar 锚定
    if (!fs.existsSync(sessionFile)) fs.writeFileSync(sessionFile, "");
  }
  writeSessionModelRef(sessionFile, ref);
  rememberActiveModel(userDataRoot, ref);
  return ref;
}

/** 新对话：把「上一会话模型 → enabled 第一个」写入新 session sidecar。 */
export function stampNewSessionModel(userDataRoot: string, cwd: string, sessionDir: string): void {
  const files = listSessionFilesByMtime(sessionDir);
  // clearContext 刚创建的是最新文件；模型从更早会话继承
  const newest = files[0];
  if (!newest) return;
  let ref: ModelRef | null = null;
  for (const older of files.slice(1)) {
    ref = readSessionModelRef(older);
    if (ref) break;
  }
  if (!ref) ref = firstEnabledModelRef(userDataRoot);
  if (!ref) return;
  writeSessionModelRef(newest, ref);
  rememberActiveModel(userDataRoot, ref);
}

export function modelConfigKey(model: Pick<ModelConfig, "templateId" | "modelId">): string {
  return `${model.templateId}::${model.modelId}`;
}
