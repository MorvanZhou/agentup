/** 从工作区相对路径取出用于 chrome 展示的文件名。 */
export function previewFileName(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/").replace(/\/+$/, "");
  if (!normalized) return "";
  const slash = normalized.lastIndexOf("/");
  return slash >= 0 ? normalized.slice(slash + 1) : normalized;
}
