import type { ExtensionContext, ExtensionFactory } from "@earendil-works/pi-coding-agent";

import {
  diffArtifactSnapshots,
  parseArtifactsEntryData,
  snapshotArtifactDir,
  type AgentUpArtifactsData,
} from "../workspace/artifact-diff.js";

/** 会话 custom entry：本回合 ARTIFACT/ 目录差分。 */
export const AGENTUP_ARTIFACTS_CUSTOM_TYPE = "agentup-artifacts";

export { parseArtifactsEntryData };
export type { AgentUpArtifactsData };

/**
 * agent_start 拍 ARTIFACT 快照；agent_settled 差分并写入 custom entry。
 * 同一回合若因输出上限续写再次 agent_start，保留首次快照。
 */
export function createArtifactsExtension(): ExtensionFactory {
  return (pi) => {
    let before: ReturnType<typeof snapshotArtifactDir> | null = null;

    pi.on("agent_start", (_event, ctx: ExtensionContext) => {
      if (before !== null) return;
      before = snapshotArtifactDir(ctx.cwd);
    });

    pi.on("agent_settled", (_event, ctx: ExtensionContext) => {
      const base = before ?? new Map();
      before = null;
      const after = snapshotArtifactDir(ctx.cwd);
      const diff = diffArtifactSnapshots(base, after);
      if (diff.files.length === 0) return;
      pi.appendEntry<AgentUpArtifactsData>(AGENTUP_ARTIFACTS_CUSTOM_TYPE, diff);
    });
  };
}
