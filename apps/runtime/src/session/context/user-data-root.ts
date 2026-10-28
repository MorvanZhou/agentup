import path from "node:path";

import type { Visit } from "../../package/sync.js";

/**
 * visit.root → `<user_data_root>`。
 * 私人助理是 `users/<uid>/personal-assistant`（向上三级）。
 * Agent 是 `users/<uid>/agents/<id>`（向上四级）。停在 `users/` 会让群目录多拼一层。
 */
export function userDataRootFromVisit(visit: Visit): string {
  if (visit.kind === "personal") return path.resolve(visit.root, "..", "..", "..");
  return path.resolve(visit.root, "..", "..", "..", "..");
}
