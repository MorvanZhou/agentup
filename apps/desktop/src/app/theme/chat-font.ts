import type { ChatFontSize } from "../../shared/model/runtime/runtime";

const MIRROR_KEY = "agentup.chatFontSize";

export interface ChatFontMirror {
  userId: string;
  chatFontSize: ChatFontSize;
}

let currentSize: ChatFontSize = "md";

export function isChatFontSize(value: unknown): value is ChatFontSize {
  return value === "sm" || value === "md" || value === "lg";
}

export function readChatFontMirror(userId?: string | null): ChatFontSize | null {
  const raw = localStorage.getItem(MIRROR_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as ChatFontMirror;
    if (!parsed || typeof parsed.userId !== "string" || !isChatFontSize(parsed.chatFontSize)) {
      return null;
    }
    if (userId && parsed.userId !== userId) return null;
    return parsed.chatFontSize;
  } catch {
    return null;
  }
}

export function writeChatFontMirror(userId: string, chatFontSize: ChatFontSize): void {
  localStorage.setItem(
    MIRROR_KEY,
    JSON.stringify({ userId, chatFontSize } satisfies ChatFontMirror),
  );
}

export function clearChatFontMirror(): void {
  localStorage.removeItem(MIRROR_KEY);
}

export function getChatFontSize(): ChatFontSize {
  return currentSize;
}

/** 应用到 document，供聊天气泡 / Markdown 继承 --chat-message-fs。 */
export function applyChatFontSize(size: ChatFontSize): void {
  currentSize = size;
  if (typeof document === "undefined") return;
  document.documentElement.dataset.chatFont = size;
}

/** 启动：有镜像用镜像，否则标准字号。 */
export function bootstrapChatFontSize(userId?: string | null): ChatFontSize {
  const mirrored = userId ? readChatFontMirror(userId) : null;
  const size = mirrored ?? "md";
  applyChatFontSize(size);
  return size;
}
