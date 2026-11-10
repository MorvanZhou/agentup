/**
 * 右侧栏（工作区 / 设置 / 预览）外壳 class。
 * - min-[730px]:relative：给左缘 absolute 拖条当定位祖先（static 会锚到整行左缘）
 * - z-40：压过 ChatPane 对话列 sideOpen 时的 z-30，否则把手半幅点不到
 */
export const RIGHT_PANE_SHELL_CLASS =
  "absolute inset-y-0 right-0 z-40 flex h-full shrink-0 min-[730px]:relative";
