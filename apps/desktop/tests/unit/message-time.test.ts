import { expect, it } from "vitest";

import {
  MESSAGE_TIME_GAP_MS,
  formatChatTimeLabel,
  messageCreatedAtMs,
  timeLabelsForVisibleIds,
  timeSeparatorLabel,
} from "../../src/pages/conversation/model/message-time.js";

/** 固定「现在」为本地 2026-10-12 15:30，避免依赖机器时区偏移写法。 */
const nowDate = new Date(2026, 9, 12, 15, 30, 0, 0);
const now = nowDate.getTime();

function atLocal(year: number, monthIndex: number, day: number, hour: number, minute: number): number {
  return new Date(year, monthIndex, day, hour, minute, 0, 0).getTime();
}

it("reads agentUpCreatedAt from metadata.custom or top-level", () => {
  const iso = new Date(atLocal(2026, 9, 12, 15, 0)).toISOString();
  expect(
    messageCreatedAtMs({
      id: "a",
      role: "user",
      metadata: { custom: { agentUpCreatedAt: iso } },
    }),
  ).toBe(Date.parse(iso));
  expect(
    messageCreatedAtMs({
      id: "b",
      role: "user",
      metadata: { agentUpCreatedAt: 1_700_000_000_000 },
    }),
  ).toBe(1_700_000_000_000);
  expect(messageCreatedAtMs({ id: "c", role: "user", createdAt: new Date(now) })).toBe(now);
  expect(messageCreatedAtMs({ id: "d", role: "user", createdAt: new Date(0) })).toBeUndefined();
});

it("formats chat time like WeChat", () => {
  expect(formatChatTimeLabel(atLocal(2026, 9, 12, 14, 5), now)).toBe("14:05");
  expect(formatChatTimeLabel(atLocal(2026, 9, 11, 21, 5), now)).toBe("昨天 21:05");
  expect(formatChatTimeLabel(atLocal(2026, 8, 1, 9, 0), now)).toBe("9月1日 09:00");
  expect(formatChatTimeLabel(atLocal(2025, 11, 31, 23, 59), now)).toBe("2025年12月31日 23:59");
});

it("shows separator for first message and after gap", () => {
  const firstMs = atLocal(2026, 9, 12, 15, 0);
  const first = {
    id: "u1",
    role: "user",
    metadata: { custom: { agentUpCreatedAt: new Date(firstMs).toISOString() } },
  };
  const soon = {
    id: "a1",
    role: "assistant",
    metadata: { custom: { agentUpCreatedAt: new Date(firstMs + 60_000).toISOString() } },
  };
  const laterMs = firstMs + 60_000 + MESSAGE_TIME_GAP_MS;
  const later = {
    id: "u2",
    role: "user",
    metadata: {
      custom: { agentUpCreatedAt: new Date(laterMs).toISOString() },
    },
  };
  expect(timeSeparatorLabel(undefined, first, { nowMs: now })).toBe("15:00");
  expect(timeSeparatorLabel(first, soon, { nowMs: now })).toBeUndefined();
  expect(timeSeparatorLabel(soon, later, { nowMs: now })).toBe(formatChatTimeLabel(laterMs, now));
});

it("skips separators on context-reset and treats next as first", () => {
  const reset = {
    id: "context-reset-1",
    role: "system",
    metadata: { custom: { agentUpKind: "context-reset" } },
  };
  const next = {
    id: "u3",
    role: "user",
    metadata: { custom: { agentUpCreatedAt: new Date(atLocal(2026, 9, 12, 16, 0)).toISOString() } },
  };
  expect(timeSeparatorLabel(undefined, reset, { nowMs: now })).toBeUndefined();
  expect(timeSeparatorLabel(reset, next, { nowMs: now })).toBe("16:00");
});

it("labels visible ids against the previous message in the full list", () => {
  const t0 = atLocal(2026, 9, 12, 15, 0);
  const messages = [
    { id: "a", role: "user", metadata: { custom: { agentUpCreatedAt: new Date(t0).toISOString() } } },
    { id: "b", role: "assistant", metadata: { custom: { agentUpCreatedAt: new Date(t0 + 60_000).toISOString() } } },
    {
      id: "c",
      role: "user",
      metadata: { custom: { agentUpCreatedAt: new Date(t0 + MESSAGE_TIME_GAP_MS + 60_000).toISOString() } },
    },
  ];
  const labels = timeLabelsForVisibleIds(messages, ["b", "c"], { nowMs: now });
  expect(labels.get("b")).toBeUndefined();
  expect(labels.get("c")).toBe("15:06");
});
