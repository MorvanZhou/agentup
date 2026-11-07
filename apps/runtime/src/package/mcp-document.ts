/**
 * 编辑框可以交来整份 mcp.json，也可以只交 server 表。
 * 落盘前收成 server 表，写文件时再包一层 mcpServers，避免变成 mcpServers.mcpServers。
 */
export function normalizeMcpServers(value: Record<string, unknown>): Record<string, unknown> {
  const nested = value.mcpServers;
  if (!nested || typeof nested !== "object" || Array.isArray(nested)) return value;
  if (Object.keys(value).length !== 1) return value;
  const record = nested as Record<string, unknown>;
  // 只有一个名叫 mcpServers 的 server 时，它自己带 command / url / type，不能拆开。
  if (
    typeof record.command === "string" ||
    typeof record.url === "string" ||
    typeof record.type === "string"
  ) {
    return value;
  }
  return record;
}
