import { expect, it } from "vitest";

import {
  mountedThreads,
  pruneVisited,
  rememberVisited,
} from "../../src/pages/conversation/model/visited-threads.js";

it("remembers each agent once when opened", () => {
  expect(rememberVisited([], "weather")).toEqual(["weather"]);
  expect(rememberVisited(["weather"], "weather")).toEqual(["weather"]);
  expect(rememberVisited(["weather"], "doctor")).toEqual(["weather", "doctor"]);
});

it("prunes dismissed agents from the visited set", () => {
  expect(pruneVisited(["weather", "doctor"], new Set(["weather"]))).toEqual(["weather"]);
});

it("pairs visited agents with their load epoch for remount keys", () => {
  expect(mountedThreads(["weather", "doctor"], { weather: 2 })).toEqual([
    { agentId: "weather", epoch: 2 },
    { agentId: "doctor", epoch: 0 },
  ]);
});
