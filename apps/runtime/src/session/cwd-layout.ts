import fs from "node:fs";
import path from "node:path";

/** 用户上传（Composer staging / @ 引用）。 */
export const ATTACHMENTS_DIR = "ATTACHMENTS";
/** Agent 过程与临时文件；用户默认不感知。 */
export const WORK_DIR = "WORK";
/** 给用户的最终产物。 */
export const ARTIFACT_DIR = "ARTIFACT";

/** 工作空间列表与路径校验时隐藏的 cwd 顶层名（与 `.pi` 同类）。 */
export const HIDDEN_WORKSPACE_TOP_LEVEL = new Set([WORK_DIR, ".pi"]);

/** 确保 cwd 三分目录存在；幂等。 */
export function ensureCwdLayout(cwd: string): void {
  fs.mkdirSync(path.join(cwd, ATTACHMENTS_DIR), { recursive: true });
  fs.mkdirSync(path.join(cwd, WORK_DIR), { recursive: true });
  fs.mkdirSync(path.join(cwd, ARTIFACT_DIR), { recursive: true });
}

/** 拼进 Pi appendSystemPrompt 的 cwd 工作规范。 */
export function formatCwdLayoutPrompt(): string {
  return [
    "# AgentUp Working Directories",
    "",
    "Your session working directory (`cwd`) has three reserved top-level folders. Follow them:",
    "",
    `- \`${ATTACHMENTS_DIR}/\`: files the user uploaded. Treat as read-only; do not modify or delete. Copy into \`${WORK_DIR}/\` if you need an editable copy.`,
    `- \`${WORK_DIR}/\`: your private scratch space for intermediate code, drafts, and temp results. Not the final handoff to the user.`,
    `- \`${ARTIFACT_DIR}/\`: final files the user should receive. Write completed artifacts here (create subfolders as needed).`,
    "",
    `Do not scatter work files at the cwd root. Prefer \`${WORK_DIR}/\` while iterating, then place finished outputs in \`${ARTIFACT_DIR}/\`.`,
  ].join("\n");
}
