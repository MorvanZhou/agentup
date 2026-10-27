import fs from "node:fs";
import path from "node:path";

import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionFactory } from "@earendil-works/pi-coding-agent";

import {
  diffArtifactSnapshots,
  snapshotArtifactDir,
  type ArtifactFileSnap,
} from "../workspace/artifact-diff.js";
import { ARTIFACT_DIR } from "../workspace/cwd-layout.js";

/** 委托子会话：点名本任务要投递给父 Agent 的 ARTIFACT 文件。 */
export const DELIVER_ARTIFACTS_TOOL = "deliver_artifacts";

export const AGENTUP_ARTIFACT_CONFIRM_TYPE = "agentup-artifact-confirm";

export type StagedArtifact = {
  path: string;
  size?: number;
};

export type DeliverArtifactsState = {
  confirmed: boolean;
  staged: StagedArtifact[];
};

const DeliverParams = Type.Object({
  paths: Type.Array(Type.String(), {
    description:
      "ARTIFACT files that belong to THIS task and should be delivered to the caller. " +
      "Use [] if none of the candidates are yours. Paths may be `file.ext` or `ARTIFACT/file.ext`.",
  }),
});

type DeliverDetails = {
  paths: string[];
  error?: string;
};

/**
 * 是否在 settle 前强制续写一轮确认。
 * 有候选、尚未确认、且本 run 未强制过 → true。
 */
export function shouldForceArtifactConfirm(input: {
  candidateCount: number;
  confirmed: boolean;
  forcedOnce: boolean;
}): boolean {
  if (input.candidateCount <= 0) return false;
  if (input.confirmed) return false;
  if (input.forcedOnce) return false;
  return true;
}

/** 协议续写：列出候选并要求立刻调用 deliver_artifacts。 */
export function buildArtifactConfirmPrompt(candidates: readonly string[]): string {
  const list = candidates.map((item) => `- ${item}`).join("\n");
  return [
    "ARTIFACT folder changed during this delegated task. Concurrent tasks may share the same folder.",
    "Call deliver_artifacts now with only the paths that belong to THIS brief.",
    "If none should be delivered (noise from other work), call deliver_artifacts with paths: [].",
    "Do not rewrite files; only confirm attachments.",
    "",
    "Candidates:",
    list || "- (none)",
  ].join("\n");
}

const OTHER_TOP_LEVEL = new Set(["WORK", "ATTACHMENTS"]);

/** 规范化为 `ARTIFACT/...`；拒逃逸与非 ARTIFACT 路径。 */
export function normalizeArtifactPaths(paths: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of paths) {
    if (typeof raw !== "string") throw new Error("paths must be strings under ARTIFACT/");
    const trimmed = raw.trim().replace(/\\/g, "/");
    if (!trimmed) throw new Error("empty path; use ARTIFACT/-relative paths");
    if (trimmed.includes("\0") || /\/{2,}/.test(trimmed)) {
      throw new Error(`path must be under ARTIFACT/: ${raw}`);
    }
    let relative: string;
    if (trimmed === ARTIFACT_DIR || trimmed === `${ARTIFACT_DIR}/`) {
      throw new Error("path must be a file under ARTIFACT/");
    } else if (trimmed.startsWith(`${ARTIFACT_DIR}/`)) {
      relative = trimmed;
    } else {
      const bare = trimmed.replace(/^\.?\//, "");
      const first = bare.split("/")[0] ?? "";
      if (OTHER_TOP_LEVEL.has(first) || first === ARTIFACT_DIR) {
        throw new Error(`path must be under ARTIFACT/: ${raw}`);
      }
      relative = `${ARTIFACT_DIR}/${bare}`;
    }
    if (!relative.startsWith(`${ARTIFACT_DIR}/`)) {
      throw new Error(`path must be under ARTIFACT/: ${raw}`);
    }
    const rest = relative.slice(ARTIFACT_DIR.length + 1);
    if (!rest || rest.split("/").some((part) => !part || part === "." || part === "..")) {
      throw new Error(`path must be under ARTIFACT/: ${raw}`);
    }
    relative = `${ARTIFACT_DIR}/${rest}`;
    if (seen.has(relative)) continue;
    seen.add(relative);
    out.push(relative);
  }
  return out;
}

/**
 * 校验路径存在且为常规文件，整表成功才返回。
 * `paths: []` 表示显式确认不投递。
 */
export function stageArtifactPaths(cwd: string, paths: readonly string[]): StagedArtifact[] {
  const normalized = normalizeArtifactPaths(paths);
  const staged: StagedArtifact[] = [];
  const root = path.resolve(cwd);
  const artifactRoot = path.resolve(root, ARTIFACT_DIR);
  for (const relative of normalized) {
    const absolute = path.resolve(root, ...relative.split("/"));
    if (absolute !== artifactRoot && !absolute.startsWith(`${artifactRoot}${path.sep}`)) {
      throw new Error(`path must be under ARTIFACT/: ${relative}`);
    }
    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(absolute);
    } catch {
      throw new Error(`missing ARTIFACT file: ${relative}`);
    }
    if (stat.isSymbolicLink()) throw new Error(`refusing symlink: ${relative}`);
    if (!stat.isFile()) throw new Error(`not a file: ${relative}`);
    staged.push({ path: relative, size: stat.size });
  }
  return staged;
}

/**
 * 父 ARTIFACT 下只建一层投递目录。
 * 有显示名时为 `from-<name>-<id>`，否则 `from-<id>`。
 */
export function deliveryDirName(agentId: string, agentName?: string): string {
  const id = sanitizeDeliveryLabel(agentId) || "agent";
  const name = sanitizeDeliveryLabel(agentName ?? "");
  if (!name || name === id) return `from-${id}`;
  return `from-${name}-${id}`;
}

/**
 * 去掉相对路径开头已有的 `from-…/`。
 * 那是下游投递信封；再套一层就会变成 `from-父/from-子/文件`。
 */
export function stripInboundDeliveryDirs(relUnderArtifact: string): string {
  const parts = relUnderArtifact
    .split("/")
    .filter((part) => part && part !== "." && part !== "..");
  while (parts.length > 1 && isInboundDeliveryDir(parts[0] ?? "")) {
    parts.shift();
  }
  return parts.join("/");
}

/** 把 staging 拷到父 cwd：`ARTIFACT/from-<name>-<id>/…`。空 staging 不写盘。 */
export function copyStagedArtifactsToParent(input: {
  sourceCwd: string;
  parentCwd: string;
  toAgentId: string;
  toAgentName?: string;
  staged: readonly StagedArtifact[];
}): string[] {
  if (input.staged.length === 0) return [];
  const folder = deliveryDirName(input.toAgentId, input.toAgentName);
  const delivered: string[] = [];
  const used = new Set<string>();
  const sourceRoot = path.resolve(input.sourceCwd);
  const parentRoot = path.resolve(input.parentCwd);
  const parentArtifact = path.join(parentRoot, ARTIFACT_DIR);
  fs.mkdirSync(parentArtifact, { recursive: true });

  for (const item of input.staged) {
    const relUnderArtifact = item.path.startsWith(`${ARTIFACT_DIR}/`)
      ? item.path.slice(ARTIFACT_DIR.length + 1)
      : item.path;
    const flat = stripInboundDeliveryDirs(relUnderArtifact);
    if (!flat) throw new Error(`refusing empty artifact path: ${item.path}`);
    let destRel = `${ARTIFACT_DIR}/${folder}/${flat}`;
    destRel = disambiguateDeliveryPath(destRel, used);
    used.add(destRel);
    const sourceAbs = path.resolve(sourceRoot, ...item.path.split("/"));
    const destAbs = path.resolve(parentRoot, ...destRel.split("/"));
    if (!destAbs.startsWith(`${parentArtifact}${path.sep}`)) {
      throw new Error(`refusing deliver outside parent ARTIFACT: ${destRel}`);
    }
    fs.mkdirSync(path.dirname(destAbs), { recursive: true });
    fs.copyFileSync(sourceAbs, destAbs);
    delivered.push(destRel);
  }
  return delivered;
}

function isInboundDeliveryDir(segment: string): boolean {
  return segment.startsWith("from-") && segment.length > "from-".length;
}

/** 同一批投递里展平后重名时，后到的文件加 `-2`、`-3`。 */
function disambiguateDeliveryPath(destRel: string, used: Set<string>): string {
  if (!used.has(destRel)) return destRel;
  const slash = destRel.lastIndexOf("/");
  const dir = destRel.slice(0, slash);
  const base = destRel.slice(slash + 1);
  const dot = base.lastIndexOf(".");
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const ext = dot > 0 ? base.slice(dot) : "";
  let next = destRel;
  let n = 2;
  while (used.has(next)) {
    next = `${dir}/${stem}-${n}${ext}`;
    n += 1;
  }
  return next;
}

function sanitizeDeliveryLabel(raw: string): string {
  const cleaned = raw
    .trim()
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/\.{2,}/g, "")
    .replace(/^\.+/, "")
    .replace(/^-+|[-.]+$/g, "")
    .replace(/-+/g, "-");
  return Array.from(cleaned).slice(0, 40).join("");
}

/** 本任务开始后新增/修改的 ARTIFACT 路径（不含 deleted）。 */
export function candidateArtifactPaths(
  before: ReadonlyMap<string, ArtifactFileSnap>,
  cwd: string,
): string[] {
  const after = snapshotArtifactDir(cwd);
  return diffArtifactSnapshots(before, after)
    .files.filter((file) => file.kind === "added" || file.kind === "modified")
    .map((file) => file.path)
    .sort((left, right) => left.localeCompare(right, "en"));
}

/**
 * 父会话：在 artifacts 快照之后落盘尚未投递的委托附件，
 * 使本回合 settle 差分能进入 ArtifactsPanel。
 */
export function createDelegationInboxExtension(options: {
  onAgentStart: () => void;
}): ExtensionFactory {
  return (pi) => {
    pi.on("agent_start", () => {
      options.onAgentStart();
    });
  };
}

/**
 * 委托隔离子会话：deliver_artifacts tool + before_settle 强制确认。
 * `state` 由调用方持有，run 结束后读 staging。
 */
export function createDeliverArtifactsExtension(options: {
  cwd: string;
  before: ReadonlyMap<string, ArtifactFileSnap>;
  state: DeliverArtifactsState;
}): ExtensionFactory {
  const { cwd, before, state } = options;
  return (pi) => {
    let forcedOnce = false;

    pi.registerTool(
      defineTool<typeof DeliverParams, DeliverDetails>({
        name: DELIVER_ARTIFACTS_TOOL,
        label: "Deliver artifacts",
        description:
          "Confirm which ARTIFACT files from this delegated task should be delivered to the caller. " +
          "Pass only paths that belong to this brief; use [] if nothing should be sent.",
        promptSnippet: "Confirm ARTIFACT attachments for this delegated task",
        promptGuidelines: [
          "When the protocol asks you to confirm attachments, call deliver_artifacts before finishing.",
          "Do not attach files produced by other concurrent tasks sharing ARTIFACT/.",
        ],
        parameters: DeliverParams,
        executionMode: "sequential",
        async execute(_toolCallId, params) {
          try {
            const staged = stageArtifactPaths(cwd, params.paths ?? []);
            state.staged = staged;
            state.confirmed = true;
            const summary =
              staged.length === 0
                ? "Confirmed: deliver no ARTIFACT files for this task."
                : `Confirmed ${staged.length} file(s):\n${staged.map((item) => `- ${item.path}`).join("\n")}`;
            return {
              content: [{ type: "text" as const, text: summary }],
              details: { paths: staged.map((item) => item.path) },
            };
          } catch (error) {
            const message = error instanceof Error && error.message ? error.message : "invalid paths";
            return {
              content: [{ type: "text" as const, text: `Error: ${message}` }],
              details: { paths: [], error: message },
            };
          }
        },
      }),
    );

    pi.on("agent_before_settle", (event, _ctx) => {
      if (event.outcome === "aborted" || event.outcome === "error") return;
      if (!event.context.canContinue) return;
      const candidates = candidateArtifactPaths(before, cwd);
      if (
        !shouldForceArtifactConfirm({
          candidateCount: candidates.length,
          confirmed: state.confirmed,
          forcedOnce,
        })
      ) {
        return;
      }
      forcedOnce = true;
      return {
        entries: [
          ...event.entries,
          {
            type: "custom_message" as const,
            customType: AGENTUP_ARTIFACT_CONFIRM_TYPE,
            content: buildArtifactConfirmPrompt(candidates),
            display: false,
          },
        ],
        continue: true,
      };
    });
  };
}
