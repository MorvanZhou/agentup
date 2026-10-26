export function joinWorkspacePath(directory: string, name: string): string {
  return directory ? `${directory}/${name}` : name;
}

export function parentWorkspacePath(directory: string): string {
  const index = directory.lastIndexOf("/");
  return index === -1 ? "" : directory.slice(0, index);
}

export function workspaceBaseName(filePath: string): string {
  const index = filePath.lastIndexOf("/");
  return index === -1 ? filePath : filePath.slice(index + 1);
}

export function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

/** 工作区文本是否应按 HTML 双模式（渲染 / 源码）预览。 */
export function isHtmlWorkspacePath(path: string): boolean {
  const base = workspaceBaseName(path).toLowerCase();
  return base.endsWith(".html") || base.endsWith(".htm");
}

/** 工作区文本是否应按 Markdown 双模式（渲染 / 原文）预览。 */
export function isMarkdownWorkspacePath(path: string): boolean {
  const base = workspaceBaseName(path).toLowerCase();
  return base.endsWith(".md") || base.endsWith(".mdx") || base.endsWith(".markdown");
}
