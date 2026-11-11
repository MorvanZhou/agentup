import fs from "node:fs";
import path from "node:path";

import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionFactory } from "@earendil-works/pi-coding-agent";

import {
  normalizeArtifactPaths,
  stageArtifactPaths,
} from "../tools/deliver-artifacts.js";

/** 会话 custom entry：本回合对用户展示的交付附件（与 ARTIFACT 差分 tab 分离）。 */
export const AGENTUP_DELIVERABLES_CUSTOM_TYPE = "agentup-deliverables";

export const PRESENT_ARTIFACTS_TOOL = "present_artifacts";

export type AgentUpDeliverable = {
  path: string;
  size?: number;
};

export type AgentUpDeliverablesData = {
  files: AgentUpDeliverable[];
  /** 本回合调用过 present_artifacts。 */
  curated?: boolean;
};

export type DeliverablePending = {
  taskId: string;
  files: AgentUpDeliverable[];
};

export type PresentArtifactsAction = "set" | "add" | "remove";

type PresentDetails = {
  action: PresentArtifactsAction;
  paths: string[];
  error?: string;
};

const PresentParams = Type.Object({
  action: Type.Union([Type.Literal("set"), Type.Literal("add"), Type.Literal("remove")], {
    description:
      "set replaces the footer deliverables grid; add merges paths; remove drops paths. " +
      "Use set with [] to hide the grid for this reply.",
  }),
  paths: Type.Array(Type.String(), {
    description:
      "ARTIFACT files to present under the reply (ARTIFACT/… or bare names under ARTIFACT/).",
  }),
});

/** 解析 custom entry / metadata。 */
export function parseDeliverablesEntryData(data: unknown): AgentUpDeliverablesData | undefined {
  if (!data || typeof data !== "object") return undefined;
  const list = (data as { files?: unknown }).files;
  if (!Array.isArray(list)) return undefined;
  const files: AgentUpDeliverable[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const record = item as { path?: unknown; size?: unknown };
    if (typeof record.path !== "string" || !record.path.startsWith("ARTIFACT/")) continue;
    const entry: AgentUpDeliverable = { path: record.path };
    if (typeof record.size === "number" && Number.isFinite(record.size) && record.size >= 0) {
      entry.size = record.size;
    }
    files.push(entry);
  }
  const curated = (data as { curated?: unknown }).curated === true;
  if (files.length === 0 && !curated) return undefined;
  return curated ? { files, curated: true } : { files };
}

/** 把待展示文件并入 Map（按 path 去重，后写覆盖 size）。 */
export function mergeDeliverableFiles(
  target: Map<string, AgentUpDeliverable>,
  files: readonly AgentUpDeliverable[],
): void {
  for (const file of files) {
    if (!file.path.startsWith("ARTIFACT/")) continue;
    const entry: AgentUpDeliverable = { path: file.path };
    if (typeof file.size === "number" && Number.isFinite(file.size) && file.size >= 0) {
      entry.size = file.size;
    }
    target.set(file.path, entry);
  }
}

/**
 * set/add 且 paths 非空时，要求 cwd 下 ARTIFACT 文件真实存在。
 * remove / 清空网格跳过；无 cwd 时无法校验（测试用）。
 * 裸名会先规范成 ARTIFACT/…，缺文件抛错，避免点名死链进交付网格。
 */
export function requirePresentableArtifacts(input: {
  action: PresentArtifactsAction;
  paths: readonly string[];
  cwd?: string;
}): void {
  if (!input.cwd) return;
  if (input.action === "remove") return;
  if (input.paths.length === 0) return;
  stageArtifactPaths(input.cwd, input.paths);
}

/** present_artifacts 对内存展示集的纯更新。 */
export function applyPresentArtifactsAction(input: {
  action: PresentArtifactsAction;
  paths: readonly string[];
  current: Map<string, AgentUpDeliverable>;
  cwd?: string;
}): Map<string, AgentUpDeliverable> {
  const normalized = normalizeArtifactPaths(input.paths);
  if (input.action === "set") {
    const next = new Map<string, AgentUpDeliverable>();
    for (const filePath of normalized) {
      // 保留自动种子里已有的 size，再尝试 cwd stat（磁盘优先）。
      next.set(filePath, deliverableWithSize(filePath, input.cwd, input.current.get(filePath)));
    }
    return next;
  }
  if (input.action === "remove") {
    const next = new Map(input.current);
    for (const filePath of normalized) next.delete(filePath);
    return next;
  }
  const next = new Map(input.current);
  for (const filePath of normalized) {
    next.set(filePath, deliverableWithSize(filePath, input.cwd, input.current.get(filePath)));
  }
  return next;
}

/** 落盘前补 size：present_artifacts / 自动种子都可能缺字段。 */
export function enrichDeliverableSizes(
  files: Map<string, AgentUpDeliverable>,
  cwd?: string,
): void {
  if (!cwd) return;
  for (const [filePath, file] of files) {
    if (typeof file.size === "number" && Number.isFinite(file.size) && file.size >= 0) continue;
    files.set(filePath, deliverableWithSize(filePath, cwd, file));
  }
}

function deliverableWithSize(
  rel: string,
  cwd?: string,
  known?: AgentUpDeliverable,
): AgentUpDeliverable {
  const entry: AgentUpDeliverable = { path: rel };
  if (typeof known?.size === "number" && Number.isFinite(known.size) && known.size >= 0) {
    entry.size = known.size;
  }
  if (!cwd) return entry;
  try {
    const abs = path.resolve(cwd, ...rel.split("/"));
    const size = fs.statSync(abs).size;
    if (Number.isFinite(size) && size >= 0) entry.size = size;
  } catch {
    // 缺文件仍允许点名展示（群共享路径可能不在私有 cwd）；保留 known.size
  }
  return entry;
}

function snapshotFiles(map: Map<string, AgentUpDeliverable>): AgentUpDeliverable[] {
  return [...map.values()].sort((left, right) => left.path.localeCompare(right.path, "en"));
}

/**
 * 父 / 执掌会话：自动挂未呈现的委托交付物，并提供 present_artifacts 覆盖本轮网格。
 * 同一回合因输出上限续写再次 agent_start 时保留本回合展示集。
 */
export function createDeliverablesExtension(options: {
  listPending: () => DeliverablePending[];
  markPresented: (taskIds: readonly string[]) => void;
  cwd?: string;
}): ExtensionFactory {
  return (pi) => {
    let started = false;
    let curated = false;
    const files = new Map<string, AgentUpDeliverable>();
    const seededTaskIds: string[] = [];

    function seedFromPending(): void {
      if (curated) return;
      for (const item of options.listPending()) {
        if (!seededTaskIds.includes(item.taskId)) seededTaskIds.push(item.taskId);
        mergeDeliverableFiles(files, item.files);
      }
    }

    pi.registerTool(
      defineTool<typeof PresentParams, PresentDetails>({
        name: PRESENT_ARTIFACTS_TOOL,
        label: "Present artifacts",
        description:
          "Choose which ARTIFACT files appear in the deliverables grid under this reply. " +
          "By default the platform already attaches confirmed delegation deliveries; use this to add, remove, or replace that set. " +
          "Paths must already exist under ARTIFACT/ (WORK/ and missing files are rejected).",
        promptSnippet: "Curate the deliverables grid under this reply",
        promptGuidelines: [
          "Call present_artifacts only when you need to change which files the user sees under your reply.",
          "Paths must be existing files under ARTIFACT/ (ARTIFACT/… or bare names that resolve there).",
          "Do not present WORK/ drafts; copy or write finished files into ARTIFACT/ first.",
          "Use action set with [] to hide the grid.",
        ],
        parameters: PresentParams,
        executionMode: "sequential",
        async execute(_toolCallId, params) {
          try {
            const action = params.action as PresentArtifactsAction;
            const paths = params.paths ?? [];
            // 先校验再改内存集：缺文件 / WORK 路径不得进网格
            requirePresentableArtifacts({ action, paths, cwd: options.cwd });
            const next = applyPresentArtifactsAction({
              action,
              paths,
              current: files,
              cwd: options.cwd,
            });
            files.clear();
            for (const [key, value] of next) files.set(key, value);
            curated = true;
            const list = snapshotFiles(files);
            const summary =
              list.length === 0
                ? `Deliverables grid cleared (action=${action}).`
                : `Deliverables grid now has ${list.length} file(s) (action=${action}):\n` +
                  list.map((item) => `- ${item.path}`).join("\n");
            return {
              content: [{ type: "text" as const, text: summary }],
              details: { action, paths: list.map((item) => item.path) },
            };
          } catch (error) {
            const message = error instanceof Error && error.message ? error.message : "invalid paths";
            return {
              content: [{ type: "text" as const, text: `Error: ${message}` }],
              details: { action: params.action as PresentArtifactsAction, paths: [], error: message },
            };
          }
        },
      }),
    );

    pi.on("agent_start", () => {
      if (started) return;
      started = true;
      curated = false;
      files.clear();
      seededTaskIds.length = 0;
      seedFromPending();
    });

    pi.on("agent_settled", () => {
      // sync 委托可能在回合中途落盘：未 curated 时再并一次。
      seedFromPending();
      enrichDeliverableSizes(files, options.cwd);
      const list = snapshotFiles(files);
      if (list.length === 0 && !curated) {
        started = false;
        return;
      }
      const payload: AgentUpDeliverablesData = curated
        ? { files: list, curated: true }
        : { files: list };
      pi.appendEntry<AgentUpDeliverablesData>(AGENTUP_DELIVERABLES_CUSTOM_TYPE, payload);
      if (seededTaskIds.length > 0) options.markPresented(seededTaskIds);
      started = false;
    });
  };
}
