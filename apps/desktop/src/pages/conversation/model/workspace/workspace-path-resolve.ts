/**
 * 消息里常出现包内相对路径（如 css/style.css），相对工作区根并不存在。
 * 用 WORK/ARTIFACT 下一层交付目录拼候选，点击预览时再逐个试读。
 */

const WORKSPACE_TOP = /^(WORK|ARTIFACT|ATTACHMENTS)(\/|$)/i;

export type WorkspacePackageRoot = {
  /** WORK / ARTIFACT */
  root: string;
  /** 该根下一级子目录名（from-…） */
  children: string[];
};

/**
 * 包内相对路径 → 工作区候选（ARTIFACT 优先于 WORK）。
 * 已是 WORK/ARTIFACT/ATTACHMENTS 开头则不扩展。
 */
export function workspacePackagePathCandidates(
  relativePath: string,
  roots: readonly WorkspacePackageRoot[],
): string[] {
  const path = relativePath.replace(/\\/g, "/").replace(/^\/+/, "").trim();
  if (!path || WORKSPACE_TOP.test(path) || path.includes("..")) return [];

  const out: string[] = [];
  const seen = new Set<string>();
  for (const { root, children } of roots) {
    const top = root.trim().replace(/\/+$/, "");
    if (!top) continue;
    for (const child of children) {
      const name = child.trim().replace(/^\/+|\/+$/g, "");
      if (!name || name.includes("..") || name.includes("/")) continue;
      const candidate = `${top}/${name}/${path}`;
      if (seen.has(candidate)) continue;
      seen.add(candidate);
      out.push(candidate);
    }
  }
  return out;
}
