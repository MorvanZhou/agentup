import { expect, it } from "vitest";

import { DESKTOP_PULSE_ACTIVE_MS } from "../../src/app/desktop-pulse-interval";
import {
  FOLLOW_UP_POLL_MS,
  GROUP_OPEN_RELOAD_MS,
  groupOpenNeedsReloadPoll,
} from "../../src/pages/conversation/model/conversation-poll";

it("开房 / followUp 轮询与 pulse 活跃拍对齐", () => {
  expect(GROUP_OPEN_RELOAD_MS).toBe(DESKTOP_PULSE_ACTIVE_MS);
  expect(FOLLOW_UP_POLL_MS).toBe(DESKTOP_PULSE_ACTIVE_MS);
});

it("只在执掌者发言中才轮询 getGroup；task/pending 交给 pulse", () => {
  expect(groupOpenNeedsReloadPoll(null)).toBe(false);
  expect(groupOpenNeedsReloadPoll(undefined)).toBe(false);
  expect(groupOpenNeedsReloadPoll({})).toBe(false);
  expect(groupOpenNeedsReloadPoll({ holderSpeaking: false })).toBe(false);
  expect(groupOpenNeedsReloadPoll({ holderSpeaking: true })).toBe(true);
});
