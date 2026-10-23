import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionFactory } from "@earendil-works/pi-coding-agent";

/** 本机墙钟：只读、免审批；需要日期/时间时优先于 shell `date`。 */
export const GET_LOCAL_TIME_TOOL = "get_local_time";

export type LocalTimeInfo = {
  /** 带偏移的本地 ISO（无毫秒），如 2026-03-23T15:58:12+08:00 */
  isoLocal: string;
  /** UTC ISO（含毫秒） */
  utc: string;
  /** IANA 时区，如 Asia/Shanghai */
  timeZone: string;
  /** 相对 UTC 的偏移，如 +08:00 */
  offset: string;
  /** 英文星期全称（与 ISO 日期同属本地日历） */
  weekday: string;
  epochMs: number;
};

type LocalTimeDetails = LocalTimeInfo;

const LocalTimeParams = Type.Object({});

/** 读取本机（或指定时区）墙钟；`now` 仅供测试注入。 */
export function readLocalTime(now: Date = new Date(), timeZone?: string): LocalTimeInfo {
  const zone = resolveTimeZone(timeZone);
  const parts = localParts(now, zone);
  const offset = formatOffset(parts.offsetMinutes);
  const isoLocal = `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${offset}`;
  return {
    isoLocal,
    utc: now.toISOString(),
    timeZone: zone,
    offset,
    weekday: parts.weekday,
    epochMs: now.getTime(),
  };
}

export function formatLocalTime(info: LocalTimeInfo): string {
  return `Local time: ${info.isoLocal} (${info.timeZone}, ${info.weekday})`;
}

export function createLocalTimeExtension(): ExtensionFactory {
  return (pi) => {
    pi.registerTool(
      defineTool<typeof LocalTimeParams, LocalTimeDetails>({
        name: GET_LOCAL_TIME_TOOL,
        label: "Local Time",
        description:
          "Read the host's current local date and time (ISO with offset, IANA timezone, weekday). " +
          "Use when the answer depends on \"now\", \"today\", or scheduling — do not guess the clock. " +
          "Prefer this over shell date/Get-Date (no approval needed).",
        promptSnippet: "Read the host local date/time",
        promptGuidelines: [
          "Call get_local_time when the user asks about today, now, deadlines, or relative times (this week / tomorrow).",
          "Do not invent timestamps; do not use bash/powershell date for ordinary clock reads.",
        ],
        parameters: LocalTimeParams,
        executionMode: "parallel",
        annotations: {
          readOnlyHint: true,
          openWorldHint: false,
          destructiveHint: false,
        },
        async execute() {
          const info = readLocalTime();
          return {
            content: [{ type: "text", text: formatLocalTime(info) }],
            details: info,
          };
        },
      }),
    );
  };
}

function resolveTimeZone(forced?: string): string {
  const trimmed = forced?.trim();
  if (trimmed) return trimmed;
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

type LocalParts = {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
  second: string;
  weekday: string;
  offsetMinutes: number;
};

function localParts(now: Date, timeZone: string): LocalParts {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "long",
    hourCycle: "h23",
  });
  const bag: Record<string, string> = {};
  for (const part of dtf.formatToParts(now)) {
    if (part.type !== "literal") bag[part.type] = part.value;
  }
  const year = bag.year ?? "1970";
  const month = bag.month ?? "01";
  const day = bag.day ?? "01";
  const hour = bag.hour ?? "00";
  const minute = bag.minute ?? "00";
  const second = bag.second ?? "00";
  const weekday = bag.weekday ?? "Thursday";
  const asUtc = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
  );
  const offsetMinutes = Math.round((asUtc - now.getTime()) / 60_000);
  return { year, month, day, hour, minute, second, weekday, offsetMinutes };
}

function formatOffset(offsetMinutes: number): string {
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMinutes);
  const hours = String(Math.floor(abs / 60)).padStart(2, "0");
  const minutes = String(abs % 60).padStart(2, "0");
  return `${sign}${hours}:${minutes}`;
}
