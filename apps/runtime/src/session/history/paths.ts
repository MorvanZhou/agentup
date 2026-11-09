import path from "node:path";

/** 一对一 Agent 本机 cwd / sessions 路径；拒绝路径穿越。 */
export function visitSession(
  userDataRoot: string,
  userId: string,
  agentId: string,
): { cwd: string; sessionDir: string; visitRoot: string } {
  if (!userId || userId === "." || userId === ".." || /[/\\\u0000]/.test(userId)) throw new Error("请求无效");
  if (!agentId || agentId === "." || agentId === ".." || /[/\\\u0000]/.test(agentId)) throw new Error("请求无效");
  const visitRoot = path.join(userDataRoot, "users", userId, "agents", agentId);
  return { cwd: path.join(visitRoot, "cwd"), sessionDir: path.join(visitRoot, "sessions"), visitRoot };
}
