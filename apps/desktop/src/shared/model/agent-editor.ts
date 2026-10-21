/** 本机创建 / 编辑 / 市场发布共用的表单载荷。 */
export type AgentEditorInput = {
  name: string;
  role: string;
  background: string;
  rules?: string;
  skillPaths?: string[];
  removeSkills?: string[];
  /** 编辑 / 发布更新时始终带上（可空对象清 MCP）；新建仅非空时带上 */
  mcpServers?: Record<string, unknown>;
  /** 新选头像的 data URL（已压缩）；未改则省略 */
  avatarDataUrl?: string;
};

export type AgentEditorInitial = {
  name: string;
  role: string;
  background: string;
  rules?: string;
  skills?: string[];
  mcpServers?: Record<string, unknown>;
  /** 已有头像展示 URL 或 data URL */
  avatarUrl?: string;
};

/** 决定提交按钮文案与编辑语义。 */
export type AgentEditorVariant = "local-create" | "local-edit" | "publish-create" | "publish-edit";

/** 名片层是否相对 initial 有变更（含规则与新头像）。 */
export function agentEditorProfileChanged(
  input: AgentEditorInput,
  initial: AgentEditorInitial | null | undefined,
): boolean {
  if (input.avatarDataUrl) return true;
  if (!initial) {
    return Boolean(input.rules?.trim() || input.name || input.role || input.background);
  }
  if (input.name !== initial.name) return true;
  if (input.role !== initial.role) return true;
  if (input.background !== initial.background) return true;
  if ((input.rules ?? "") !== (initial.rules ?? "")) return true;
  return false;
}

/** 能力包是否有变更（skills / MCP）；规则不算能力包。 */
export function agentEditorCapabilityChanged(
  input: AgentEditorInput,
  initial: AgentEditorInitial | null | undefined,
): boolean {
  if (input.skillPaths?.length) return true;
  if (input.removeSkills?.length) return true;
  const nextMcp = input.mcpServers ?? {};
  const prevMcp = initial?.mcpServers ?? {};
  return JSON.stringify(nextMcp) !== JSON.stringify(prevMcp);
}
