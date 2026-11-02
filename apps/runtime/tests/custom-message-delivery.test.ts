import { expect, it } from "vitest";

import { customMessageDelivery } from "../src/session/turn/custom-message-delivery.js";

it("Pi 会话：custom message 用 nextTurn，等 prompt() 再并进上下文", () => {
  expect(customMessageDelivery({})).toEqual({ deliverAs: "nextTurn" });
  expect(customMessageDelivery({ externalQuery: undefined })).toEqual({ deliverAs: "nextTurn" });
});

it("SDK / externalQuery 会话：立即 append，不用 nextTurn（否则永不 flush）", () => {
  const session = { externalQuery: async () => ({}) };
  expect(customMessageDelivery(session)).toEqual({});
});
