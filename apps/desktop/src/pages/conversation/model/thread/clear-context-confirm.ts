const KEY = "agentup.clearContext.skipConfirm";

type SkipConfirm = {
  userId: string;
  skip: true;
};

/** 是否已对本账号关闭「新对话」确认弹窗。 */
export function shouldSkipClearContextConfirm(userId: string): boolean {
  if (!userId) return false;
  const raw = localStorage.getItem(KEY);
  if (!raw) return false;
  try {
    const parsed = JSON.parse(raw) as SkipConfirm;
    return parsed?.skip === true && parsed.userId === userId;
  } catch {
    return false;
  }
}

/** 记住本账号不再弹出「新对话」确认。 */
export function rememberSkipClearContextConfirm(userId: string): void {
  if (!userId) return;
  localStorage.setItem(KEY, JSON.stringify({ userId, skip: true } satisfies SkipConfirm));
}
