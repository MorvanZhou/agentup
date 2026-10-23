import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";

import { t } from "../i18n/index.js";
import type { UiLocale } from "../i18n/locale.js";

/**
 * 流式退化护栏：过滤可见 special token，并在刷屏 / 尾部复读时 abort。
 *
 * 不回写 Pi transcript；只影响投影层文案与是否中止当前 run。
 * 形态对齐会话层 interceptor：有界、默认可观测、后续可插更多 detector。
 */

/** 尾部缓冲上限（字符）。 */
export const STREAM_GUARD_TAIL_CHARS = 4_000;

/** 同一 turn 内完整 special token 命中次数达到此值则 abort。 */
export const STREAM_GUARD_SPECIAL_ABORT_COUNT = 8;

/** 尾部复读：unit 最短/最长（字符）。 */
export const STREAM_GUARD_REPEAT_MIN_UNIT = 8;
export const STREAM_GUARD_REPEAT_MAX_UNIT = 256;

/** 同一 unit 连续重复次数达到此值则 abort。 */
export const STREAM_GUARD_REPEAT_MIN_REPEATS = 8;

/**
 * 完整闭合的模型控制符：
 * - `<｜…｜>` 混元 / DeepSeek 全角竖线
 * - `<|…|>` ChatML / Llama 等
 */
export const SPECIAL_TOKEN_RE =
  /<\|(?:(?!<\|)[\s\S])*?\|>|<｜(?:(?!<｜)[\s\S])*?｜>/g;

export type StreamGuardState = {
  /** 最近尾部文本（已 sanitize），用于复读检测。 */
  tail: string;
  /** 本轮累计完整 special 命中次数。 */
  specialHits: number;
  /** 跨 delta 未闭合的半截前缀。 */
  pending: string;
};

export type StreamGuardFeedResult = {
  /** 可供 UI 展示的增量（已去掉完整 special；可能为空）。 */
  text: string;
  /** 是否应中止当前生成。 */
  abort: boolean;
};

export type StreamGuardDetector = (
  state: StreamGuardState,
  delta: string,
) => StreamGuardFeedResult;

const trippedSessions = new WeakMap<object, true>();

export function createStreamGuardState(): StreamGuardState {
  return { tail: "", specialHits: 0, pending: "" };
}

export function resetStreamGuardState(state: StreamGuardState): void {
  state.tail = "";
  state.specialHits = 0;
  state.pending = "";
}

/** Extension abort 时记下；调用方 consume 后清除，避免与用户手动 abort 混淆。 */
export function noteStreamDegeneration(sessionKey: object): void {
  trippedSessions.set(sessionKey, true);
}

export function consumeStreamDegeneration(sessionKey: object): boolean {
  const hit = trippedSessions.has(sessionKey);
  if (hit) trippedSessions.delete(sessionKey);
  return hit;
}

export function peekStreamDegeneration(sessionKey: object): boolean {
  return trippedSessions.has(sessionKey);
}

export function streamDegenerationAbortedMessage(locale?: UiLocale | string | null): string {
  return t("chat.streamDegenerationAborted", locale);
}

/** 去掉已完整闭合的 special；半截 `<|` / `<｜` 留给 pending。 */
export function sanitizeStreamText(input: string): {
  text: string;
  pending: string;
  specialCount: number;
} {
  if (!input) return { text: "", pending: "", specialCount: 0 };

  SPECIAL_TOKEN_RE.lastIndex = 0;
  let specialCount = 0;
  const withoutComplete = input.replace(SPECIAL_TOKEN_RE, () => {
    specialCount += 1;
    return "";
  });

  const half = findUnclosedSpecialPrefix(withoutComplete);
  if (half < 0) {
    return { text: withoutComplete, pending: "", specialCount };
  }
  return {
    text: withoutComplete.slice(0, half),
    pending: withoutComplete.slice(half),
    specialCount,
  };
}

/**
 * 喂入一段流式 delta。`detectors` 默认含 special 刷屏与尾部复读；
 * 任一 detector 要求 abort 即中止（仍返回已 sanitize 的可见增量）。
 */
export function feedDelta(
  state: StreamGuardState,
  delta: string,
  detectors: StreamGuardDetector[] = DEFAULT_DETECTORS,
): StreamGuardFeedResult {
  if (!delta) return { text: "", abort: false };

  const combined = state.pending + delta;
  const sanitized = sanitizeStreamText(combined);
  state.pending = sanitized.pending;
  state.specialHits += sanitized.specialCount;

  const visible = sanitized.text;
  if (visible) {
    state.tail = (state.tail + visible).slice(-STREAM_GUARD_TAIL_CHARS);
  }

  let abort = false;
  for (const detector of detectors) {
    const result = detector(state, visible);
    if (result.abort) abort = true;
  }
  return { text: visible, abort };
}

export function specialTokenFloodDetector(state: StreamGuardState): StreamGuardFeedResult {
  return {
    text: "",
    abort: state.specialHits >= STREAM_GUARD_SPECIAL_ABORT_COUNT,
  };
}

export function tailRepetitionDetector(state: StreamGuardState): StreamGuardFeedResult {
  return {
    text: "",
    abort: hasTailRepetition(
      state.tail,
      STREAM_GUARD_REPEAT_MIN_REPEATS,
      STREAM_GUARD_REPEAT_MAX_UNIT,
      STREAM_GUARD_REPEAT_MIN_UNIT,
    ),
  };
}

const DEFAULT_DETECTORS: StreamGuardDetector[] = [
  specialTokenFloodDetector,
  tailRepetitionDetector,
];

/**
 * 检测文本尾部是否卡在短 unit 的连续复读。
 * 对齐混元 OCR 官方 `has_tail_repetition` 思路，阈值偏保守。
 */
export function hasTailRepetition(
  text: string,
  minRepeats: number = STREAM_GUARD_REPEAT_MIN_REPEATS,
  maxUnit: number = STREAM_GUARD_REPEAT_MAX_UNIT,
  minUnit: number = STREAM_GUARD_REPEAT_MIN_UNIT,
): boolean {
  const n = text.length;
  if (n < minRepeats * minUnit) return false;
  const upper = Math.min(maxUnit, Math.floor(n / minRepeats));
  for (let length = minUnit; length <= upper; length += 1) {
    const unit = text.slice(-length);
    if (!unit.trim()) continue;
    let ok = true;
    for (let k = 2; k <= minRepeats; k += 1) {
      const start = n - length * k;
      if (start < 0 || text.slice(start, start + length) !== unit) {
        ok = false;
        break;
      }
    }
    if (ok) return true;
  }
  return false;
}

export type StreamGuardExtensionOptions = {
  detectors?: StreamGuardDetector[];
  enabled?: boolean;
};

/**
 * 挂到 `createAgentSession`：流式刷 special / 尾部复读时 abort。
 * 主会话与委托会话共用。
 */
export function createStreamGuardExtension(
  options: StreamGuardExtensionOptions = {},
): ExtensionFactory {
  const enabled = options.enabled !== false;
  const detectors = options.detectors ?? DEFAULT_DETECTORS;

  return (pi) => {
    if (!enabled) return;

    let state = createStreamGuardState();
    let aborted = false;

    pi.on("agent_start", () => {
      state = createStreamGuardState();
      aborted = false;
    });

    pi.on("message_update", (event, ctx) => {
      if (aborted) return;
      const update = event.assistantMessageEvent;
      if (!update || typeof update !== "object") return;
      const type = (update as { type?: string }).type;
      if (type !== "text_delta" && type !== "thinking_delta") return;
      const delta = (update as { delta?: unknown }).delta;
      if (typeof delta !== "string" || !delta) return;

      const result = feedDelta(state, delta, detectors);
      if (!result.abort) return;

      aborted = true;
      noteStreamDegeneration(ctx.sessionManager);
      ctx.abort();
    });
  };
}

/**
 * 仅当字符串**尾部**仍像未写完的 special（`<|…` / `<｜…`，中间无空白）时才挂起；
 * 避免把正文里的 `<|` 空格、`<|>` 等误吞进 pending。
 */
function findUnclosedSpecialPrefix(text: string): number {
  // 注意：交替必须用 ASCII `|`；全角 `｜` 只是字面量，写成 `(?:\|｜)` 会变成要同时匹配两种竖线。
  const match = /<(?:\||｜)[\w.▁-]*$/u.exec(text);
  if (!match || match.index === undefined) return -1;
  return match.index;
}
