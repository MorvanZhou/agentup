import fs from "node:fs";
import path from "node:path";

/** 扫描本机已投影的 Agent，返回 agent_id → package_version。 */
export function readLocalPackageVersions(userDataRoot: string, userId: string): Record<string, number> {
  if (!userId || userId === "." || userId === ".." || /[/\\\u0000]/.test(userId)) return {};
  const root = path.join(userDataRoot, "users", userId, "agents");
  if (!fs.existsSync(root)) return {};
  const versions: Record<string, number> = {};
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const version = readPackageVersion(path.join(root, entry.name, "instance.json"), entry.name);
    if (version !== undefined) versions[entry.name] = version;
  }
  return versions;
}

function readPackageVersion(filePath: string, agentId: string): number | undefined {
  try {
    const data = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
    if (!data || typeof data !== "object" || Array.isArray(data)) return undefined;
    const record = data as Record<string, unknown>;
    if (record.agent_id !== agentId) return undefined;
    if (typeof record.package_version !== "number" || !Number.isInteger(record.package_version) || record.package_version < 1) {
      return undefined;
    }
    return record.package_version;
  } catch {
    return undefined;
  }
}
