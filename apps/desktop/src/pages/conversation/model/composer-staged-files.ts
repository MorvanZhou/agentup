import { attachmentPathsInText } from "./attachment-ref";

/**
 * 根据 Composer 正文变化决定要删掉哪些 staging 路径。
 * 发送/整框清空时保留盘上文件（历史消息仍引用）；仅从非空正文中去掉某引用时才删。
 */
export function stagedPathsToRemove(
  prevText: string,
  nextText: string,
  tracked: ReadonlySet<string>,
): string[] {
  if (!nextText.trim()) return [];
  const next = attachmentPathsInText(nextText);
  const before = attachmentPathsInText(prevText);
  const removed: string[] = [];
  for (const path of before) {
    if (next.has(path) || !tracked.has(path)) continue;
    removed.push(path);
  }
  return removed;
}
