import { isContextResetMessage } from "../../../../shared/model/chat/chat";
import { chatSurfaceKind } from "./chat-surface";

/** 可导航 user 达到此数才显示右侧锚点条。 */
export const USER_MESSAGE_NAV_MIN = 3;

/** 展开预览单行字数上限（含省略号）。 */
export const USER_MESSAGE_NAV_PREVIEW_MAX = 28;

/** 标尺凸出影响半径（按条目下标距离）。 */
export const USER_MESSAGE_NAV_DOCK_RANGE = 2.2;

export type UserMessageNavSource = {
  id: string;
  role?: string;
  parts?: readonly { type?: string; text?: string }[];
  metadata?: unknown;
};

export type UserMessageNavItem = {
  id: string;
  /** 已截断的预览；空串表示仅附件等无正文，UI 用词条回落。 */
  preview: string;
  /** 该消息在完整 thread.messages 中的下标，跳转揭窗用。 */
  index: number;
};

/** 是否渲染锚点导航。 */
export function shouldShowUserMessageNav(count: number): boolean {
  return count >= USER_MESSAGE_NAV_MIN;
}

/** 单行截断；空白压成单空格再 trim。 */
export function truncateUserNavPreview(
  text: string,
  max = USER_MESSAGE_NAV_PREVIEW_MAX,
): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (cleaned.length <= max) return cleaned;
  if (max <= 1) return "…";
  return `${cleaned.slice(0, max - 1)}…`;
}

function plainTextFromParts(parts: UserMessageNavSource["parts"]): string {
  if (!Array.isArray(parts)) return "";
  return parts
    .map((part) => (part.type === "text" && typeof part.text === "string" ? part.text : ""))
    .join("");
}

function isNavigableUserMessage(message: UserMessageNavSource): boolean {
  if (message.role !== "user") return false;
  if (isContextResetMessage({ role: message.role, id: message.id, metadata: message.metadata })) {
    return false;
  }
  if (chatSurfaceKind(message.metadata)) return false;
  return true;
}

/**
 * 从完整消息列表抽出可导航的 user 锚点（上旧下新）。
 * 不含 context reset / surface notice。
 */
export function collectUserMessageNavItems(
  messages: readonly UserMessageNavSource[],
): UserMessageNavItem[] {
  const items: UserMessageNavItem[] = [];
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (!message || !isNavigableUserMessage(message)) continue;
    items.push({
      id: message.id,
      index,
      preview: truncateUserNavPreview(plainTextFromParts(message.parts)),
    });
  }
  return items;
}

/**
 * 把窗口起点收到仍能盖住 targetIndex（目标须在 ids[start..] 内）。
 * pageSize 预留与翻页语义对齐；当前直接一次收到目标，避免连点多页。
 */
export function windowStartToInclude(
  currentStart: number,
  targetIndex: number,
  _pageSize = 20,
): number {
  if (targetIndex < 0) return currentStart;
  return Math.min(currentStart, targetIndex);
}

/**
 * 视口锚点：顶边已越过 pin 线的最后一条 user；都在下方时取第一条（贴顶短对话）。
 * 与 Thread.previousUserMessageEl 同一套 pin 语义。
 */
export function activeUserNavId(
  users: readonly { id: string; top: number }[],
  pinY: number,
): string | null {
  if (users.length === 0) return null;
  let anchor = -1;
  for (let i = 0; i < users.length; i += 1) {
    if (users[i]!.top <= pinY) anchor = i;
  }
  if (anchor === -1) return users[0]!.id;
  return users[anchor]!.id;
}

/** 相对 hover 下标的衰减 0..1；中心为 1，超出 range 为 0。 */
export function userNavDockFalloff(
  distance: number,
  range = USER_MESSAGE_NAV_DOCK_RANGE,
): number {
  if (distance < 0 || distance >= range) return 0;
  const t = 1 - distance / range;
  return t * t * (3 - 2 * t);
}

/**
 * 右对齐短横宽度：hover 中心最长（向左凸出），邻项按 falloff 衰减。
 * activeBoost：无 hover 时当前视口锚点的轻微加长。
 */
export function userNavTickWidthPx(input: {
  falloff: number;
  activeBoost?: number;
  base?: number;
  extra?: number;
}): number {
  const base = input.base ?? 10;
  const extra = input.extra ?? 18;
  const boost = input.activeBoost ?? 0;
  const factor = Math.max(input.falloff, boost);
  return base + extra * factor;
}
