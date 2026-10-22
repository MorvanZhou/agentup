export const SIDEBAR_DEFAULT_WIDTH = 256;
export const SIDEBAR_MIN_WIDTH = 192;
export const WORKSPACE_DEFAULT_WIDTH = 320;
export const WORKSPACE_MIN_WIDTH = 224;
/** 对话主列最小宽度，避免消息区被右侧栏拖到无法阅读。 */
export const THREAD_MIN_WIDTH = 320;

const SIDEBAR_KEY = "agentup.conversation.sidebarWidth";
const WORKSPACE_KEY = "agentup.conversation.workspaceWidth";

export function clampPaneWidth(width: number, min: number, max: number): number {
  if (!Number.isFinite(width)) return min;
  return Math.min(max, Math.max(min, Math.round(width)));
}

export function maxSidebarWidth(containerWidth: number): number {
  return Math.max(SIDEBAR_MIN_WIDTH, Math.floor(containerWidth * 0.45));
}

export function maxWorkspaceWidth(containerWidth: number): number {
  const byRatio = Math.floor(containerWidth * 0.55);
  const leaveForThread = containerWidth - THREAD_MIN_WIDTH;
  return Math.max(0, Math.min(byRatio, leaveForThread));
}

/** 按容器夹紧工作空间宽度；空间不足时优先保住对话区 min。 */
export function clampWorkspaceWidth(width: number, containerWidth: number): number {
  const max = maxWorkspaceWidth(containerWidth);
  const min = Math.min(WORKSPACE_MIN_WIDTH, max);
  return clampPaneWidth(width, min, max);
}

export function loadSidebarWidth(): number {
  return loadWidth(SIDEBAR_KEY, SIDEBAR_DEFAULT_WIDTH, SIDEBAR_MIN_WIDTH);
}

export function loadWorkspaceWidth(): number {
  return loadWidth(WORKSPACE_KEY, WORKSPACE_DEFAULT_WIDTH, WORKSPACE_MIN_WIDTH);
}

export function rememberSidebarWidth(width: number): void {
  localStorage.setItem(SIDEBAR_KEY, String(width));
}

export function rememberWorkspaceWidth(width: number): void {
  localStorage.setItem(WORKSPACE_KEY, String(width));
}

function loadWidth(key: string, fallback: number, min: number): number {
  const raw = localStorage.getItem(key);
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return clampPaneWidth(value, min, Number.POSITIVE_INFINITY);
}
