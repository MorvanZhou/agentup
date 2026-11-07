/** 和 mcp.json 同一份文档。编辑框按这个格式写，保存时只留一层 mcpServers。 */
export const MCP_PLACEHOLDER = `{
  "mcpServers": {
    "server-name": {
      "type": "stdio",
      "command": "executable-path",
      "args": ["arg1", "arg2"],
      "env": {
        "KEY": "value"
      }
    }
  }
}
`;

/** 整份 mcp.json 或只写 server 表，都收成 server 表。 */
export function mcpServersFromEditor(value: Record<string, unknown>): Record<string, unknown> {
  const nested = value.mcpServers;
  if (!nested || typeof nested !== "object" || Array.isArray(nested)) return value;
  if (Object.keys(value).length !== 1) return value;
  const record = nested as Record<string, unknown>;
  if (
    typeof record.command === "string" ||
    typeof record.url === "string" ||
    typeof record.type === "string"
  ) {
    return value;
  }
  return record;
}

/** server 名对应的值不是对象时返回这个名字。字符串值会在安装时报 mcpServers.x 必须是对象。 */
export function invalidMcpServerName(servers: Record<string, unknown>): string | undefined {
  for (const [name, value] of Object.entries(servers)) {
    if (!name || !value || typeof value !== "object" || Array.isArray(value)) return name || "(empty)";
  }
  return undefined;
}

export function formatMcpDocument(servers: Record<string, unknown> | undefined): string {
  if (!servers || !Object.keys(servers).length) return "";
  return `${JSON.stringify({ mcpServers: servers }, null, 2)}\n`;
}
