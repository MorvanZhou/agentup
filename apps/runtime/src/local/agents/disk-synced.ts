import fs from "node:fs";
import path from "node:path";

import { isLocalAgentId } from "./local-agent.js";

const AGENT_ID = /^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/;

/** 本机已投影的市场 Agent（跳过 loc-*）。控制面不可达时侧栏 / 委托发现共用。 */
export type DiskSyncedAgent = {
  agentId: string;
  name: string;
  role: string;
  background: string;
  remark: string;
  packageVersion: number;
  packageDigest: string;
  systemText?: string;
};

/**
 * 扫 `users/<uid>/agents/<id>/`：有 instance.json 且非 local 的视为已招募投影。
 * 不打 backend。
 */
export function listDiskSyncedAgents(userDataRoot: string, userId: string): DiskSyncedAgent[] {
  if (!userId || userId === "." || userId === ".." || /[/\\\u0000]/.test(userId)) return [];
  const root = path.join(userDataRoot, "users", userId, "agents");
  if (!fs.existsSync(root)) return [];
  const result: DiskSyncedAgent[] = [];
  for (const agentId of fs.readdirSync(root)) {
    if (!AGENT_ID.test(agentId) || isLocalAgentId(agentId)) continue;
    const agentRoot = path.join(root, agentId);
    const instancePath = path.join(agentRoot, "instance.json");
    if (!fs.existsSync(instancePath)) continue;
    let stored: Record<string, unknown> = {};
    try {
      stored = JSON.parse(fs.readFileSync(instancePath, "utf8")) as Record<string, unknown>;
    } catch {
      stored = {};
    }
    if (stored.kind === "local") continue;
    const systemPath = path.join(agentRoot, "cwd", ".pi", "SYSTEM.md");
    const systemText = fs.existsSync(systemPath)
      ? fs.readFileSync(systemPath, "utf8").trim()
      : "";
    const name =
      typeof stored.name === "string" && stored.name.trim()
        ? stored.name.trim()
        : nameFromSystem(systemText) || agentId;
    const role =
      typeof stored.role === "string" && stored.role.trim()
        ? stored.role.trim()
        : roleFromSystem(systemText);
    const fromCard =
      typeof stored.background === "string"
        ? stored.background.trim()
        : typeof stored.summary === "string"
          ? stored.summary.trim()
          : "";
    const fromSystem = systemText
      ? systemText
          .split(/\r?\n/)
          .find((line) => line.trim())
          ?.replace(/^#+\s*/, "")
          .trim()
          .slice(0, 200) || ""
      : "";
    const packageVersion =
      typeof stored.package_version === "number" &&
      Number.isInteger(stored.package_version) &&
      stored.package_version >= 1
        ? stored.package_version
        : 1;
    const packageDigest =
      typeof stored.package_digest === "string" && stored.package_digest.trim()
        ? stored.package_digest.trim()
        : `disk-${agentId}`;
    result.push({
      agentId,
      name,
      role,
      background: fromCard || fromSystem,
      remark: "",
      packageVersion,
      packageDigest,
      ...(systemText ? { systemText } : {}),
    });
  }
  return result;
}

/** 「你是Ex。岗位：汇率员。」→ Ex */
function nameFromSystem(systemText: string): string {
  const first = systemText.split(/\r?\n/).find((line) => line.trim())?.trim() ?? "";
  const matched = first.match(/^你是\s*([^。.\n]+)/);
  return matched?.[1]?.trim().slice(0, 40) ?? "";
}

/** 「你是Ex。岗位：汇率员。」→ 汇率员 */
function roleFromSystem(systemText: string): string {
  const first = systemText.split(/\r?\n/).find((line) => line.trim())?.trim() ?? "";
  const matched = first.match(/岗位[：:]\s*([^。.\n]+)/);
  return matched?.[1]?.trim().slice(0, 40) ?? "";
}
