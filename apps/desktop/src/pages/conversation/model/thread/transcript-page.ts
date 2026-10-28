/** 用服务端最新一页替换已加载记录的尾部，保留已经翻出来的更早消息。 */
export function mergeNewestPage<T extends { id: string }>(
  loaded: readonly T[],
  page: readonly T[],
): T[] {
  if (page.length === 0) return [];
  const anchor = page[0]?.id;
  if (!anchor) return [...page];
  const index = loaded.findIndex((item) => item.id === anchor);
  if (index < 0) return [...page];
  return [...loaded.slice(0, index), ...page];
}
