import { isContextResetMessage } from "../../../../shared/model/chat/chat";
import { t, tf, type UiLocale } from "../../../../shared/model/ui/ui-locale";

/** 相邻消息间隔超过该值时显示时间分隔（与微信常见阈值一致）。 */
export const MESSAGE_TIME_GAP_MS = 5 * 60 * 1000;

export type TimedThreadMessage = {
  id: string;
  role: string;
  createdAt?: Date | string | number;
  metadata?: unknown;
};

/** 从消息 metadata / createdAt 解析毫秒时间；无效则 undefined。 */
export function messageCreatedAtMs(message: TimedThreadMessage): number | undefined {
  const fromMeta = readAgentUpCreatedAt(message.metadata);
  if (fromMeta !== undefined) return fromMeta;
  return coerceTimeMs(message.createdAt);
}

/** 微信风格时间文案：今天只显示时刻，昨天带「昨天」，更早带日期。 */
export function formatChatTimeLabel(atMs: number, nowMs = Date.now()): string {
  const at = new Date(atMs);
  if (Number.isNaN(at.getTime())) return "";
  const now = new Date(nowMs);
  const time = `${pad2(at.getHours())}:${pad2(at.getMinutes())}`;
  if (sameCalendarDay(at, now)) return time;
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (sameCalendarDay(at, yesterday)) return `昨天 ${time}`;
  if (at.getFullYear() === now.getFullYear()) {
    return `${at.getMonth() + 1}月${at.getDate()}日 ${time}`;
  }
  return `${at.getFullYear()}年${at.getMonth() + 1}月${at.getDate()}日 ${time}`;
}

/**
 * 会话侧栏「最新消息」时间：对齐微信会话列表。
 * 今天 HH:mm；昨天；近一周内星期；同年月日；跨年带年份。无有效时间返回空串。
 */
export function formatSidebarTimeLabel(
  atMs: number,
  locale: UiLocale,
  nowMs = Date.now(),
): string {
  if (!Number.isFinite(atMs) || atMs <= 0) return "";
  const at = new Date(atMs);
  if (Number.isNaN(at.getTime())) return "";
  const now = new Date(nowMs);
  if (sameCalendarDay(at, now)) {
    return `${pad2(at.getHours())}:${pad2(at.getMinutes())}`;
  }
  const dayDiff = calendarDayDiff(at, now);
  if (dayDiff === 1) return t("timeYesterdayOnly");
  if (dayDiff >= 2 && dayDiff <= 6) {
    const tag = locale === "en" ? "en-US" : "zh-CN";
    return new Intl.DateTimeFormat(tag, { weekday: "long" }).format(at);
  }
  const month = at.getMonth() + 1;
  const day = at.getDate();
  if (at.getFullYear() === now.getFullYear()) {
    return tf("timeMonthDayOnly", { month, day });
  }
  return tf("timeYearMonthDayOnly", { year: at.getFullYear(), month, day });
}

/**
 * 若应在 curr 前显示时间分隔则返回文案，否则 undefined。
 * 首条有效消息、或与上一条间隔 ≥ gap 时显示；「新对话」标记本身不显示时间条。
 */
export function timeSeparatorLabel(
  prev: TimedThreadMessage | undefined,
  curr: TimedThreadMessage,
  options: { gapMs?: number; nowMs?: number } = {},
): string | undefined {
  if (isContextResetMessage(curr)) return undefined;
  const currMs = messageCreatedAtMs(curr);
  if (currMs === undefined) return undefined;
  const gapMs = options.gapMs ?? MESSAGE_TIME_GAP_MS;
  if (!prev || isContextResetMessage(prev)) {
    return formatChatTimeLabel(currMs, options.nowMs);
  }
  const prevMs = messageCreatedAtMs(prev);
  if (prevMs === undefined || currMs - prevMs >= gapMs) {
    return formatChatTimeLabel(currMs, options.nowMs);
  }
  return undefined;
}

/** 为可见消息 id 生成「该条之前」应显示的时间文案。 */
export function timeLabelsForVisibleIds(
  messages: readonly TimedThreadMessage[],
  visibleIds: readonly string[],
  options: { gapMs?: number; nowMs?: number } = {},
): Map<string, string> {
  const indexById = new Map(messages.map((message, index) => [message.id, index]));
  const labels = new Map<string, string>();
  for (const id of visibleIds) {
    const index = indexById.get(id);
    if (index === undefined) continue;
    const curr = messages[index];
    if (!curr) continue;
    const prev = index > 0 ? messages[index - 1] : undefined;
    const label = timeSeparatorLabel(prev, curr, options);
    if (label) labels.set(id, label);
  }
  return labels;
}

function readAgentUpCreatedAt(metadata: unknown): number | undefined {
  if (!metadata || typeof metadata !== "object") return undefined;
  const meta = metadata as { agentUpCreatedAt?: unknown; custom?: { agentUpCreatedAt?: unknown } };
  return coerceTimeMs(meta.agentUpCreatedAt) ?? coerceTimeMs(meta.custom?.agentUpCreatedAt);
}

function coerceTimeMs(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) && ms > 0 ? ms : undefined;
  }
  if (typeof value === "string" && value.trim()) {
    const ms = Date.parse(value);
    return Number.isFinite(ms) && ms > 0 ? ms : undefined;
  }
  return undefined;
}

function sameCalendarDay(left: Date, right: Date): boolean {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

/** 按本地日历日：from → to 相差几天（同日 0，昨天 1）。 */
function calendarDayDiff(from: Date, to: Date): number {
  const start = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  const end = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((end - start) / 86_400_000);
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}
